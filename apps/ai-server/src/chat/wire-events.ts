import type { StreamChunk } from "@tanstack/ai";
import {
  chatStreamEventTypes,
  currentProtocolVersion,
  parseChatRuntimeEvent,
  type ChatStreamEvent,
} from "@ucdavis/caes-ai-protocol";

// Diagnostic paths must never copy arbitrary provider keys or field values.
const diagnosticFields = new Set([
  "metadata", "tanstack", "caesAi", "protocolVersion", "itemId", "toolName",
  "toolCallName", "toolCallId", "parentMessageId", "messageId", "model", "input",
  "delta", "content", "timestamp", "runId", "threadId", "state", "snapshot",
  "messages", "outcome", "usage", "type",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function diagnosticPaths(error: unknown): string[] {
  const issues = record(error)?.issues;
  if (!Array.isArray(issues)) return [];
  return [...new Set(issues.slice(0, 12).flatMap((value: unknown) => {
    const issue = record(value);
    const path: unknown[] = Array.isArray(issue?.path) ? issue.path.slice(0, 8) : [];
    const keys: unknown[] = issue?.code === "unrecognized_keys" && Array.isArray(issue.keys)
      ? issue.keys.slice(0, 8) : [undefined];
    return keys.map((key: unknown) => [...path, ...(key === undefined ? [] : [key])]
      .map((part: unknown) => typeof part === "number" ? "[]"
        : typeof part === "string" && diagnosticFields.has(part) ? part : "<unknown>")
      .join(".") || "<event>");
  }))].slice(0, 12);
}

export class ChatStreamProtocolError extends Error {
  constructor(readonly eventType: string, readonly fieldPaths: readonly string[]) {
    super("The model stream did not match the CAES AI wire contract.");
  }
}

/** Translate provider output only after TanStack has consumed the original event. */
export function toChatWireEvent(chunk: StreamChunk): ChatStreamEvent {
  const wire: Record<string, unknown> = { ...chunk };
  const metadata = { ...record(chunk.metadata) };
  const eventType = chatStreamEventTypes.includes(chunk.type) ? chunk.type : "unknown";
  if (chunk.metadata != null && !record(chunk.metadata)) {
    throw new ChatStreamProtocolError(eventType, ["metadata"]);
  }

  if (chunk.type === "TOOL_CALL_START") {
    // The provider retains its Responses item ID internally. Existing v1 clients
    // replay tool calls by call ID and do not accept this provider-only field.
    delete metadata.itemId;
  } else if (chunk.type === "TOOL_CALL_END") {
    const tanstack = record(metadata.tanstack);
    const names = [wire.toolName, wire.toolCallName, tanstack?.toolName, tanstack?.toolCallName]
      .filter((value) => value !== undefined);
    if (names.some((value) => typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) ||
        new Set(names).size > 1) {
      throw new ChatStreamProtocolError(eventType, ["toolName", "toolCallName"]);
    }
    delete wire.toolName;
    delete wire.toolCallName;
    if (tanstack) {
      const remaining = { ...tanstack };
      delete remaining.toolName;
      delete remaining.toolCallName;
      metadata.tanstack = remaining;
    }
  }

  wire.metadata = { ...metadata, caesAi: { protocolVersion: currentProtocolVersion } };
  try {
    return parseChatRuntimeEvent(wire);
  } catch (error) {
    throw new ChatStreamProtocolError(eventType, diagnosticPaths(error));
  }
}
