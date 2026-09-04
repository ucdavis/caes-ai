import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const reasoningEffortEnum = pgEnum("reasoning_effort", [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export const applications = pgTable(
  "applications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    toolCallbackUrl: text("tool_callback_url").notNull(),
    allowedOrigins: text("allowed_origins").array().notNull(),
    allowedModels: text("allowed_models").array().notNull(),
    maximumReasoningEffort: reasoningEffortEnum("maximum_reasoning_effort").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("applications_id_format", sql`${table.id} ~ '^[a-z][a-z0-9-]{0,63}$'`),
    check("applications_allowed_origins_not_empty", sql`cardinality(${table.allowedOrigins}) > 0`),
    check("applications_allowed_models_not_empty", sql`cardinality(${table.allowedModels}) > 0`),
    index("applications_enabled_idx").on(table.enabled),
  ],
);

export const applicationApiKeys = pgTable(
  "application_api_keys",
  {
    keyId: varchar("key_id", { length: 16 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    keyHash: bytea("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    check("application_api_keys_id_format", sql`${table.keyId} ~ '^[a-f0-9]{16}$'`),
    uniqueIndex("application_api_keys_hash_uidx").on(table.keyHash),
    index("application_api_keys_application_idx").on(table.applicationId),
  ],
);

export const assistantSessions = pgTable(
  "assistant_sessions",
  {
    id: uuid("id").primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    tokenHash: bytea("token_hash").notNull(),
    userReferenceHash: varchar("user_reference_hash", { length: 64 }).notNull(),
    contextToken: text("context_token").notNull(),
    instructions: text("instructions").notNull(),
    applicationSnapshot: jsonb("application_snapshot").notNull(),
    toolManifest: jsonb("tool_manifest").notNull(),
    toolManifestHash: varchar("tool_manifest_hash", { length: 64 }).notNull(),
    modelPolicy: jsonb("model_policy").notNull(),
    allowPerTurnOverride: boolean("allow_per_turn_override").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("assistant_sessions_application_idx").on(table.applicationId),
    index("assistant_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const assistantRuns = pgTable(
  "assistant_runs",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => assistantSessions.id, { onDelete: "restrict" }),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    clientRunId: varchar("client_run_id", { length: 256 }).notNull(),
    threadId: varchar("thread_id", { length: 256 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    transport: varchar("transport", { length: 64 }).notNull(),
    model: varchar("model", { length: 128 }).notNull(),
    reasoningEffort: reasoningEffortEnum("reasoning_effort").notNull(),
    outcome: varchar("outcome", { length: 64 }),
    errorCode: varchar("error_code", { length: 64 }),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("assistant_runs_session_idx").on(table.sessionId),
    index("assistant_runs_application_started_idx").on(table.applicationId, table.startedAt),
  ],
);

export const assistantToolCalls = pgTable(
  "assistant_tool_calls",
  {
    id: uuid("id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => assistantSessions.id, { onDelete: "restrict" }),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => applications.id, { onDelete: "restrict" }),
    runId: varchar("run_id", { length: 256 }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 256 }).notNull(),
    toolName: varchar("tool_name", { length: 64 }).notNull(),
    risk: varchar("risk", { length: 16 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    durationMs: integer("duration_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    index("assistant_tool_calls_session_idx").on(table.sessionId),
    index("assistant_tool_calls_application_started_idx").on(
      table.applicationId,
      table.startedAt,
    ),
  ],
);
