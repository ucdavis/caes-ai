import { describe, expect, it } from "vitest";

import { currentProtocolVersion, reasoningEfforts } from "@ucdavis/caes-ai-protocol";

import type { ServerConfig } from "../src/config.js";
import type { RegisteredApplication } from "../src/applications/registry.js";
import { StaticApplicationRegistry } from "./helpers/static-application-registry.js";
import {
  SessionPolicyError,
  SessionStore,
  hashManifest,
} from "../src/sessions.js";
import { scriptedModelProvider } from "./helpers/scripted-model-provider.js";
import { validateApplication } from "../src/applications/admin.js";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  publicBaseUrl: "http://localhost:4310",
  sessionTtlMs: 60_000,
  sessionSweepIntervalMs: 60_000,
  maximumActiveSessions: 100,
  maximumSessionsPerApplication: 10,
  defaultModel: "test-model",
  allowedModels: ["test-model"],
  maximumReasoningEffort: "high",
  modelReasoningEfforts: { "test-model": ["none", "low", "medium", "high"] },
  openAiApiKey: "unused-test-key",
  toolTimeoutMs: 50,
  maximumToolResponseBytes: 4_096,
  callbackIssuer: "http://caes-ai.test",
  callbackTokenTtlMs: 60_000,
  providerRetryAttempts: 2,
  providerRetryBaseDelayMs: 0,
  databaseUrl: "postgresql://unused.test/caes-ai",
};

const applicationConfig = {
  id: "sample",
  apiKey: "sample-application-secret",
  toolCallbackUrl: "http://sample.test/tools",
  allowedOrigins: [],
  allowedModels: ["test-model"],
  maximumReasoningEffort: "medium" as const,
};

const request = {
  protocolVersion: currentProtocolVersion,
  userReference: "user",
  contextToken: "signed-context-token",
  instructions: "Use tools.",
  modelPolicy: {
    requestedModel: null,
    defaultReasoningEffort: "low" as const,
    maximumReasoningEffort: "medium" as const,
    allowPerTurnOverride: true,
  },
  tools: [{
    name: "read_items",
    description: "Read items.",
    execution: "server" as const,
    risk: "read" as const,
    needsApproval: false,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    dataSchema: { type: "object", properties: {}, additionalProperties: false },
  }],
};

function application(): RegisteredApplication {
  return {
    id: applicationConfig.id,
    toolCallbackUrl: applicationConfig.toolCallbackUrl,
    allowedOrigins: applicationConfig.allowedOrigins,
    allowedModels: applicationConfig.allowedModels,
    maximumReasoningEffort: applicationConfig.maximumReasoningEffort,
  };
}

function sessionStore(
  configuration: ServerConfig = config,
  now?: () => Date,
): SessionStore {
  return new SessionStore(
    configuration,
    {
      ...scriptedModelProvider,
      supportedReasoningEfforts: (model) =>
        configuration.modelReasoningEfforts?.[model] ?? reasoningEfforts,
    },
    now,
  );
}

describe("session and model policy", () => {
  it("requires HTTPS callbacks outside loopback or an explicit development override", () => {
    const input = {
      id: "sample",
      displayName: "Sample",
      toolCallbackUrl: "http://application.internal/tools",
      allowedOrigins: ["https://sample.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "medium" as const,
    };
    expect(() => validateApplication(input)).toThrow(/HTTPS/);
    expect(validateApplication({
      ...input,
      toolCallbackUrl: "http://localhost:5180/tools",
    }).toolCallbackUrl).toBe("http://localhost:5180/tools");
    expect(validateApplication(input, true).toolCallbackUrl)
      .toBe("http://application.internal/tools");
  });

  it("uses a hashed-key test application registry", async () => {
    const registry = new StaticApplicationRegistry([applicationConfig]);
    expect((await registry.authenticate("sample-application-secret"))?.id).toBe("sample");
    expect(await registry.authenticate("wrong-secret")).toBeUndefined();
  });

  it("binds an access token to its session and rejects a modified token", async () => {
    const store = sessionStore();
    const created = await store.create(application(), request);
    expect((await store.authenticate(created.record.id, created.accessToken))?.id).toBe(created.record.id);
    expect(await store.authenticate(created.record.id, `${created.accessToken}x`)).toBeUndefined();
    expect(created.record.tokenHash.toString("utf8")).not.toContain(created.accessToken);
  });

  it("rejects expired sessions", async () => {
    let now = new Date("2026-09-01T12:00:00Z");
    const store = sessionStore(config, () => now);
    const created = await store.create(application(), request);
    now = new Date("2026-09-01T12:02:00Z");
    expect(await store.authenticate(created.record.id, created.accessToken)).toBeUndefined();
  });

  it("bounds active sessions and releases capacity after expiration", async () => {
    let now = new Date("2026-09-01T12:00:00Z");
    const configuration = {
      ...config,
      maximumActiveSessions: 1,
      maximumSessionsPerApplication: 1,
    };
    const store = sessionStore(configuration, () => now);
    await store.create(application(), request);

    await expect(store.create(application(), request)).rejects.toThrowError(
      /active session limit/,
    );
    expect(await store.activeSessionCount()).toBe(1);

    now = new Date("2026-09-01T12:02:00Z");
    await store.removeExpired();
    expect(await store.activeSessionCount()).toBe(0);
    await expect(store.create(application(), request)).resolves.toBeDefined();
  });

  it("copies and freezes the manifest at session creation", async () => {
    const store = sessionStore();
    const mutable = structuredClone(request);
    const created = await store.create(application(), mutable);
    mutable.tools[0]!.description = "Changed later.";
    expect(created.record.tools[0]!.manifest.description).toBe("Read items.");
    expect(Object.isFrozen(created.record.tools[0]!.manifest)).toBe(true);
  });

  it("enforces per-turn reasoning precedence and maximum", async () => {
    const store = sessionStore();
    const created = await store.create(application(), request);
    expect(store.resolveTurnEffort(created.record, undefined)).toBe("low");
    expect(store.resolveTurnEffort(created.record, "medium")).toBe("medium");
    expect(() => store.resolveTurnEffort(created.record, "high")).toThrow(SessionPolicyError);
  });

  it("rejects a session ceiling above the application maximum", async () => {
    const store = sessionStore();
    await expect(store.create(application(), {
      ...request,
      modelPolicy: { ...request.modelPolicy, maximumReasoningEffort: "high" },
    })).rejects.toThrowError(/exceeds an allowed maximum/);
  });

  it("rejects an effort unsupported by the selected model", async () => {
    const configuration = {
      ...config,
      modelReasoningEfforts: { "test-model": ["low", "high"] },
    } satisfies ServerConfig;
    const store = sessionStore(configuration);
    await expect(store.create(application(), {
      ...request,
      modelPolicy: { ...request.modelPolicy, defaultReasoningEffort: "medium" },
    })).rejects.toThrowError(/does not support/);
  });

  it("rejects a turn override when the session disabled overrides", async () => {
    const store = sessionStore();
    const created = await store.create(application(), {
      ...request,
      modelPolicy: { ...request.modelPolicy, allowPerTurnOverride: false },
    });
    expect(() => store.resolveTurnEffort(created.record, "medium"))
      .toThrowError(/does not allow per-turn/);
  });

  it("rejects models outside the central and application allowlists", async () => {
    const store = sessionStore();
    await expect(store.create(application(), {
      ...request,
      modelPolicy: { ...request.modelPolicy, requestedModel: "other-model" },
    })).rejects.toThrowError(/not allowed/);
  });

  it.each([
    [null, "test-default"],
    ["default", "test-default"],
    ["fast", "test-fast"],
    ["deep", "test-deep"],
    ["test-exact", "test-exact"],
  ])("resolves model selector %s to %s", async (selector, expectedModel) => {
    const models = ["test-default", "test-fast", "test-deep", "test-exact"];
    const configuration: ServerConfig = {
      ...config,
      defaultModel: "test-default",
      modelProfiles: {
        default: "test-default",
        fast: "test-fast",
        deep: "test-deep",
      },
      allowedModels: models,
    };
    const created = await sessionStore(configuration).create(
      { ...application(), allowedModels: models },
      {
        ...request,
        modelPolicy: { ...request.modelPolicy, requestedModel: selector },
      },
    );

    expect(created.record.modelPolicy.model).toBe(expectedModel);
  });

  it("produces the same manifest hash independent of object key order", () => {
    const original = request.tools;
    const reordered = [{
      dataSchema: original[0]!.dataSchema,
      inputSchema: original[0]!.inputSchema,
      needsApproval: false,
      risk: "read" as const,
      execution: "server" as const,
      description: "Read items.",
      name: "read_items",
    }];
    expect(hashManifest(original)).toBe(hashManifest(reordered));
  });
});
