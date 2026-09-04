import { randomBytes, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApplicationAdminService } from "../src/applications/admin.js";
import { bootstrapApplication } from "../scripts/dev/application-bootstrap.js";
import { PostgresApplicationRegistry } from "../src/applications/registry.js";
import {
  closeDatabase,
  createDatabase,
  migrateDatabase,
} from "../src/database/client.js";
import { applicationApiKeys, applications } from "../src/database/schema.js";
import {
  assistantRuns,
  assistantSessions,
  assistantToolCalls,
} from "../src/database/schema.js";
import {
  PostgresSessionRepository,
} from "../src/persistence/session-repository.js";
import { PostgresOperationalStore } from "../src/persistence/operational-store.js";
import { SessionStore } from "../src/sessions.js";
import { scriptedModelProvider } from "./helpers/scripted-model-provider.js";
import type { ServerConfig } from "../src/config.js";
import { currentProtocolVersion } from "@ucdavis/caes-ai-protocol";

const databaseUrl = process.env.CAES_AI_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set CAES_AI_TEST_DATABASE_URL to an isolated test database. See README.md verification instructions.");
}
const database = createDatabase(databaseUrl);
const createdApplicationIds: string[] = [];

function uniqueApplicationId(): string {
  return `test-${randomBytes(6).toString("hex")}`;
}

describe("PostgreSQL application registry", () => {
  beforeAll(async () => migrateDatabase(database), 30_000);

  afterAll(async () => {
    for (const id of createdApplicationIds) {
      await database.db.delete(assistantToolCalls)
        .where(eq(assistantToolCalls.applicationId, id));
      await database.db.delete(assistantRuns)
        .where(eq(assistantRuns.applicationId, id));
      await database.db.delete(assistantSessions)
        .where(eq(assistantSessions.applicationId, id));
      await database.db.delete(applications).where(eq(applications.id, id));
    }
    await closeDatabase(database);
  });

  it("persists an application and stores only its API-key hash", async () => {
    const id = uniqueApplicationId();
    createdApplicationIds.push(id);
    const admin = new ApplicationAdminService(database);
    const created = await admin.create({
      id,
      displayName: "Database test",
      toolCallbackUrl: "https://example.test/ai/tools",
      allowedOrigins: ["https://example.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "medium",
    });

    const [stored] = await database.db
      .select()
      .from(applicationApiKeys)
      .where(eq(applicationApiKeys.keyId, created.keyId));
    const registry = new PostgresApplicationRegistry(database);
    const authenticated = await registry.authenticate(created.apiKey);
    const [usedKey] = await database.db
      .select({ lastUsedAt: applicationApiKeys.lastUsedAt })
      .from(applicationApiKeys)
      .where(eq(applicationApiKeys.keyId, created.keyId));

    expect(created.apiKey).toMatch(/^caesai_app_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
    expect(stored?.keyHash).toBeInstanceOf(Buffer);
    expect(stored?.keyHash.toString("utf8")).not.toContain(created.apiKey);
    expect(usedKey?.lastUsedAt).toBeInstanceOf(Date);
    expect(authenticated).toMatchObject({
      id,
      toolCallbackUrl: "https://example.test/ai/tools",
      allowedOrigins: ["https://example.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "medium",
    });
    expect(await registry.isOriginAllowed("https://example.test")).toBe(true);
    await expect(registry.checkHealth()).resolves.toBeUndefined();

    await admin.update(id, {
      toolCallbackUrl: "https://example.test/v2/ai/tools",
      allowedOrigins: ["https://updated.example.test"],
      allowedModels: ["test-model", "second-model"],
    });
    expect(await registry.authenticate(created.apiKey)).toMatchObject({
      toolCallbackUrl: "https://example.test/v2/ai/tools",
      allowedModels: ["test-model", "second-model"],
    });
    expect(await registry.isOriginAllowed("https://example.test")).toBe(false);
    expect(await registry.isOriginAllowed("https://updated.example.test")).toBe(true);
  });

  it("supports overlap rotation, revocation, and application disablement", async () => {
    const id = uniqueApplicationId();
    createdApplicationIds.push(id);
    const admin = new ApplicationAdminService(database);
    const original = await admin.create({
      id,
      displayName: "Rotation test",
      toolCallbackUrl: "https://rotation.test/ai/tools",
      allowedOrigins: ["https://rotation.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "low",
    });
    const rotated = await admin.rotateKey(id, "replacement");
    const registry = new PostgresApplicationRegistry(database);

    expect((await registry.authenticate(original.apiKey))?.id).toBe(id);
    expect((await registry.authenticate(rotated.apiKey))?.id).toBe(id);

    await admin.revokeKey(id, original.keyId);
    expect(await registry.authenticate(original.apiKey)).toBeUndefined();
    expect((await registry.authenticate(rotated.apiKey))?.id).toBe(id);

    await admin.setEnabled(id, false);
    expect(await registry.authenticate(rotated.apiKey)).toBeUndefined();
    expect(await registry.isOriginAllowed("https://rotation.test")).toBe(false);
    expect(await registry.isApplicationEnabled(id)).toBe(false);

    await admin.setEnabled(id, true);
    expect((await registry.authenticate(rotated.apiKey))?.id).toBe(id);
    expect(await registry.isApplicationEnabled(id)).toBe(true);
  });

  it("refuses to reassign a bootstrap key ID to another credential", async () => {
    const firstId = uniqueApplicationId();
    const secondId = uniqueApplicationId();
    createdApplicationIds.push(firstId, secondId);
    const keyId = randomBytes(8).toString("hex");
    const firstKey = `caesai_app_${keyId}_${"A".repeat(43)}`;
    const conflictingKey = `caesai_app_${keyId}_${"B".repeat(43)}`;
    const application = {
      displayName: "Bootstrap collision test",
      toolCallbackUrl: "https://bootstrap.test/ai/tools",
      allowedOrigins: ["https://bootstrap.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "low" as const,
    };

    await bootstrapApplication(database, { id: firstId, ...application }, firstKey);
    await expect(bootstrapApplication(
      database,
      { id: secondId, ...application },
      conflictingKey,
    ))
      .rejects.toThrow(`Application key ID ${keyId} is already in use.`);

    const registry = new PostgresApplicationRegistry(database);
    expect((await registry.authenticate(firstKey))?.id).toBe(firstId);
    expect(await registry.authenticate(conflictingKey)).toBeUndefined();
    expect(await registry.isApplicationEnabled(secondId)).toBe(false);
  });

  it("persists restart-safe sessions and content-free operational metadata", async () => {
    const id = uniqueApplicationId();
    createdApplicationIds.push(id);
    const admin = new ApplicationAdminService(database);
    const key = await admin.create({
      id,
      displayName: "Durability test",
      toolCallbackUrl: "https://durability.test/ai/tools",
      allowedOrigins: ["https://durability.test"],
      allowedModels: ["test-model"],
      maximumReasoningEffort: "medium",
    });
    const application = await new PostgresApplicationRegistry(database)
      .authenticate(key.apiKey);
    expect(application).toBeDefined();

    const config: ServerConfig = {
      host: "127.0.0.1",
      port: 0,
      publicBaseUrl: "https://caes-ai.test",
      sessionTtlMs: 60_000,
      sessionSweepIntervalMs: 60_000,
      maximumActiveSessions: 100,
      maximumSessionsPerApplication: 10,
      defaultModel: "test-model",
      modelProfiles: { default: "test-model" },
      allowedModels: ["test-model"],
      maximumReasoningEffort: "high",
      openAiApiKey: "unused",
      toolTimeoutMs: 5_000,
      maximumToolResponseBytes: 256 * 1_024,
      callbackIssuer: "https://caes-ai.test",
      callbackTokenTtlMs: 60_000,
      providerRetryAttempts: 2,
      providerRetryBaseDelayMs: 0,
      databaseUrl,
    };
    const repository = new PostgresSessionRepository(database);
    const firstProcess = new SessionStore(config, scriptedModelProvider, undefined, repository);
    const created = await firstProcess.create(application!, {
      protocolVersion: currentProtocolVersion,
      userReference: "person-123",
      contextToken: "signed-context-token",
      instructions: "Use only registered tools.",
      modelPolicy: {
        requestedModel: "default",
        defaultReasoningEffort: "low",
        maximumReasoningEffort: "medium",
        allowPerTurnOverride: true,
      },
      tools: [{
        name: "read_items", description: "Read items.", execution: "server", risk: "read", needsApproval: false,
        inputSchema: { $id: "https://schemas.test/restart", type: "object" },
        dataSchema: { $id: "https://schemas.test/restart", type: "object" },
      }],
    });
    const secondProcess = new SessionStore(config, scriptedModelProvider, undefined, repository);
    const restored = await secondProcess.authenticate(
      created.record.id,
      created.accessToken,
    );
    expect(restored?.id).toBe(created.record.id);
    expect(restored?.tools[0]?.validateInput({})).toBe(true);
    expect((await secondProcess.authenticate(created.record.id, created.accessToken))?.tools[0]?.validateData({})).toBe(true);
    expect(restored?.userReferenceHash).toMatch(/^[a-f0-9]{64}$/);

    const operations = new PostgresOperationalStore(database);
    const runId = randomUUID();
    await operations.startRun({
      id: runId,
      applicationId: id,
      sessionId: created.record.id,
      clientRunId: "client-run-1",
      threadId: "thread-1",
      provider: "test",
      transport: "responses",
      model: "test-model",
      reasoningEffort: "low",
      startedAt: new Date(),
    });
    await operations.finishRun({
      id: runId,
      outcome: "complete",
      durationMs: 12,
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      completedAt: new Date(),
    });
    await operations.recordToolCall({
      id: randomUUID(),
      applicationId: id,
      sessionId: created.record.id,
      runId: "client-run-1",
      toolCallId: "tool-call-1",
      toolName: "read_items",
      risk: "read",
      outcome: "complete",
      durationMs: 3,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const [storedRun] = await database.db.select().from(assistantRuns)
      .where(eq(assistantRuns.id, runId));
    const [storedTool] = await database.db.select().from(assistantToolCalls)
      .where(eq(assistantToolCalls.sessionId, created.record.id));
    expect(storedRun).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      outcome: "complete",
    });
    expect(storedTool).toMatchObject({
      toolName: "read_items",
      outcome: "complete",
    });
    expect(storedRun).not.toHaveProperty("messages");
    expect(storedTool).not.toHaveProperty("arguments");
    expect(storedTool).not.toHaveProperty("output");
  });
});
