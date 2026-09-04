import { createHash, timingSafeEqual } from "node:crypto";

import type { ReasoningEffort } from "@ucdavis/caes-ai-protocol";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { CaesAiDatabase } from "../database/client.js";
import { applicationApiKeys, applications } from "../database/schema.js";

export interface RegisteredApplication {
  id: string;
  toolCallbackUrl: string;
  allowedOrigins: string[];
  allowedModels: string[];
  maximumReasoningEffort: ReasoningEffort;
}

export interface ApplicationRegistry {
  authenticate(apiKey: string): Promise<RegisteredApplication | undefined>;
  isOriginAllowed(origin: string): Promise<boolean>;
  isApplicationEnabled(applicationId: string): Promise<boolean>;
  checkHealth(): Promise<void>;
}

function hashApiKey(apiKey: string): Buffer {
  return createHash("sha256").update(apiKey, "utf8").digest();
}

export function parseApplicationApiKey(apiKey: string):
  | { keyId: string; keyHash: Buffer }
  | undefined {
  const match = /^caesai_app_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/.exec(apiKey);
  return match?.[1]
    ? { keyId: match[1], keyHash: hashApiKey(apiKey) }
    : undefined;
}

export class PostgresApplicationRegistry implements ApplicationRegistry {
  constructor(private readonly database: CaesAiDatabase) {}

  async authenticate(apiKey: string): Promise<RegisteredApplication | undefined> {
    const parsed = parseApplicationApiKey(apiKey);
    if (!parsed) return undefined;

    const [row] = await this.database.db
      .select({
        keyHash: applicationApiKeys.keyHash,
        id: applications.id,
        toolCallbackUrl: applications.toolCallbackUrl,
        allowedOrigins: applications.allowedOrigins,
        allowedModels: applications.allowedModels,
        maximumReasoningEffort: applications.maximumReasoningEffort,
      })
      .from(applicationApiKeys)
      .innerJoin(applications, eq(applicationApiKeys.applicationId, applications.id))
      .where(and(
        eq(applicationApiKeys.keyId, parsed.keyId),
        isNull(applicationApiKeys.revokedAt),
        eq(applications.enabled, true),
      ))
      .limit(1);

    const storedHash = row?.keyHash;
    if (!storedHash ||
        storedHash.length !== parsed.keyHash.length ||
        !timingSafeEqual(storedHash, parsed.keyHash)) {
      return undefined;
    }

    await this.database.db
      .update(applicationApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(applicationApiKeys.keyId, parsed.keyId));

    return {
      id: row.id,
      toolCallbackUrl: row.toolCallbackUrl,
      allowedOrigins: row.allowedOrigins,
      allowedModels: row.allowedModels,
      maximumReasoningEffort: row.maximumReasoningEffort,
    };
  }

  async isOriginAllowed(origin: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: applications.id })
      .from(applications)
      .where(and(
        eq(applications.enabled, true),
        sql`${origin} = ANY(${applications.allowedOrigins})`,
      ))
      .limit(1);
    return rows.length > 0;
  }

  async isApplicationEnabled(applicationId: string): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: applications.id })
      .from(applications)
      .where(and(
        eq(applications.id, applicationId),
        eq(applications.enabled, true),
      ))
      .limit(1);
    return rows.length === 1;
  }

  async checkHealth(): Promise<void> {
    await this.database.db.execute(sql`select 1`);
  }
}
