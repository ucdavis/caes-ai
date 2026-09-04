import { afterEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { InMemorySessionRepository } from "../src/persistence/session-repository.js";
import { trace } from "@opentelemetry/api";
import { tracing } from "@opentelemetry/sdk-node";
import { OpenAIResponsesProvider } from "../src/providers/model-provider.js";

import {
  caesAiProtocolVersionHeader,
  currentProtocolVersion,
  chatStreamEventSchema,
} from "@ucdavis/caes-ai-protocol";

import { buildApp, type ServerConfig } from "../src/app.js";
import {
  scriptedModelProvider,
  throwingModelProvider,
} from "./helpers/scripted-model-provider.js";
import { StaticApplicationRegistry } from "./helpers/static-application-registry.js";

const applicationKey = "application-secret-that-is-long-enough";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  publicBaseUrl: "http://localhost:4310",
  sessionTtlMs: 30 * 60 * 1_000,
  sessionSweepIntervalMs: 60_000,
  maximumActiveSessions: 100,
  maximumSessionsPerApplication: 10,
  defaultModel: "test-model",
  allowedModels: ["test-model"],
  maximumReasoningEffort: "high",
  openAiApiKey: "unused-test-key",
  toolTimeoutMs: 5_000,
  maximumToolResponseBytes: 256 * 1_024,
  callbackIssuer: "http://localhost:4310",
  callbackTokenTtlMs: 60_000,
  providerRetryAttempts: 2,
  providerRetryBaseDelayMs: 0,
  databaseUrl: "postgresql://unused.test/caes-ai",
  allowInsecureCallbacks: true,
};

const applicationRegistry = new StaticApplicationRegistry([{
  id: "sample-app",
  apiKey: applicationKey,
  toolCallbackUrl: "http://sample-app.test/api/ai/tools/execute",
  allowedOrigins: ["http://localhost:5173"],
  allowedModels: ["test-model"],
  maximumReasoningEffort: "medium",
}, {
  id: "other-app",
  apiKey: "other-application-secret",
  toolCallbackUrl: "https://other-app.test/api/ai/tools/execute",
  allowedOrigins: ["https://other-app.test"],
  allowedModels: ["test-model"],
  maximumReasoningEffort: "medium",
}]);

const sessionRequest = {
  protocolVersion: currentProtocolVersion,
  userReference: "opaque-user",
  contextToken: "signed-context-token",
  instructions: "Use tools for current data.",
  modelPolicy: {
    requestedModel: null,
    defaultReasoningEffort: "low",
    maximumReasoningEffort: "medium",
    allowPerTurnOverride: true,
  },
  tools: [
    {
      name: "list_todos",
      description: "Read the current Todos.",
      execution: "server",
      risk: "read",
      needsApproval: false,
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          resultView: { type: "string", enum: ["list", "none"] },
        },
        additionalProperties: false,
      },
      dataSchema: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object" } },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
  ],
};

describe("session API", () => {
  const apps: Array<ReturnType<typeof buildApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it("returns safe versioned errors without logging database parameters", async () => {
    const logs: string[] = [];
    const repository = new InMemorySessionRepository();
    vi.spyOn(repository, "insert").mockRejectedValue(new DrizzleQueryError(
      "insert into sessions values ($1, $2)", ["PRIVATE_CONTEXT_MARKER", "PRIVATE_INSTRUCTION_MARKER"], new Error("PRIVATE_CAUSE_MARKER"),
    ));
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider,
      sessionRepository: repository,
      logger: { stream: new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } }) },
    });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/sessions", headers: { authorization: `ApiKey ${applicationKey}` }, payload: sessionRequest });
    expect(response.statusCode).toBe(500);
    expect(response.headers[caesAiProtocolVersionHeader]).toBe("1");
    expect(response.json()).toEqual({ protocolVersion: 1, error: { code: "internal_error", message: "The service is temporarily unavailable.", retryable: true } });
    expect(response.body + logs.join("")).not.toMatch(/PRIVATE_|insert into|signed-context-token/);
  });

  it("keeps full provider exceptions in OTEL while sanitizing the browser and console", async () => {
    const exporter = new tracing.InMemorySpanExporter();
    const provider = new tracing.BasicTracerProvider({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = buildApp({ config, applicationRegistry,
      modelProvider: { ...throwingModelProvider, middleware: (context) => new OpenAIResponsesProvider(config).middleware(context) },
    });
    apps.push(app);
    try {
      const created = await app.inject({ method: "POST", url: "/v1/sessions", headers: { authorization: `ApiKey ${applicationKey}` }, payload: sessionRequest });
      const session = created.json();
      const response = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/chat`, headers: { authorization: `Bearer ${session.accessToken}`, [caesAiProtocolVersionHeader]: "1" },
        payload: { protocolVersion: 1, threadId: "thread-error", runId: "run-error", messages: [{ id: "message", role: "user", content: "SYNTHETIC_PROMPT_MARKER" }], tools: [], context: [] },
      });
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      expect(JSON.stringify(spans.map((span) => span.events))).toContain("Sensitive upstream failure details");
      expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain("SYNTHETIC_PROMPT_MARKER");
      expect(response.body).not.toContain("Sensitive upstream failure details");
      expect(JSON.stringify([consoleError.mock.calls, consoleInfo.mock.calls])).not.toContain("Sensitive upstream failure details");
      for (const line of response.body.split("\n").filter((value) => value.startsWith("data: "))) {
        expect(chatStreamEventSchema.safeParse(JSON.parse(line.slice(6))).success).toBe(true);
      }
    } finally {
      consoleError.mockRestore(); consoleInfo.mockRestore();
      trace.disable(); await provider.shutdown();
    }
  });

  it.each([
    ["{", 400],
    [JSON.stringify({ text: "x".repeat(300_000) }), 413],
  ])("versions parser failures", async (payload, status) => {
    const app = buildApp({ config, applicationRegistry });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/sessions", headers: { "content-type": "application/json" }, payload });
    expect(response.statusCode).toBe(status);
    expect(response.json().protocolVersion).toBe(1);
    expect(response.headers[caesAiProtocolVersionHeader]).toBe("1");
  });

  it("versions denied origins and rejects invalid session IDs before database lookup", async () => {
    const repository = new InMemorySessionRepository();
    const lookup = vi.spyOn(repository, "find").mockRejectedValue(new Error("database unavailable"));
    const app = buildApp({ config, applicationRegistry, sessionRepository: repository });
    apps.push(app);
    const origin = await app.inject({ method: "POST", url: "/v1/sessions", headers: { origin: "https://unknown.invalid" }, payload: sessionRequest });
    expect(origin.statusCode).toBe(403);
    expect(origin.json().protocolVersion).toBe(1);
    const response = await app.inject({ method: "POST", url: "/v1/sessions/not-a-uuid/chat", headers: { authorization: "Bearer synthetic" }, payload: {} });
    expect(response.statusCode).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("isolates schema IDs across roots, authentications, sessions and applications", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);
    const request = structuredClone(sessionRequest);
    Object.assign(request.tools[0]!.inputSchema, { $id: "https://schemas.test/reused" });
    Object.assign(request.tools[0]!.dataSchema, { $id: "https://schemas.test/reused" });
    for (const key of [applicationKey, applicationKey, "other-application-secret"]) {
      const created = await app.inject({ method: "POST", url: "/v1/sessions", headers: { authorization: `ApiKey ${key}` }, payload: request });
      expect(created.statusCode).toBe(201);
      const session = created.json();
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.inject({ method: "POST", url: `/v1/sessions/${session.sessionId}/chat`, headers: { authorization: `Bearer ${session.accessToken}` }, payload: {} });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("unsupported_protocol_version");
      }
    }
  });

  it("publishes only public callback verification keys", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/.well-known/jwks.json" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.json()).toMatchObject({
      keys: [expect.objectContaining({ alg: "ES256", kty: "EC", use: "sig" })],
    });
    expect(response.json().keys[0].d).toBeUndefined();
  });

  it("reports readiness through the application registry", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("creates a short-lived session for an authenticated application", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: sessionRequest,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      protocolVersion: currentProtocolVersion,
      chatUrl: expect.stringMatching(/\/v1\/sessions\/.+\/chat$/),
      modelPolicy: {
        model: "test-model",
        defaultReasoningEffort: "low",
        maximumReasoningEffort: "medium",
        allowedReasoningEfforts: ["none", "minimal", "low", "medium"],
      },
      toolManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tools: sessionRequest.tools,
    });
    expect(response.json().accessToken).toHaveLength(43);
    expect(response.body).not.toContain(applicationKey);
    expect(response.body).not.toContain("callback-secret");
  });

  it("rejects an incorrect application key", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: "ApiKey definitely-wrong" },
      payload: sessionRequest,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_application_key" },
    });
  });

  it("rejects an unsupported protocol version with a stable error", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: { ...sessionRequest, protocolVersion: 2 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      protocolVersion: currentProtocolVersion,
      error: { code: "unsupported_protocol_version" },
    });
  });

  it("rejects unsupported JSON Schema keywords", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);
    const invalidRequest = {
      ...structuredClone(sessionRequest),
      tools: [{
        ...structuredClone(sessionRequest.tools[0]!),
        inputSchema: {
          type: "object",
          unknownCaesAiKeyword: true,
        },
      }],
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: invalidRequest,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "invalid_tool_manifest" },
    });
  });

  it("binds browser origins to the application that created the session", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: sessionRequest,
    });
    const session = created.json<{ sessionId: string; accessToken: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat`,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
        origin: "https://other-app.test",
      },
      payload: {
        protocolVersion: currentProtocolVersion,
        threadId: "thread-origin",
        runId: "run-origin",
        messages: [{ id: "user-origin", role: "user", content: "Hello" }],
        tools: [],
        context: [],
        forwardedProps: {},
        state: {},
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "origin_not_allowed" } });
  });

  it("rejects browser chat without the explicit version header and body field", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: scriptedModelProvider });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: sessionRequest,
    });
    const session = created.json<{ sessionId: string; accessToken: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat`,
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: {
        threadId: "thread-unversioned",
        runId: "run-unversioned",
        messages: [],
        tools: [],
        context: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers[caesAiProtocolVersionHeader]).toBe("1");
    expect(response.json()).toMatchObject({
      protocolVersion: currentProtocolVersion,
      error: { code: "unsupported_protocol_version" },
    });
  });

  it("streams a dynamically registered server tool through the application gateway", async () => {
    const gatewayRequests: unknown[] = [];
    const app = buildApp({
      config,
      applicationRegistry,
      modelProvider: scriptedModelProvider,
      fetchImplementation: async (_input, init) => {
        gatewayRequests.push(JSON.parse(String(init?.body)));
        return Response.json({
          protocolVersion: currentProtocolVersion,
          ok: true,
          output: {
            data: { items: [{ id: "one", title: "Test the stream" }] },
            uiEffects: [],
          },
        });
      },
    });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: sessionRequest,
    });
    const session = created.json<{ sessionId: string; accessToken: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat`,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
      },
      payload: {
        protocolVersion: currentProtocolVersion,
        threadId: "thread-1",
        runId: "run-1",
        messages: [{ id: "user-1", role: "user", content: "What are my Todos?" }],
        tools: [],
        context: [],
        forwardedProps: { reasoningEffort: "medium" },
        state: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.headers[caesAiProtocolVersionHeader]).toBe("1");
    expect(response.body).toContain("TOOL_CALL_RESULT");
    const assistantText = response.body
      .trim()
      .split("\n\n")
      .map((block) => JSON.parse(block.replace(/^data: /, "")) as {
        type: string;
        delta?: string;
      })
      .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
      .map((event) => event.delta ?? "")
      .join("");
    expect(assistantText).toBe("I found 1 matching Todos.");
    for (const block of response.body.trim().split("\n\n")) {
      expect(JSON.parse(block.replace(/^data: /, ""))).toMatchObject({
        metadata: {
          caesAi: { protocolVersion: currentProtocolVersion },
        },
      });
    }
    expect(gatewayRequests).toHaveLength(1);
    expect(gatewayRequests[0]).toMatchObject({
      sessionId: session.sessionId,
      toolName: "list_todos",
      toolManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      contextToken: "signed-context-token",
      arguments: { status: "all", resultView: "list" },
    });
  });

  it("streams a versioned public error when the model provider throws", async () => {
    const app = buildApp({ config, applicationRegistry, modelProvider: throwingModelProvider });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `ApiKey ${applicationKey}` },
      payload: sessionRequest,
    });
    const session = created.json<{ sessionId: string; accessToken: string }>();

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat`,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
      },
      payload: {
        protocolVersion: currentProtocolVersion,
        threadId: "thread-error",
        runId: "run-error",
        messages: [{ id: "user-error", role: "user", content: "Hello" }],
        tools: [],
        context: [],
        forwardedProps: {},
        state: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[caesAiProtocolVersionHeader]).toBe("1");
    const events = response.body
      .trim()
      .split("\n\n")
      .map((block) => JSON.parse(block.replace(/^data: /, "")) as {
        type: string;
        code?: string;
        message?: string;
        metadata?: { caesAi?: { protocolVersion?: number } };
      });
    expect(events.at(-1)).toMatchObject({
      type: "RUN_ERROR",
      code: "provider_error",
      message: "I couldn't finish that response. Please try again.",
      metadata: { caesAi: { protocolVersion: currentProtocolVersion } },
    });
    expect(response.body).not.toContain("Sensitive upstream failure details");
  });
});
