import {
  caesAiProtocolVersionHeader,
  currentProtocolVersion,
  sessionCreationRequestSchema,
  type CaesAiErrorResponse,
  type SessionCreationResponse,
} from "@ucdavis/caes-ai-protocol";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";

import type { ApplicationRegistry } from "./applications/registry.js";
import type { ServerConfig } from "./config.js";
import { registerChatRoute } from "./chat/route.js";
import {
  Es256CallbackTokenIssuer,
  type CallbackTokenIssuer,
} from "./security/callback-tokens.js";
import { SessionPolicyError, SessionStore } from "./sessions.js";
import {
  InMemorySessionRepository,
  type SessionRepository,
} from "./persistence/session-repository.js";
import {
  NoopOperationalStore,
  type OperationalStore,
} from "./persistence/operational-store.js";
import {
  OpenAIResponsesProvider,
  type ModelProvider,
} from "./providers/model-provider.js";
import { trace } from "@opentelemetry/api";

export type { ServerConfig } from "./config.js";

export interface BuildAppOptions {
  config: ServerConfig;
  applicationRegistry: ApplicationRegistry;
  now?: () => Date;
  fetchImplementation?: typeof fetch;
  callbackTokens?: CallbackTokenIssuer;
  modelProvider?: ModelProvider;
  sessionRepository?: SessionRepository;
  operationalStore?: OperationalStore;
  logger?: FastifyServerOptions["logger"];
}

class OriginPolicyError extends Error {
  constructor(readonly unavailable: boolean) {
    super("Origin policy check failed.");
  }
}

function publicError(
  code: string,
  message: string,
  retryable = false,
): CaesAiErrorResponse {
  return {
    protocolVersion: currentProtocolVersion,
    error: { code, message, retryable },
  };
}

function parseApplicationKey(value: string | undefined): string | undefined {
  const match = /^ApiKey\s+(.+)$/i.exec(value || "");
  return match?.[1];
}

export function buildApp({
  config,
  applicationRegistry,
  now,
  fetchImplementation,
  callbackTokens = new Es256CallbackTokenIssuer(
    config.callbackIssuer,
    config.callbackTokenTtlMs,
    now,
  ),
  modelProvider = new OpenAIResponsesProvider(config),
  sessionRepository = new InMemorySessionRepository(),
  operationalStore = new NoopOperationalStore(),
  logger,
}: BuildAppOptions): FastifyInstance {
  const sessions = new SessionStore(
    config,
    modelProvider,
    now,
    sessionRepository,
  );
  const app = Fastify({
    logger: logger ?? (process.env.NODE_ENV === "test"
      ? false
      : {
          mixin() {
            const spanContext = trace.getActiveSpan()?.spanContext();
            return spanContext
              ? { traceId: spanContext.traceId, spanId: spanContext.spanId }
              : {};
          },
        }),
    bodyLimit: 256 * 1_024,
    requestIdHeader: "x-caes-ai-request-id",
  });
  app.setErrorHandler((error, request, reply) => {
    const code = (error as { code?: string }).code;
    const originError = error instanceof OriginPolicyError ? error : undefined;
    const tooLarge = code === "FST_ERR_CTP_BODY_TOO_LARGE";
    const invalidBody = code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      code === "FST_ERR_CTP_EMPTY_JSON_BODY" || code === "FST_ERR_CTP_INVALID_MEDIA_TYPE";
    const status = originError ? (originError.unavailable ? 503 : 403)
      : tooLarge ? 413 : invalidBody ? 400 : 500;
    const publicCode = originError ? (originError.unavailable ? "origin_policy_unavailable" : "origin_not_allowed")
      : tooLarge ? "request_too_large" : invalidBody ? "invalid_request" : "internal_error";
    // Database exceptions can contain SQL parameters, including stored context tokens.
    request.log.warn({ errorCode: publicCode }, "Request failed");
    reply.header(caesAiProtocolVersionHeader, String(currentProtocolVersion));
    return reply.status(status).send(publicError(publicCode,
      status >= 500 ? "The service is temporarily unavailable." : "The request was rejected.",
      status >= 500));
  });
  const sessionSweep = setInterval(
    () => void sessions.removeExpired().catch(() =>
      app.log.warn({ errorCode: "session_cleanup_failed" }, "Expired session cleanup failed")),
    config.sessionSweepIntervalMs,
  );
  sessionSweep.unref();
  app.addHook("onClose", async () => clearInterval(sessionSweep));

  void app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      void applicationRegistry.isOriginAllowed(origin)
        .then((allowed) => callback(
          allowed ? null : new OriginPolicyError(false),
          allowed,
        ))
        .catch(() => callback(new OriginPolicyError(true), false));
    },
    allowedHeaders: [
      "authorization",
      "content-type",
      caesAiProtocolVersionHeader,
      "x-caes-ai-request-id",
      "x-run-id",
    ],
    exposedHeaders: [caesAiProtocolVersionHeader],
  });

  app.get("/health", () => ({
    status: "ok",
    releaseSha: config.releaseSha,
    provider: modelProvider.name,
    model: config.modelProfiles?.default || config.defaultModel,
    transport: modelProvider.transport,
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await applicationRegistry.checkHealth();
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  app.get("/.well-known/jwks.json", (_request, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return callbackTokens.getJwks();
  });

  app.post("/v1/sessions", async (request, reply) => {
    const apiKey = parseApplicationKey(request.headers.authorization);
    let application;
    try {
      application = apiKey
        ? await applicationRegistry.authenticate(apiKey)
        : undefined;
    } catch {
      request.log.warn("Application registry lookup failed");
      return reply.status(503).send(publicError(
        "application_registry_unavailable",
        "Application authentication is temporarily unavailable.",
        true,
      ));
    }
    if (!application) {
      return reply
        .status(401)
        .send(publicError("invalid_application_key", "Application authentication failed."));
    }

    const requestedVersion = (request.body as { protocolVersion?: unknown } | null)
      ?.protocolVersion;
    if (requestedVersion !== currentProtocolVersion) {
      return reply.status(400).send(publicError(
        "unsupported_protocol_version",
        `CAES AI supports protocol version ${currentProtocolVersion}.`,
      ));
    }

    const parsed = sessionCreationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.info(
        { issueCount: parsed.error.issues.length, applicationId: application.id },
        "Session manifest rejected",
      );
      return reply
        .status(400)
        .send(publicError("invalid_tool_manifest", "The session request is invalid."));
    }

    try {
      const callbackUrl = new URL(application.toolCallbackUrl);
      if (
        !config.allowInsecureCallbacks &&
        callbackUrl.protocol !== "https:" &&
        callbackUrl.hostname !== "localhost" &&
        callbackUrl.hostname !== "127.0.0.1" &&
        callbackUrl.hostname !== "::1"
      ) {
        return reply.status(400).send(publicError(
          "insecure_tool_callback",
          "The registered tool callback must use HTTPS.",
        ));
      }
      const created = await sessions.create(application, parsed.data);
      const response: SessionCreationResponse = {
        protocolVersion: currentProtocolVersion,
        sessionId: created.record.id,
        accessToken: created.accessToken,
        expiresAt: created.record.expiresAt.toISOString(),
        chatUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/v1/sessions/${created.record.id}/chat`,
        modelPolicy: created.record.modelPolicy,
        toolManifestHash: created.record.toolManifestHash,
        tools: created.record.tools.map((tool) => tool.manifest),
      };

      request.log.info(
        {
          applicationId: application.id,
          sessionId: created.record.id,
          model: created.record.modelPolicy.model,
          defaultReasoningEffort:
            created.record.modelPolicy.defaultReasoningEffort,
          maximumReasoningEffort:
            created.record.modelPolicy.maximumReasoningEffort,
          toolManifestHash: created.record.toolManifestHash,
          expiresAt: created.record.expiresAt.toISOString(),
          userReferenceHash: created.record.userReferenceHash.slice(0, 16),
        },
        "Session created",
      );

      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof SessionPolicyError) {
        return reply
          .status(error.code === "session_limit_reached" ? 429 : 400)
          .send(publicError(error.code, error.message, error.code === "session_limit_reached"));
      }
      throw error;
    }
  });

  registerChatRoute(
    app,
    config,
    sessions,
    applicationRegistry,
    callbackTokens,
    modelProvider,
    operationalStore,
    fetchImplementation,
  );

  app.decorate("caesAiSessions", sessions);
  return app;
}
