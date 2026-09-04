import type { ReasoningEffort } from "@ucdavis/caes-ai-protocol";
import { eq } from "drizzle-orm";

import type { CaesAiDatabase } from "../database/client.js";
import { assistantRuns, assistantToolCalls } from "../database/schema.js";
import type { NormalizedTokenUsage } from "../providers/model-provider.js";

export interface RunStarted {
  id: string;
  applicationId: string;
  sessionId: string;
  clientRunId: string;
  threadId: string;
  provider: string;
  transport: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  startedAt: Date;
}

export interface RunFinished {
  id: string;
  outcome: string;
  errorCode?: string;
  durationMs: number;
  usage?: NormalizedTokenUsage;
  completedAt: Date;
}

export interface ToolCallCompleted {
  id: string;
  applicationId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  risk: string;
  outcome: "complete" | "error" | "cancelled";
  errorCode?: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
}

export interface OperationalStore {
  startRun(run: RunStarted): Promise<void>;
  finishRun(run: RunFinished): Promise<void>;
  recordToolCall(toolCall: ToolCallCompleted): Promise<void>;
}

export class NoopOperationalStore implements OperationalStore {
  async startRun(_run: RunStarted): Promise<void> {}
  async finishRun(_run: RunFinished): Promise<void> {}
  async recordToolCall(_toolCall: ToolCallCompleted): Promise<void> {}
}

export class PostgresOperationalStore implements OperationalStore {
  constructor(private readonly database: CaesAiDatabase) {}

  async startRun(run: RunStarted): Promise<void> {
    await this.database.db.insert(assistantRuns).values({
      id: run.id,
      sessionId: run.sessionId,
      applicationId: run.applicationId,
      clientRunId: run.clientRunId,
      threadId: run.threadId,
      provider: run.provider,
      transport: run.transport,
      model: run.model,
      reasoningEffort: run.reasoningEffort,
      startedAt: run.startedAt,
    });
  }

  async finishRun(run: RunFinished): Promise<void> {
    await this.database.db
      .update(assistantRuns)
      .set({
        outcome: run.outcome,
        errorCode: run.errorCode,
        durationMs: run.durationMs,
        inputTokens: run.usage?.inputTokens,
        outputTokens: run.usage?.outputTokens,
        totalTokens: run.usage?.totalTokens,
        reasoningTokens: run.usage?.reasoningTokens,
        cachedInputTokens: run.usage?.cachedInputTokens,
        completedAt: run.completedAt,
      })
      .where(eq(assistantRuns.id, run.id));
  }

  async recordToolCall(toolCall: ToolCallCompleted): Promise<void> {
    await this.database.db.insert(assistantToolCalls).values({
      ...toolCall,
    });
  }
}
