import { metrics, trace } from "@opentelemetry/api";
import type { ReasoningEffort } from "@ucdavis/caes-ai-protocol";
import {
  EventType,
  type AnyChatMiddleware,
  type AnyTextAdapter,
  type StreamChunk,
} from "@tanstack/ai";
import { otelMiddleware } from "@tanstack/ai/middlewares/otel";
import {
  OpenAITextAdapter,
  type OpenAIChatModel,
} from "@tanstack/ai-openai";

import type { ServerConfig } from "../config.js";

export interface ProviderRunContext {
  applicationId: string;
  sessionId: string;
  runId: string;
}

export interface ModelProvider {
  readonly name: string;
  readonly transport: string;
  createAdapter(model: string): AnyTextAdapter;
  supportedReasoningEfforts(model: string): readonly ReasoningEffort[];
  modelOptions(effort: ReasoningEffort): Record<string, unknown>;
  middleware(context: ProviderRunContext): AnyChatMiddleware[];
}

export class OpenAIResponsesProvider implements ModelProvider {
  readonly name = "openai" as const;
  readonly transport = "responses" as const;

  constructor(private readonly config: ServerConfig) {}

  createAdapter(model: string): AnyTextAdapter {
    const typedModel = model as OpenAIChatModel;
    return new OpenAITextAdapter(
      { apiKey: this.config.openAiApiKey, maxRetries: 0 },
      typedModel,
    ) as AnyTextAdapter;
  }

  supportedReasoningEfforts(model: string): readonly ReasoningEffort[] {
    const configured = this.config.modelReasoningEfforts?.[model];
    if (configured) return configured;
    return ["none", "low", "medium", "high"];
  }

  modelOptions(effort: ReasoningEffort): Record<string, unknown> {
    return { reasoning: { effort } };
  }

  middleware(context: ProviderRunContext): AnyChatMiddleware[] {
    return [otelMiddleware({
      tracer: trace.getTracer("caes-ai.ai-server"),
      meter: metrics.getMeter("caes-ai.ai-server"),
      captureContent: false,
      attributeEnricher: () => ({
        "caes-ai.application.id": context.applicationId,
        "caes-ai.session.id": context.sessionId,
        "caes-ai.run.id": context.runId,
      }),
    })];
  }
}

export interface ProviderRetryOptions {
  attempts: number;
  baseDelayMs: number;
  signal: AbortSignal;
  canRetry: () => boolean;
  onRetry?: (details: { attempt: number; errorCode: string }) => void;
}

/**
 * Retries only while RUN_STARTED is the sole buffered event. Once any model
 * content, tool event, or other observable output exists, the run is committed.
 */
export async function* retryProviderStream(
  createStream: () => AsyncIterable<StreamChunk>,
  options: ProviderRetryOptions,
): AsyncIterable<StreamChunk> {
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    options.signal.throwIfAborted();
    const buffered: StreamChunk[] = [];
    let committed = false;
    let retryRequested = false;
    try {
      for await (const chunk of createStream()) {
        if (!committed && chunk.type === EventType.RUN_STARTED) {
          buffered.push(chunk);
          continue;
        }
        if (
          !committed &&
          chunk.type === EventType.RUN_ERROR &&
          attempt < options.attempts &&
          !options.signal.aborted &&
          options.canRetry() &&
          isRetryableProviderCode(chunk.code)
        ) {
          options.onRetry?.({
            attempt: attempt + 1,
            errorCode: chunk.code || "provider_error",
          });
          await retryDelay(options.baseDelayMs, attempt, options.signal);
          retryRequested = true;
          break;
        }

        if (!committed) {
          committed = true;
          for (const pending of buffered.splice(0)) yield pending;
        }
        yield chunk;
      }
      if (committed) return;
      if (retryRequested) continue;
      if (buffered.length > 0) {
        for (const pending of buffered) yield pending;
      }
      return;
    } catch (error) {
      if (
        committed ||
        attempt >= options.attempts ||
        !options.canRetry() ||
        options.signal.aborted ||
        !isRetryableProviderError(error)
      ) {
        for (const pending of buffered) yield pending;
        throw error;
      }
      options.onRetry?.({
        attempt: attempt + 1,
        errorCode: providerErrorCode(error),
      });
      await retryDelay(options.baseDelayMs, attempt, options.signal);
    }
  }
}

export interface NormalizedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export function normalizeTokenUsage(usage: unknown): NormalizedTokenUsage | undefined {
  if (Array.isArray(usage)) {
    const entries = usage.filter(
      (value): value is Record<string, unknown> => value !== null && typeof value === "object",
    );
    if (entries.length === 0) return undefined;
    return sumUsage(entries, {
      inputTokens: "inputTokens",
      outputTokens: "outputTokens",
      totalTokens: "totalTokens",
      reasoningTokens: "reasoningTokens",
      cachedInputTokens: "cachedInputTokens",
    });
  }
  if (usage === null || typeof usage !== "object") return undefined;
  const value = usage as Record<string, unknown>;
  const normalized = sumUsage([value], {
    inputTokens: "promptTokens",
    outputTokens: "completionTokens",
    totalTokens: "totalTokens",
  });
  const completionDetails = value.completionTokensDetails;
  const promptDetails = value.promptTokensDetails;
  return {
    ...normalized,
    ...numberProperty(completionDetails, "reasoningTokens", "reasoningTokens"),
    ...numberProperty(promptDetails, "cachedTokens", "cachedInputTokens"),
  };
}

function sumUsage(
  entries: Record<string, unknown>[],
  fields: Record<string, string>,
): NormalizedTokenUsage {
  const result: Record<string, number> = {};
  for (const [outputName, inputName] of Object.entries(fields)) {
    const values = entries
      .map((entry) => entry[inputName])
      .filter((value): value is number => typeof value === "number");
    if (values.length > 0) {
      result[outputName] = values.reduce((total, value) => total + value, 0);
    }
  }
  return result;
}

function numberProperty(
  value: unknown,
  inputName: string,
  outputName: string,
): Record<string, number> {
  if (value === null || typeof value !== "object") return {};
  const number = (value as Record<string, unknown>)[inputName];
  return typeof number === "number" ? { [outputName]: number } : {};
}

function isRetryableProviderCode(code: string | undefined): boolean {
  if (!code) return true;
  return !/(auth|permission|invalid|content|not_found)/i.test(code);
}

function isRetryableProviderError(error: unknown): boolean {
  return !(
    error instanceof DOMException && error.name === "AbortError"
  ) && isRetryableProviderCode(providerErrorCode(error));
}

function providerErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return error instanceof Error ? error.name : "provider_error";
}

async function retryDelay(
  baseDelayMs: number,
  attempt: number,
  signal: AbortSignal,
): Promise<void> {
  const delay = baseDelayMs * 2 ** (attempt - 1);
  if (delay === 0) return;
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The retry delay was aborted.", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The retry delay was aborted.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
