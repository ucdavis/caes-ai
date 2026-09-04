import { z } from "zod";

const id = z.string().min(1).max(256);
const name = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const object = z.record(z.string(), z.unknown());
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const commonBinding = {
  v: z.literal(1), interruptId: id, toolName: name, toolCallId: id,
  responseSchemaHash: hash, interruptedRunId: id.optional(),
  generation: z.number().int().nonnegative().optional(),
};
const binding = z.discriminatedUnion("kind", [
  z.object({ ...commonBinding, kind: z.literal("tool-approval"), originalArgs: z.unknown(),
    inputSchemaHash: hash, approvalSchemaHash: hash }).strict(),
  z.object({ ...commonBinding, kind: z.literal("client-tool-execution"), outputSchemaHash: hash }).strict(),
]);
const interruptMetadata = z.object({
  kind: z.enum(["approval", "client_tool"]), toolName: name, input: z.unknown(),
  "tanstack:interruptBinding": binding,
}).strict();
const interrupt = z.object({
  id, reason: z.string(), message: z.string().optional(), toolCallId: id,
  responseSchema: object, expiresAt: z.string().datetime({ offset: true }).optional(),
  metadata: interruptMetadata,
}).strict();
const toolCall = z.object({
  id, type: z.literal("function"),
  function: z.object({ name, arguments: z.string() }).strict(),
  encryptedValue: z.string().optional(),
}).strict();
const messageMetadata = z.object({ tanstack: z.object({
  createdAt: z.string().datetime({ offset: true }).optional(), model: z.string().optional(),
  signature: z.string().optional(), toolCallMetadata: object.optional(),
  toolResult: z.object({ id: id.optional(), createdAt: z.string().optional() }).strict().optional(),
}).strict().optional() }).strict();
const messageBase = { id, name: z.string().optional(), encryptedValue: z.string().optional(), metadata: messageMetadata.optional() };
// Version 1 supports text and tool messages. Multimodal and activity messages need a future profile.
export const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({ ...messageBase, role: z.literal("user"), content: z.string() }).strict(),
  z.object({ ...messageBase, role: z.literal("assistant"), content: z.string().optional(), toolCalls: z.array(toolCall).max(32).optional() }).strict(),
  z.object({ ...messageBase, role: z.literal("tool"), content: z.string(), toolCallId: id, error: z.string().optional() }).strict(),
  z.object({ ...messageBase, role: z.literal("reasoning"), content: z.string() }).strict(),
]);
export const chatResumeSchema = z.object({
  interruptId: id, status: z.enum(["resolved", "cancelled"]), payload: z.unknown().optional(),
}).strict();
export const chatRequestEnvelopeSchema = z.object({
  protocolVersion: z.literal(1), threadId: id, runId: id, parentRunId: id.optional(),
  state: z.unknown().optional(), messages: z.array(chatMessageSchema).max(512),
  tools: z.array(z.object({ name, description: z.string(), parameters: object.optional(), metadata: object.optional() }).strict()).max(32),
  context: z.array(z.object({ description: z.string(), value: z.string() }).strict()).max(64),
  forwardedProps: z.object({ reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional() }).strict().optional(),
  resume: z.array(chatResumeSchema).max(64).optional(),
}).strict();

const patch = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["add", "replace", "test"]), path: z.string(), value: z.unknown() }).strict(),
  z.object({ op: z.literal("remove"), path: z.string() }).strict(),
  z.object({ op: z.enum(["move", "copy"]), path: z.string(), from: z.string() }).strict(),
]);
const count = z.number().nonnegative();
const legacyUsage = z.object({
  cost: count.optional(),
  promptTokens: count.optional(), completionTokens: count.optional(), totalTokens: count.optional(),
  promptTokensDetails: z.object({ cachedTokens: count.optional(), audioTokens: count.optional() }).strict().optional(),
  completionTokensDetails: z.object({ reasoningTokens: count.optional(), audioTokens: count.optional(), acceptedPredictionTokens: count.optional(), rejectedPredictionTokens: count.optional() }).strict().optional(),
}).strict();
const usage = z.union([legacyUsage, z.array(z.object({
  provider: z.string().optional(), model: z.string().optional(),
  inputTokens: count.optional(), outputTokens: count.optional(), totalTokens: count.optional(),
  reasoningTokens: count.optional(), cachedInputTokens: count.optional(),
}).strict())]);
const finishReason = z.enum(["stop", "length", "content_filter", "tool_calls"]).nullable();
const runMetadata = z.object({
  model: z.string().optional(), finishReason: finishReason.optional(), usage: legacyUsage.optional(),
  threadId: id.optional(), runId: id.optional(), sessionId: id.optional(), index: z.number().int().optional(),
  state: z.enum(["input-streaming", "input-available", "approval-requested", "approval-responded", "output-available", "output-error", "output-denied"]).optional(),
  input: z.unknown().optional(),
  interruptErrors: z.array(z.object({
    scope: z.enum(["item", "batch"]), code: z.string(), message: z.string(),
    source: z.enum(["client", "server", "transport"]),
    interruptId: id.optional(), interruptIds: z.array(id).optional(),
  }).strict()).optional(),
}).strict();
const metadata = z.object({ caesAi: z.object({ protocolVersion: z.literal(1) }).strict(), tanstack: runMetadata.optional() }).strict();
const base = { timestamp: z.number().optional(), metadata };
function event<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return z.object({ ...base, type: z.literal(type), ...shape }).strict();
}
const messageId = { messageId: id };
const content = { ...messageId, delta: z.string() };
const outcome = z.discriminatedUnion("type", [
  z.object({ type: z.literal("success") }).strict(),
  z.object({ type: z.literal("interrupt"), interrupts: z.array(interrupt).min(1).max(64) }).strict(),
]);
export const chatStreamEventSchema = z.discriminatedUnion("type", [
  event("TEXT_MESSAGE_START", { ...messageId, role: z.literal("assistant").optional(), name: z.string().optional() }),
  event("TEXT_MESSAGE_CONTENT", content), event("TEXT_MESSAGE_END", messageId),
  event("TEXT_MESSAGE_CHUNK", { messageId: id.optional(), role: z.literal("assistant").optional(), delta: z.string().optional(), name: z.string().optional() }),
  event("TOOL_CALL_START", { toolCallId: id, toolCallName: name, parentMessageId: id.nullable().optional() }),
  event("TOOL_CALL_ARGS", { toolCallId: id, delta: z.string() }),
  event("TOOL_CALL_END", { toolCallId: id, input: z.unknown().optional() }),
  event("TOOL_CALL_CHUNK", { toolCallId: id.optional(), toolCallName: name.optional(), parentMessageId: id.nullable().optional(), delta: z.string().optional() }),
  event("TOOL_CALL_RESULT", { ...messageId, toolCallId: id, content: z.string(), role: z.literal("tool").optional() }),
  event("THINKING_START", { title: z.string().optional() }), event("THINKING_END", {}),
  event("THINKING_TEXT_MESSAGE_START", {}), event("THINKING_TEXT_MESSAGE_CONTENT", { delta: z.string() }), event("THINKING_TEXT_MESSAGE_END", {}),
  event("STATE_SNAPSHOT", { snapshot: z.unknown() }), event("STATE_DELTA", { delta: z.array(patch) }),
  event("MESSAGES_SNAPSHOT", { messages: z.array(chatMessageSchema).max(512) }),
  event("ACTIVITY_SNAPSHOT", { ...messageId, activityType: z.string(), content: object, replace: z.boolean().optional() }),
  event("ACTIVITY_DELTA", { ...messageId, activityType: z.string(), patch: z.array(patch) }),
  event("RAW", { event: z.unknown(), source: z.string().optional() }),
  event("CUSTOM", { name: z.string().min(1), value: z.unknown() }),
  event("RUN_STARTED", { threadId: id, runId: id, parentRunId: id.optional() }),
  event("RUN_FINISHED", { threadId: id, runId: id, result: z.unknown().optional(), outcome: outcome.optional(), usage: usage.optional(), model: z.string().optional(), finishReason: finishReason.optional() }),
  event("RUN_ERROR", { message: z.string().min(1), code: z.string().optional(), usage: usage.optional(), threadId: id.optional(), runId: id.optional(), model: z.string().optional(), error: z.object({ message: z.string(), code: z.string().optional() }).strict().optional() }),
  event("STEP_STARTED", { stepName: z.string() }), event("STEP_FINISHED", { stepName: z.string() }),
  event("REASONING_START", messageId), event("REASONING_MESSAGE_START", { ...messageId, role: z.literal("reasoning") }),
  event("REASONING_MESSAGE_CONTENT", content), event("REASONING_MESSAGE_END", messageId),
  event("REASONING_MESSAGE_CHUNK", { messageId: id.optional(), delta: z.string().optional() }), event("REASONING_END", messageId),
  event("REASONING_ENCRYPTED_VALUE", { subtype: z.enum(["tool-call", "message"]), entityId: id, encryptedValue: z.string() }),
]);
export const chatStreamEventTypes = chatStreamEventSchema.options.map((schema) => schema.shape.type.value);
export type ChatRequestEnvelope = z.infer<typeof chatRequestEnvelopeSchema>;
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

/** Remove the transport's documented runtime aliases before checking the owned wire shape. */
export function parseChatRuntimeEvent(value: unknown): ChatStreamEvent {
  if (!value || typeof value !== "object") return chatStreamEventSchema.parse(value);
  const wire = { ...value as Record<string, unknown> };
  const schema = chatStreamEventSchema.options.find((option) => option.shape.type.value === wire.type);
  if (!schema) return chatStreamEventSchema.parse(wire);
  if (wire.type === "TOOL_CALL_START" && wire.toolName === wire.toolCallName) delete wire.toolName;
  const meta = wire.metadata as { tanstack?: Record<string, unknown> } | undefined;
  for (const [key, item] of Object.entries(meta?.tanstack ?? {})) {
    const alias = key === "interruptErrors" ? "tanstack:interruptErrors" : key;
    if (!Object.hasOwn(schema.shape, alias) && JSON.stringify(wire[alias]) === JSON.stringify(item)) delete wire[alias];
  }
  return chatStreamEventSchema.parse(wire);
}
