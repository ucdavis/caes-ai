import { EventType, type AdapterYieldChunk } from "@tanstack/ai";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationToolManifest } from "@ucdavis/caes-ai-protocol";
import { buildApp, type ServerConfig } from "../../../apps/ai-server/src/app.js";
import { scriptedModelProvider } from "../../../apps/ai-server/test/helpers/scripted-model-provider.js";
import { StaticApplicationRegistry } from "../../../apps/ai-server/test/helpers/static-application-registry.js";
import { AssistantProvider, useAssistant } from "../src/context.js";
import { createAssistantClient } from "../src/client.js";

const config: ServerConfig = {
  host: "127.0.0.1", port: 0, publicBaseUrl: "https://central.test", sessionTtlMs: 1800000,
  sessionSweepIntervalMs: 60000, maximumActiveSessions: 100, maximumSessionsPerApplication: 10,
  defaultModel: "test-model", allowedModels: ["test-model"], maximumReasoningEffort: "low",
  openAiApiKey: "synthetic-unused", toolTimeoutMs: 5000, maximumToolResponseBytes: 262144,
  callbackIssuer: "https://central.test", callbackTokenTtlMs: 60000, providerRetryAttempts: 1,
  providerRetryBaseDelayMs: 0, databaseUrl: "postgresql://unused.test/test", allowInsecureCallbacks: false,
};
const descriptor: ApplicationToolManifest = {
  name: "set_filter", description: "Set the page filter.", execution: "client", risk: "ui", needsApproval: false,
  inputSchema: { type: "object", properties: { filter: { type: "string", enum: ["all", "active"] },
    options: { type: "object", properties: { count: { type: "integer" } }, additionalProperties: false } },
  required: ["filter"], additionalProperties: false },
  dataSchema: { type: "object", properties: { applied: { type: "boolean" } }, required: ["applied"], additionalProperties: false },
};

describe("client tool validation through the central HTTP and React boundaries", () => {
  it.each([
    [{ filter: "INVALID" }, { applied: true }, false],
    [{}, { applied: true }, false],
    [{ filter: "all", extra: true }, { applied: true }, false],
    [{ filter: "all", options: { count: "bad" } }, { applied: true }, false],
    [{ filter: "all" }, { applied: "bad" }, true],
    [{ filter: "all" }, { applied: true }, true],
  ])("validates arguments and output (%j, %j)", async (args, result, shouldExecute) => {
    const execute = vi.fn(() => result);
    let assistant!: ReturnType<typeof useAssistant>;
    const modelResults: unknown[] = [];
    const adapter = { ...scriptedModelProvider.createAdapter("test-model"),
      async *chatStream(options: Parameters<ReturnType<typeof scriptedModelProvider.createAdapter>["chatStream"]>[0]): AsyncIterable<AdapterYieldChunk> {
        const { runId = "run", threadId = "thread" } = options;
        yield { type: EventType.RUN_STARTED, runId, threadId };
        if (options.messages.some((message) => message.role === "tool")) {
          modelResults.push(...options.messages.filter((message) => message.role === "tool"));
          yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "stop" as const };
          return;
        }
        yield { type: EventType.TOOL_CALL_START, toolCallId: "call-filter", toolCallName: "set_filter", parentMessageId: "message-filter" };
        yield { type: EventType.TOOL_CALL_ARGS, toolCallId: "call-filter", delta: JSON.stringify(args) };
        yield { type: EventType.TOOL_CALL_END, toolCallId: "call-filter", input: args };
        yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "tool_calls" as const };
      },
    };
    const app = buildApp({ config, modelProvider: { ...scriptedModelProvider, createAdapter: () => adapter },
      applicationRegistry: new StaticApplicationRegistry([{
        id: "example", apiKey: "synthetic-application-key", allowedOrigins: ["https://host.test"],
        toolCallbackUrl: "https://host.test/callback", allowedModels: ["test-model"], maximumReasoningEffort: "low",
      }]),
    });
    const createSession = async () => (await app.inject({ method: "POST", url: "/v1/sessions",
      headers: { authorization: "ApiKey synthetic-application-key" }, payload: {
        protocolVersion: 1, userReference: "example-user", contextToken: "synthetic-context-token",
        instructions: "Use the registered tools.", tools: [descriptor],
        modelPolicy: { requestedModel: null, defaultReasoningEffort: "low", maximumReasoningEffort: "low", allowPerTurnOverride: false },
      },
    })).json();
    const client = createAssistantClient({ createSession, fetchImplementation: async (input, init) => {
      const response = await app.inject({ method: "POST", url: new URL(String(input)).pathname,
        headers: Object.fromEntries(new Headers(init?.headers)), payload: String(init?.body) });
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": String(response.headers["content-type"]), "x-caes-ai-protocol-version": String(response.headers["x-caes-ai-protocol-version"]) } });
    } });
    function Control() { assistant = useAssistant(); return null; }
    const rendered = render(<AssistantProvider eager client={client} createSession={createSession} clientTools={[{ name: "set_filter", execute }]}><Control /></AssistantProvider>);
    try {
      await waitFor(() => expect(assistant.session).toBeDefined());
      await act(async () => { await assistant.send("Set the filter"); });
      const valid = shouldExecute && result.applied === true;
      await waitFor(() => {
        if (valid) expect(modelResults.length).toBeGreaterThan(0);
        else expect(assistant.error).toBeDefined();
      });
      expect(execute).toHaveBeenCalledTimes(shouldExecute ? 1 : 0);
      if (!valid) expect(modelResults).toEqual([]);
    } finally { rendered.unmount(); await app.close(); }
  });
});
