import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  ApplicationToolManifest,
  EffectiveModelPolicy,
  ReasoningEffort,
  SessionCreationRequest,
} from "@ucdavis/caes-ai-protocol";
import { compileToolSchema } from "@ucdavis/caes-ai-protocol";

import type { RegisteredApplication } from "./applications/registry.js";
import type { ServerConfig } from "./config.js";
import type { ModelProvider } from "./providers/model-provider.js";
import {
  InMemorySessionRepository,
  type SessionRepository,
  type StoredSession,
} from "./persistence/session-repository.js";

const effortOrder: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface CompiledTool {
  manifest: ApplicationToolManifest;
  validateInput: (value: unknown) => boolean;
  validateData: (value: unknown) => boolean;
}

export interface SessionRecord {
  id: string;
  application: RegisteredApplication;
  tokenHash: Buffer;
  userReferenceHash: string;
  contextToken: string;
  instructions: string;
  tools: CompiledTool[];
  toolManifestHash: string;
  modelPolicy: EffectiveModelPolicy;
  allowPerTurnOverride: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreatedSession {
  record: SessionRecord;
  accessToken: string;
}

function hashSecret(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }

  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function hashManifest(tools: ApplicationToolManifest[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(tools)))
    .digest("hex");
}

export function compareEffort(left: ReasoningEffort, right: ReasoningEffort): number {
  return effortOrder.indexOf(left) - effortOrder.indexOf(right);
}

export class SessionStore {
  constructor(
    private readonly config: ServerConfig,
    private readonly modelProvider: Pick<ModelProvider, "supportedReasoningEfforts">,
    private readonly now: () => Date = () => new Date(),
    private readonly repository: SessionRepository = new InMemorySessionRepository(),
  ) {}

  async create(
    application: RegisteredApplication,
    request: SessionCreationRequest,
  ): Promise<CreatedSession> {
    await this.removeExpired();
    if (await this.repository.countActive(this.now()) >= this.config.maximumActiveSessions) {
      throw new SessionPolicyError(
        "session_limit_reached",
        "The service has reached its active session limit.",
      );
    }
    const applicationSessionCount = await this.repository.countActive(
      this.now(),
      application.id,
    );
    if (applicationSessionCount >= this.config.maximumSessionsPerApplication) {
      throw new SessionPolicyError(
        "session_limit_reached",
        "The application has reached its active session limit.",
      );
    }

    const immutableManifests = deepFreeze(structuredClone(request.tools));
    const serializedManifest = JSON.stringify(immutableManifests);
    if (Buffer.byteLength(serializedManifest) > 64 * 1_024) {
      throw new SessionPolicyError(
        "invalid_tool_manifest",
        "The tool manifest exceeds 64 KiB.",
      );
    }

    const modelPolicy = this.#resolveModelPolicy(application, request);
    const tools = this.#compileTools(immutableManifests);

    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.config.sessionTtlMs);
    const accessToken = randomBytes(32).toString("base64url");
    const stored: StoredSession = {
      id: randomUUID(),
      application,
      tokenHash: hashSecret(accessToken),
      userReferenceHash: createHash("sha256")
        .update(request.userReference)
        .digest("hex"),
      contextToken: request.contextToken,
      instructions: request.instructions,
      tools: immutableManifests,
      toolManifestHash: hashManifest(immutableManifests),
      modelPolicy,
      allowPerTurnOverride: request.modelPolicy.allowPerTurnOverride,
      createdAt,
      expiresAt,
    };

    await this.repository.insert(stored);
    const record: SessionRecord = { ...stored, tools };
    return { record, accessToken };
  }

  async authenticate(
    sessionId: string,
    accessToken: string,
  ): Promise<SessionRecord | undefined> {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(sessionId)) return undefined;
    const stored = await this.repository.find(sessionId);
    if (!stored || stored.expiresAt <= this.now()) {
      return undefined;
    }

    const candidate = hashSecret(accessToken);
    return timingSafeEqual(candidate, stored.tokenHash) ? this.#toRecord(stored) : undefined;
  }

  async removeExpired(): Promise<void> {
    await this.repository.removeExpired(this.now());
  }

  async activeSessionCount(): Promise<number> {
    return this.repository.countActive(this.now());
  }

  resolveTurnEffort(
    session: SessionRecord,
    requested: ReasoningEffort | undefined,
  ): ReasoningEffort {
    const effort = requested ?? session.modelPolicy.defaultReasoningEffort;
    if (requested && !session.allowPerTurnOverride) {
      throw new SessionPolicyError(
        "reasoning_effort_not_allowed",
        "This session does not allow per-turn reasoning overrides.",
      );
    }
    if (!session.modelPolicy.allowedReasoningEfforts.includes(effort)) {
      throw new SessionPolicyError(
        "reasoning_effort_not_allowed",
        "The requested reasoning effort is not allowed for this session.",
      );
    }
    return effort;
  }

  #resolveModelPolicy(
    application: RegisteredApplication,
    request: SessionCreationRequest,
  ): EffectiveModelPolicy {
    const selector = request.modelPolicy.requestedModel || "default";
    const model = this.config.modelProfiles?.[
      selector as keyof NonNullable<ServerConfig["modelProfiles"]>
    ] || (selector === "default" ? this.config.defaultModel : selector);
    if (
      !this.config.allowedModels.includes(model) ||
      !application.allowedModels.includes(model)
    ) {
      throw new SessionPolicyError(
        "model_not_allowed",
        "The requested model is not allowed for this application.",
      );
    }

    const requestedMaximum = request.modelPolicy.maximumReasoningEffort;
    if (
      compareEffort(requestedMaximum, application.maximumReasoningEffort) > 0 ||
      compareEffort(requestedMaximum, this.config.maximumReasoningEffort) > 0 ||
      compareEffort(
        request.modelPolicy.defaultReasoningEffort,
        requestedMaximum,
      ) > 0
    ) {
      throw new SessionPolicyError(
        "reasoning_effort_not_allowed",
        "The requested reasoning policy exceeds an allowed maximum.",
      );
    }

    const supported = this.modelProvider.supportedReasoningEfforts(model);
    const allowedReasoningEfforts = supported.filter(
      (effort) => compareEffort(effort, requestedMaximum) <= 0,
    );
    if (!allowedReasoningEfforts.includes(request.modelPolicy.defaultReasoningEffort)) {
      throw new SessionPolicyError(
        "reasoning_effort_not_allowed",
        "The model does not support the requested default reasoning effort.",
      );
    }

    return {
      model,
      defaultReasoningEffort: request.modelPolicy.defaultReasoningEffort,
      maximumReasoningEffort: requestedMaximum,
      allowedReasoningEfforts,
    };
  }

  #compileTools(manifests: ApplicationToolManifest[]): CompiledTool[] {
    return manifests.map((manifest) => {
      try {
        return {
          manifest: deepFreeze(structuredClone(manifest)),
          // Each root schema owns its ID namespace and its compiler lifetime.
          validateInput: compileToolSchema(manifest.inputSchema),
          validateData: compileToolSchema(manifest.dataSchema),
        };
      } catch {
        throw new SessionPolicyError(
          "invalid_tool_manifest",
          `The schema for tool ${manifest.name} is invalid.`,
        );
      }
    });
  }

  #toRecord(stored: StoredSession): SessionRecord {
    return {
      ...stored,
      application: deepFreeze(structuredClone(stored.application)),
      tools: this.#compileTools(stored.tools),
      modelPolicy: deepFreeze(structuredClone(stored.modelPolicy)),
    };
  }
}

export class SessionPolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_tool_manifest"
      | "model_not_allowed"
      | "reasoning_effort_not_allowed"
      | "session_limit_reached",
    message: string,
  ) {
    super(message);
  }
}
