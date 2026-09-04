import { z } from "zod";
export { compileToolSchema } from "./json-schema.js";

export const currentProtocolVersion = 1 as const;
export const caesAiProtocolVersionHeader = "x-caes-ai-protocol-version" as const;

export const protocolVersionSchema = z.literal(currentProtocolVersion);
export type ProtocolVersion = z.infer<typeof protocolVersionSchema>;

export const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const reasoningEffortSchema = z.enum(reasoningEfforts);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export type JsonSchema = Record<string, unknown>;

const jsonSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === "object", {
    message: "Tool schemas must describe an object.",
  });

export const applicationToolManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    description: z.string().regex(/\S/).min(1).max(1_024),
    execution: z.enum(["server", "client"]),
    risk: z.enum(["read", "write", "ui"]),
    needsApproval: z.boolean(),
    inputSchema: jsonSchema,
    dataSchema: jsonSchema,
    presentation: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        label: z.string().regex(/\S/).min(1).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((tool, context) => {
    if (tool.risk === "write" && !tool.needsApproval) {
      context.addIssue({
        code: "custom",
        message: "Write tools must require approval.",
        path: ["needsApproval"],
      });
    }

    if (tool.execution === "client" && tool.risk === "write") {
      context.addIssue({
        code: "custom",
        message: "Client tools cannot be registered as write tools.",
        path: ["risk"],
      });
    }
  });

export type ApplicationToolManifest = z.infer<typeof applicationToolManifestSchema>;

export const modelPolicyRequestSchema = z.object({
  requestedModel: z.string().regex(/\S/).min(1).nullable(),
  defaultReasoningEffort: reasoningEffortSchema,
  maximumReasoningEffort: reasoningEffortSchema,
  allowPerTurnOverride: z.boolean(),
}).strict();

export type ModelPolicyRequest = z.infer<typeof modelPolicyRequestSchema>;

export const sessionCreationRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    userReference: z.string().regex(/\S/).min(1).max(256),
    contextToken: z.string().min(16).max(8_192),
    instructions: z.string().regex(/\S/).min(1).max(16_384),
    modelPolicy: modelPolicyRequestSchema,
    tools: z.array(applicationToolManifestSchema).max(32),
  })
  .strict()
  .superRefine((request, context) => {
    const names = new Set<string>();
    for (const [index, tool] of request.tools.entries()) {
      if (names.has(tool.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate tool name: ${tool.name}`,
          path: ["tools", index, "name"],
        });
      }
      names.add(tool.name);
    }
  });

export type SessionCreationRequest = z.infer<typeof sessionCreationRequestSchema>;

export const effectiveModelPolicySchema = z
  .object({
    model: z.string().min(1),
    defaultReasoningEffort: reasoningEffortSchema,
    maximumReasoningEffort: reasoningEffortSchema,
    allowedReasoningEfforts: z.array(reasoningEffortSchema).min(1),
  })
  .strict();

export type EffectiveModelPolicy = z.infer<typeof effectiveModelPolicySchema>;

export const sessionCreationResponseSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    sessionId: z.string().uuid(),
    accessToken: z.string().min(32),
    expiresAt: z.string().datetime({ offset: true }),
    chatUrl: z.string().url(),
    modelPolicy: effectiveModelPolicySchema,
    toolManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    tools: z.array(applicationToolManifestSchema).max(32),
  })
  .strict();

export type SessionCreationResponse = z.infer<typeof sessionCreationResponseSchema>;

export {
  chatMessageSchema, chatResumeSchema, chatRequestEnvelopeSchema,
  chatStreamEventSchema, chatStreamEventTypes,
  parseChatRuntimeEvent,
  type ChatRequestEnvelope, type ChatStreamEvent,
} from "./chat-profile.js";

export const uiEffectSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("invalidate-query"),
      key: z.array(z.unknown()).min(1).max(16),
    })
    .strict(),
  z
    .object({
      type: z.literal("toast"),
      level: z.enum(["success", "info", "error"]),
      message: z.string().regex(/\S/).min(1).max(512),
    })
    .strict(),
]);

export type UiEffect = z.infer<typeof uiEffectSchema>;

export const toolOutputEnvelopeSchema = z
  .object({
    data: z.unknown(),
    display: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        props: z.record(z.string(), z.unknown()),
        visibility: z.enum(["inline", "details", "hidden"]).default("details"),
        suppressAssistantText: z.boolean().optional(),
      })
      .strict()
      .optional(),
    uiEffects: z.array(uiEffectSchema).max(16).default([]),
  })
  .strict();

export type ToolOutputEnvelope = z.infer<typeof toolOutputEnvelopeSchema>;

export const toolExecutionRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    sessionId: z.string().uuid(),
    toolCallId: z.string().min(1).max(256),
    toolName: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    toolManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    arguments: z.unknown(),
    contextToken: z.string().min(16).max(8_192),
  })
  .strict();

export type ToolExecutionRequest = z.infer<typeof toolExecutionRequestSchema>;

export const caesAiErrorSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    message: z.string().min(1).max(1_024),
    retryable: z.boolean(),
  })
  .strict();

export type CaesAiError = z.infer<typeof caesAiErrorSchema>;

export const caesAiErrorResponseSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    error: caesAiErrorSchema,
  })
  .strict();

export type CaesAiErrorResponse = z.infer<typeof caesAiErrorResponseSchema>;

export const toolExecutionResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      protocolVersion: protocolVersionSchema,
      ok: z.literal(true),
      output: toolOutputEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      ok: z.literal(false),
      error: caesAiErrorSchema,
    })
    .strict(),
]);

export type ToolExecutionResponse = z.infer<typeof toolExecutionResponseSchema>;

/**
 * Builds the model-facing output schema for a server tool. Applications own
 * only `data`; CAES AI owns the presentation and host-page effect envelope.
 */
export function createToolOutputSchema(dataSchema: JsonSchema): JsonSchema {
  return {
    type: "object",
    properties: {
      data: dataSchema,
      display: {
        type: "object",
        properties: {
          kind: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
          props: { type: "object" },
          visibility: { type: "string", enum: ["inline", "details", "hidden"] },
          suppressAssistantText: { type: "boolean" },
        },
        required: ["kind", "props"],
        additionalProperties: false,
      },
      uiEffects: {
        type: "array",
        maxItems: 16,
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { const: "invalidate-query" },
                key: { type: "array", minItems: 1, maxItems: 16 },
              },
              required: ["type", "key"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "toast" },
                level: { type: "string", enum: ["success", "info", "error"] },
                message: { type: "string", minLength: 1, maxLength: 512 },
              },
              required: ["type", "level", "message"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["data", "uiEffects"],
    additionalProperties: false,
  };
}
