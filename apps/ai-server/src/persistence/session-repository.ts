import { and, count, eq, gt } from "drizzle-orm";

import type {
  ApplicationToolManifest,
  EffectiveModelPolicy,
} from "@ucdavis/caes-ai-protocol";

import type { RegisteredApplication } from "../applications/registry.js";
import type { CaesAiDatabase } from "../database/client.js";
import { assistantSessions } from "../database/schema.js";

export interface StoredSession {
  id: string;
  application: RegisteredApplication;
  tokenHash: Buffer;
  userReferenceHash: string;
  contextToken: string;
  instructions: string;
  tools: ApplicationToolManifest[];
  toolManifestHash: string;
  modelPolicy: EffectiveModelPolicy;
  allowPerTurnOverride: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionRepository {
  insert(session: StoredSession): Promise<void>;
  find(sessionId: string): Promise<StoredSession | undefined>;
  removeExpired(now: Date): Promise<void>;
  countActive(now: Date, applicationId?: string): Promise<number>;
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #sessions = new Map<string, StoredSession>();

  async insert(session: StoredSession): Promise<void> {
    this.#sessions.set(session.id, structuredClone(session));
  }

  async find(sessionId: string): Promise<StoredSession | undefined> {
    const session = this.#sessions.get(sessionId);
    return session ? structuredClone(session) : undefined;
  }

  async removeExpired(now: Date): Promise<void> {
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id);
    }
  }

  async countActive(now: Date, applicationId?: string): Promise<number> {
    return [...this.#sessions.values()].filter(
      (session) =>
        session.expiresAt > now &&
        (!applicationId || session.application.id === applicationId),
    ).length;
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly database: CaesAiDatabase) {}

  async insert(session: StoredSession): Promise<void> {
    await this.database.db.insert(assistantSessions).values({
      id: session.id,
      applicationId: session.application.id,
      tokenHash: session.tokenHash,
      userReferenceHash: session.userReferenceHash,
      contextToken: session.contextToken,
      instructions: session.instructions,
      applicationSnapshot: session.application,
      toolManifest: session.tools,
      toolManifestHash: session.toolManifestHash,
      modelPolicy: session.modelPolicy,
      allowPerTurnOverride: session.allowPerTurnOverride,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });
  }

  async find(sessionId: string): Promise<StoredSession | undefined> {
    const [row] = await this.database.db
      .select()
      .from(assistantSessions)
      .where(eq(assistantSessions.id, sessionId))
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      application: row.applicationSnapshot as RegisteredApplication,
      tokenHash: row.tokenHash,
      userReferenceHash: row.userReferenceHash,
      contextToken: row.contextToken,
      instructions: row.instructions,
      tools: row.toolManifest as ApplicationToolManifest[],
      toolManifestHash: row.toolManifestHash,
      modelPolicy: row.modelPolicy as EffectiveModelPolicy,
      allowPerTurnOverride: row.allowPerTurnOverride,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  // PostgreSQL sessions are retained as operational records after expiration.
  async removeExpired(_now: Date): Promise<void> {}

  async countActive(now: Date, applicationId?: string): Promise<number> {
    const where = applicationId
      ? and(
          gt(assistantSessions.expiresAt, now),
          eq(assistantSessions.applicationId, applicationId),
        )
      : gt(assistantSessions.expiresAt, now);
    const [result] = await this.database.db
      .select({ value: count() })
      .from(assistantSessions)
      .where(where);
    return result?.value ?? 0;
  }
}
