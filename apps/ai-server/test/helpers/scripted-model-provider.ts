import { randomUUID } from "node:crypto";

import { reasoningEfforts } from "@ucdavis/caes-ai-protocol";
import {
  EventType,
  type AdapterYieldChunk,
  type AnyTextAdapter,
  type ModelMessage,
  type TextOptions,
} from "@tanstack/ai";

import type { ModelProvider } from "../../src/providers/model-provider.js";

function hasToolResult(messages: readonly ModelMessage[]): boolean {
  const latestUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(latestUserIndex + 1).some((message) => message.role === "tool");
}

async function* scriptedStream(
  options: TextOptions,
): AsyncIterable<AdapterYieldChunk> {
  const runId = options.runId ?? `run-${randomUUID()}`;
  const threadId = options.threadId ?? `thread-${randomUUID()}`;
  const model = options.model;
  yield { type: EventType.RUN_STARTED, runId, threadId, model, timestamp: Date.now() };

  if (!hasToolResult(options.messages)) {
    const toolCallId = `call-${randomUUID()}`;
    const args = { status: "all", resultView: "list" };
    yield {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: "list_todos",
      toolName: "list_todos",
      parentMessageId: `message-${randomUUID()}`,
      model,
      timestamp: Date.now(),
    };
    yield {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(args),
      args: JSON.stringify(args),
      model,
      timestamp: Date.now(),
    };
    yield {
      type: EventType.TOOL_CALL_END,
      toolCallId,
      input: args,
      model,
      timestamp: Date.now(),
    };
    yield {
      type: EventType.RUN_FINISHED,
      runId,
      threadId,
      finishReason: "tool_calls",
      model,
      timestamp: Date.now(),
    };
    return;
  }

  const messageId = `message-${randomUUID()}`;
  const answer = "I found 1 matching Todos.";
  yield {
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
    model,
    timestamp: Date.now(),
  };
  yield {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: answer,
    model,
    timestamp: Date.now(),
  };
  yield { type: EventType.TEXT_MESSAGE_END, messageId, model, timestamp: Date.now() };
  yield {
    type: EventType.RUN_FINISHED,
    runId,
    threadId,
    finishReason: "stop",
    model,
    timestamp: Date.now(),
  };
}

async function* throwingStream(
  options: TextOptions,
): AsyncIterable<AdapterYieldChunk> {
  yield {
    type: EventType.RUN_STARTED,
    runId: options.runId ?? `run-${randomUUID()}`,
    threadId: options.threadId ?? `thread-${randomUUID()}`,
    model: options.model,
    timestamp: Date.now(),
  };
  throw new Error("Sensitive upstream failure details");
}

const adapter: AnyTextAdapter = {
  kind: "text",
  name: "scripted-test-model",
  model: "test-model",
  "~types": undefined as never,
  chatStream: scriptedStream,
  async structuredOutput() {
    throw new Error("Structured output is not implemented by the test adapter.");
  },
};

const throwingAdapter: AnyTextAdapter = {
  ...adapter,
  name: "throwing-test-model",
  chatStream: throwingStream,
};

export const scriptedModelProvider: ModelProvider = {
  name: "test",
  transport: "scripted",
  createAdapter: () => adapter,
  supportedReasoningEfforts: () => reasoningEfforts,
  modelOptions: () => ({}),
  middleware: () => [],
};

export interface ToolCallingProvider {
  provider: ModelProvider;
  toolNames: string[][];
  toolResults: unknown[];
}

/** Calls one named tool, then answers, recording what each model turn received. */
export function toolCallingProvider(toolName: string, args: unknown): ToolCallingProvider {
  const toolNames: string[][] = [];
  const toolResults: unknown[] = [];
  const toolAdapter: AnyTextAdapter = {
    ...adapter,
    async *chatStream(options) {
      const runId = options.runId ?? "run";
      const threadId = options.threadId ?? "thread";
      toolNames.push((options.tools ?? []).map((tool) => tool.name));
      yield { type: EventType.RUN_STARTED, runId, threadId, model: options.model, timestamp: Date.now() };
      const results = options.messages.filter((message) => message.role === "tool");
      if (results.length) {
        toolResults.push(...results.map((message) => message.content));
        yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "stop", model: options.model, timestamp: Date.now() };
        return;
      }
      const toolCallId = `call-${randomUUID()}`;
      const delta = JSON.stringify(args);
      yield { type: EventType.TOOL_CALL_START, toolCallId, toolCallName: toolName, parentMessageId: "message-tool" };
      yield { type: EventType.TOOL_CALL_ARGS, toolCallId, delta };
      yield { type: EventType.TOOL_CALL_END, toolCallId, input: args };
      yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "tool_calls", model: options.model, timestamp: Date.now() };
    },
  };
  return {
    provider: { ...scriptedModelProvider, createAdapter: () => toolAdapter },
    toolNames,
    toolResults,
  };
}

export const throwingModelProvider: ModelProvider = {
  ...scriptedModelProvider,
  createAdapter: () => throwingAdapter,
};
