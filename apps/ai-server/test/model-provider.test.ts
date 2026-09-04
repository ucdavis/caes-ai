import { describe, expect, it, vi } from "vitest";
import { EventType, type StreamChunk } from "@tanstack/ai";

import {
  OpenAIResponsesProvider,
  normalizeTokenUsage,
  retryProviderStream,
} from "../src/providers/model-provider.js";
import type { ServerConfig } from "../src/config.js";

function chunk(value: Record<string, unknown>): StreamChunk {
  return value as StreamChunk;
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const value of stream) chunks.push(value);
  return chunks;
}

describe("model provider boundary", () => {
  it("exposes only the OpenAI Responses runtime transport", () => {
    const provider = new OpenAIResponsesProvider({
      openAiApiKey: "unused-test-key",
    } as ServerConfig);

    expect(provider.name).toBe("openai");
    expect(provider.transport).toBe("responses");
    expect(provider.modelOptions("medium")).toEqual({
      reasoning: { effort: "medium" },
    });
  });

  it("retries a transient provider failure before observable output", async () => {
    let run = 0;
    const onRetry = vi.fn();
    const createStream = async function* () {
      run++;
      yield chunk({ type: EventType.RUN_STARTED, runId: "run-1", threadId: "thread-1" });
      if (run === 1) {
        yield chunk({ type: EventType.RUN_ERROR, code: "rate_limit", message: "busy" });
        return;
      }
      yield chunk({ type: EventType.RUN_FINISHED, runId: "run-1", threadId: "thread-1" });
    };

    const chunks = await collect(retryProviderStream(createStream, {
      attempts: 2,
      baseDelayMs: 0,
      signal: new AbortController().signal,
      canRetry: () => true,
      onRetry,
    }));

    expect(run).toBe(2);
    expect(chunks.map((value) => value.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, errorCode: "rate_limit" });
  });

  it("does not retry after output or when a mutation may have started", async () => {
    const withOutput = vi.fn(async function* () {
      yield chunk({ type: EventType.RUN_STARTED, runId: "run-1", threadId: "thread-1" });
      yield chunk({
        type: EventType.TEXT_MESSAGE_START,
        messageId: "message-1",
        role: "assistant",
      });
      yield chunk({ type: EventType.RUN_ERROR, code: "rate_limit", message: "busy" });
    });
    const outputChunks = await collect(retryProviderStream(withOutput, {
      attempts: 2,
      baseDelayMs: 0,
      signal: new AbortController().signal,
      canRetry: () => true,
    }));
    expect(withOutput).toHaveBeenCalledTimes(1);
    expect(outputChunks.at(-1)?.type).toBe(EventType.RUN_ERROR);

    const beforeMutationOutput = vi.fn(async function* () {
      yield chunk({ type: EventType.RUN_STARTED, runId: "run-2", threadId: "thread-1" });
      yield chunk({ type: EventType.RUN_ERROR, code: "rate_limit", message: "busy" });
    });
    await collect(retryProviderStream(beforeMutationOutput, {
      attempts: 2,
      baseDelayMs: 0,
      signal: new AbortController().signal,
      canRetry: () => false,
    }));
    expect(beforeMutationOutput).toHaveBeenCalledTimes(1);
  });

  it("does not retry permanent thrown provider errors", async () => {
    const createStream = vi.fn(async function* () {
      yield chunk({ type: EventType.RUN_STARTED, runId: "run-1", threadId: "thread-1" });
      throw Object.assign(new Error("invalid key"), { code: "authentication_error" });
    });

    await expect(collect(retryProviderStream(createStream, {
      attempts: 2,
      baseDelayMs: 0,
      signal: new AbortController().signal,
      canRetry: () => true,
    }))).rejects.toThrow("invalid key");
    expect(createStream).toHaveBeenCalledTimes(1);
  });

  it("normalizes TanStack and AG-UI token usage", () => {
    expect(normalizeTokenUsage({
      promptTokens: 10,
      completionTokens: 4,
      totalTokens: 14,
      promptTokensDetails: { cachedTokens: 3 },
      completionTokensDetails: { reasoningTokens: 2 },
    })).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
      reasoningTokens: 2,
    });
    expect(normalizeTokenUsage([
      { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
      { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
    ])).toEqual({ inputTokens: 10, outputTokens: 3, totalTokens: 13 });
  });

  it.each([EventType.TEXT_MESSAGE_CONTENT, EventType.TOOL_CALL_START])(
    "never replays %s after a thrown transient error",
    async (type) => {
      const failure = Object.assign(new Error("connection lost"), { code: "ECONNRESET" });
      const source = vi.fn(async function* () {
        yield chunk({ type: EventType.RUN_STARTED, runId: "run", threadId: "thread" });
        yield chunk({ type, messageId: "message", delta: "visible", toolCallId: "call", toolCallName: "read" });
        throw failure;
      });
      const output: StreamChunk[] = [];
      await expect((async () => {
        for await (const value of retryProviderStream(source, {
          attempts: 3, baseDelayMs: 0, signal: new AbortController().signal, canRetry: () => true,
        })) output.push(value);
      })()).rejects.toBe(failure);
      expect(source).toHaveBeenCalledTimes(1);
      expect(output.map((value) => value.type)).toEqual([EventType.RUN_STARTED, type]);
    },
  );

  it("retries thrown failures only before output and stops on abort or mutation", async () => {
    let attempt = 0;
    const source = vi.fn(async function* () {
      yield chunk({ type: EventType.RUN_STARTED, runId: "run", threadId: "thread" });
      if (++attempt === 1) throw new Error("temporary failure");
      yield chunk({ type: EventType.RUN_FINISHED, runId: "run", threadId: "thread" });
    });
    const options = { attempts: 3, baseDelayMs: 0, signal: new AbortController().signal, canRetry: () => true };
    expect((await collect(retryProviderStream(source, options))).map((value) => value.type))
      .toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
    expect(source).toHaveBeenCalledTimes(2);
    attempt = 0;
    source.mockClear();
    await expect(collect(retryProviderStream(source, { ...options, canRetry: () => false }))).rejects.toThrow();
    expect(source).toHaveBeenCalledTimes(1);
    source.mockClear();
    await expect(collect(retryProviderStream(source, { ...options, signal: AbortSignal.abort() }))).rejects.toThrow();
    expect(source).not.toHaveBeenCalled();
  });
});
