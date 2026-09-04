import type { ReasoningEffort } from "@ucdavis/caes-ai-protocol";

export interface ServerConfig {
  host: string;
  port: number;
  publicBaseUrl: string;
  sessionTtlMs: number;
  sessionSweepIntervalMs: number;
  maximumActiveSessions: number;
  maximumSessionsPerApplication: number;
  defaultModel: string;
  modelProfiles?: Partial<Record<"default" | "fast" | "deep", string>>;
  allowedModels: string[];
  maximumReasoningEffort: ReasoningEffort;
  modelReasoningEfforts?: Record<string, ReasoningEffort[]>;
  openAiApiKey: string;
  toolTimeoutMs: number;
  maximumToolResponseBytes: number;
  callbackIssuer: string;
  callbackTokenTtlMs: number;
  providerRetryAttempts: number;
  providerRetryBaseDelayMs: number;
  databaseUrl: string;
  callbackSigningKeysPath?: string;
  allowInsecureCallbacks?: boolean;
}

const reasoningEfforts = new Set<ReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function loadConfig(): ServerConfig {
  const defaultModel = process.env.OPENAI_DEFAULT_MODEL?.trim() || "gpt-5.6-luna";
  const modelProfiles = {
    default: process.env.CAES_AI_MODEL_PROFILE_DEFAULT?.trim() || defaultModel,
    fast: process.env.CAES_AI_MODEL_PROFILE_FAST?.trim() || defaultModel,
    deep: process.env.CAES_AI_MODEL_PROFILE_DEEP?.trim() || defaultModel,
  };
  const allowedModels = csv(process.env.OPENAI_ALLOWED_MODELS || defaultModel);
  for (const [profile, model] of Object.entries(modelProfiles)) {
    if (!allowedModels.includes(model)) {
      throw new Error(
        `CAES_AI_MODEL_PROFILE_${profile.toUpperCase()} must resolve to an OPENAI_ALLOWED_MODELS entry.`,
      );
    }
  }

  const publicBaseUrl =
    process.env.CAES_AI_PUBLIC_BASE_URL?.trim() || "http://localhost:4310";
  const callbackIssuer = process.env.CAES_AI_CALLBACK_ISSUER?.trim() || publicBaseUrl;
  const callbackTokenTtlMs = Number(process.env.CAES_AI_CALLBACK_TOKEN_TTL_MS || 60_000);
  if (!Number.isFinite(callbackTokenTtlMs) || callbackTokenTtlMs < 5_000 || callbackTokenTtlMs > 300_000) {
    throw new Error("CAES_AI_CALLBACK_TOKEN_TTL_MS must be between 5000 and 300000.");
  }
  if (!URL.canParse(callbackIssuer)) {
    throw new Error("CAES_AI_CALLBACK_ISSUER must be an absolute URL.");
  }
  const maximumReasoningEffort = (process.env.CAES_AI_MAX_REASONING_EFFORT ||
    "high") as ReasoningEffort;
  if (!reasoningEfforts.has(maximumReasoningEffort)) {
    throw new Error("CAES_AI_MAX_REASONING_EFFORT is invalid.");
  }

  return {
    host: process.env.CAES_AI_HOST?.trim() || "0.0.0.0",
    port: Number(process.env.CAES_AI_PORT || 4310),
    publicBaseUrl,
    sessionTtlMs: integerEnvironment(
      "CAES_AI_SESSION_TTL_MS",
      30 * 60 * 1_000,
      60_000,
      24 * 60 * 60 * 1_000,
    ),
    sessionSweepIntervalMs: integerEnvironment(
      "CAES_AI_SESSION_SWEEP_INTERVAL_MS",
      60_000,
      1_000,
      60 * 60 * 1_000,
    ),
    maximumActiveSessions: integerEnvironment(
      "CAES_AI_MAX_ACTIVE_SESSIONS",
      10_000,
      1,
      1_000_000,
    ),
    maximumSessionsPerApplication: integerEnvironment(
      "CAES_AI_MAX_SESSIONS_PER_APPLICATION",
      1_000,
      1,
      100_000,
    ),
    defaultModel,
    modelProfiles,
    allowedModels,
    maximumReasoningEffort,
    openAiApiKey: requiredEnvironment("OPENAI_API_KEY"),
    toolTimeoutMs: Number(process.env.CAES_AI_TOOL_TIMEOUT_MS || 5_000),
    maximumToolResponseBytes: Number(
      process.env.CAES_AI_MAX_TOOL_RESPONSE_BYTES || 256 * 1_024,
    ),
    callbackIssuer: callbackIssuer.replace(/\/$/, ""),
    callbackTokenTtlMs,
    providerRetryAttempts: integerEnvironment(
      "CAES_AI_PROVIDER_RETRY_ATTEMPTS",
      2,
      1,
      3,
    ),
    providerRetryBaseDelayMs: integerEnvironment(
      "CAES_AI_PROVIDER_RETRY_BASE_DELAY_MS",
      250,
      0,
      5_000,
    ),
    databaseUrl: requiredEnvironment("DATABASE_URL"),
    callbackSigningKeysPath:
      process.env.CAES_AI_CALLBACK_SIGNING_KEYS_PATH?.trim() ||
      ".data/callback-signing-keys.json",
    allowInsecureCallbacks:
      process.env.CAES_AI_ALLOW_INSECURE_CALLBACKS?.trim().toLowerCase() === "true",
  };
}
