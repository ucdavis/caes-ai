import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  chatRequestEnvelopeSchema,
  chatStreamEventSchema,
  currentProtocolVersion,
  caesAiErrorResponseSchema,
  sessionCreationResponseSchema,
  sessionCreationRequestSchema,
  toolExecutionRequestSchema,
  toolExecutionResponseSchema,
  toolOutputEnvelopeSchema,
} from "../src/index.js";

const fixtureDirectory = new URL("../../../contracts/v1/fixtures/", import.meta.url);

interface ProtocolSchemaValidator {
  errors: unknown;
  addSchema: (schema: Record<string, unknown>) => void;
  validate: (schema: string, data: unknown) => boolean;
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureDirectory), "utf8"));
}

describe("dynamic application tool manifest", () => {
  const request = {
    protocolVersion: currentProtocolVersion,
    userReference: "demo-user",
    contextToken: "signed-context-token",
    instructions: "Use tools for current data.",
    modelPolicy: {
      requestedModel: null,
      defaultReasoningEffort: "low" as const,
      maximumReasoningEffort: "medium" as const,
      allowPerTurnOverride: true,
    },
  };

  it("accepts an application-owned read tool without a callback URL", () => {
    const result = sessionCreationRequestSchema.safeParse({
      protocolVersion: currentProtocolVersion,
      userReference: "demo-user",
      contextToken: "signed-context-token",
      instructions: "Use tools for current data.",
      modelPolicy: {
        requestedModel: null,
        defaultReasoningEffort: "low",
        maximumReasoningEffort: "medium",
        allowPerTurnOverride: true,
      },
      tools: [
        {
          name: "read_items",
          description: "Returns the current items.",
          execution: "server",
          risk: "read",
          needsApproval: false,
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          dataSchema: {
            type: "object",
            properties: { count: { type: "integer" } },
            required: ["count"],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate tool names", () => {
    const tool = {
      name: "read_items",
      description: "Returns the current items.",
      execution: "server",
      risk: "read",
      needsApproval: false,
      inputSchema: { type: "object" },
      dataSchema: { type: "object" },
    };
    expect(sessionCreationRequestSchema.safeParse({ ...request, tools: [tool, tool] }).success).toBe(false);
  });

  it("rejects write tools that do not require approval", () => {
    expect(sessionCreationRequestSchema.safeParse({
      ...request,
      tools: [{
        name: "change_item",
        description: "Changes an item.",
        execution: "server",
        risk: "write",
        needsApproval: false,
        inputSchema: { type: "object" },
        dataSchema: { type: "object" },
      }],
    }).success).toBe(false);
  });

  it("rejects client-side write tools", () => {
    expect(sessionCreationRequestSchema.safeParse({
      ...request,
      tools: [{
        name: "change_item",
        description: "Changes an item.",
        execution: "client",
        risk: "write",
        needsApproval: true,
        inputSchema: { type: "object" },
        dataSchema: { type: "object" },
      }],
    }).success).toBe(false);
  });

  it("rejects a callback URL supplied by an application", () => {
    expect(sessionCreationRequestSchema.safeParse({
      ...request,
      callbackUrl: "https://untrusted.example/tools",
      tools: [],
    }).success).toBe(false);
  });

  it("defaults tool displays to collapsed details", () => {
    const output = toolOutputEnvelopeSchema.parse({
      data: { count: 2 },
      display: { kind: "item-list", props: {} },
      uiEffects: [],
    });

    expect(output.display?.visibility).toBe("details");
    expect(toolOutputEnvelopeSchema.safeParse({
      data: {},
      display: { kind: "item-list", props: {}, visibility: "somewhere" },
      uiEffects: [],
    }).success).toBe(false);
  });

  it("requires the frozen manifest hash on a tool callback", () => {
    const callback = {
      protocolVersion: currentProtocolVersion,
      sessionId: "08ab127b-2fd4-4f4c-9348-034f66365d49",
      toolCallId: "call-123",
      toolName: "read_items",
      toolManifestHash: "a".repeat(64),
      arguments: {},
      contextToken: "signed-context-token",
    };

    expect(toolExecutionRequestSchema.safeParse(callback).success).toBe(true);
    expect(toolExecutionRequestSchema.safeParse({
      ...callback,
      toolManifestHash: undefined,
    }).success).toBe(false);
  });

  it("accepts every shared version 1 fixture", () => {
    expect(sessionCreationRequestSchema.parse(
      fixture("session-creation-request.json"),
    )).toBeDefined();
    expect(sessionCreationResponseSchema.parse(
      fixture("session-creation-response.json"),
    )).toBeDefined();
    expect(toolExecutionRequestSchema.parse(
      fixture("tool-execution-request.json"),
    )).toBeDefined();
    expect(toolExecutionResponseSchema.parse(
      fixture("tool-execution-response.json"),
    )).toBeDefined();
    expect(toolExecutionResponseSchema.parse(
      fixture("tool-execution-error-response.json"),
    )).toBeDefined();
    expect(caesAiErrorResponseSchema.parse(
      fixture("error-response.json"),
    )).toBeDefined();
    expect(chatRequestEnvelopeSchema.parse(
      fixture("chat-request-envelope.json"),
    )).toBeDefined();
    expect(chatStreamEventSchema.parse(
      fixture("chat-stream-event.json"),
    )).toBeDefined();
  });

  it("validates every fixture against the authoritative JSON Schema", () => {
    const protocolSchema = JSON.parse(readFileSync(
      new URL("../../../contracts/v1/protocol.schema.json", import.meta.url),
      "utf8",
    )) as Record<string, unknown>;
    const AjvConstructor = Ajv2020 as unknown as new (
      options: Record<string, unknown>,
    ) => ProtocolSchemaValidator;
    const ajv = new AjvConstructor({ strict: true, allErrors: true });
    (addFormats as unknown as (instance: typeof ajv) => unknown)(ajv);
    ajv.addSchema(protocolSchema);

    const fixtures: Array<[string, string]> = [
      ["session-creation-request.json", "sessionCreationRequest"],
      ["session-creation-response.json", "sessionCreationResponse"],
      ["tool-execution-request.json", "toolExecutionRequest"],
      ["tool-execution-response.json", "toolExecutionResponse"],
      ["tool-execution-error-response.json", "toolExecutionResponse"],
      ["error-response.json", "caesAiErrorResponse"],
      ["chat-request-envelope.json", "chatRequestEnvelope"],
      ["chat-stream-event.json", "chatStreamEvent"],
    ];
    for (const [name, definition] of fixtures) {
      const valid = ajv.validate(
        `https://caes.ucdavis.edu/ai/contracts/v1/protocol.schema.json#/$defs/${definition}`,
        fixture(name),
      );
      expect(ajv.errors, name).toBeNull();
      expect(valid, name).toBe(true);
    }
  });

  it("rejects a request from an unsupported protocol version", () => {
    expect(sessionCreationRequestSchema.safeParse({
      ...fixture("session-creation-request.json") as Record<string, unknown>,
      protocolVersion: 2,
    }).success).toBe(false);
  });
});
