import { describe, expect, it, vi } from "vitest";

import { currentProtocolVersion } from "@ucdavis/caes-ai-protocol";

import type { ServerConfig } from "../src/config.js";
import type { RegisteredApplication } from "../src/applications/registry.js";
import type { CallbackTokenIssuer } from "../src/security/callback-tokens.js";
import { SessionStore } from "../src/sessions.js";
import { scriptedModelProvider } from "./helpers/scripted-model-provider.js";
import { createDynamicTools } from "../src/tools/dynamic-tools.js";
import { ToolGatewayClient, ToolGatewayError } from "../src/tools/gateway.js";

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  publicBaseUrl: "http://localhost:4310",
  sessionTtlMs: 60_000,
  sessionSweepIntervalMs: 60_000,
  maximumActiveSessions: 100,
  maximumSessionsPerApplication: 10,
  defaultModel: "test-model",
  allowedModels: ["test-model"],
  maximumReasoningEffort: "medium",
  openAiApiKey: "unused-test-key",
  toolTimeoutMs: 15,
  maximumToolResponseBytes: 2_048,
  callbackIssuer: "http://caes-ai.test",
  callbackTokenTtlMs: 60_000,
  providerRetryAttempts: 2,
  providerRetryBaseDelayMs: 0,
  databaseUrl: "postgresql://unused.test/caes-ai",
};

const application: RegisteredApplication = {
  id: "sample",
  toolCallbackUrl: "http://sample.test/tools",
  allowedOrigins: [],
  allowedModels: ["test-model"],
  maximumReasoningEffort: "medium",
};

const callbackTokens: CallbackTokenIssuer = {
  issuer: "http://caes-ai.test",
  issue: vi.fn(async () => "signed-callback-token"),
  getJwks: () => ({ keys: [] }),
};

async function session() {
  return (await new SessionStore(config, scriptedModelProvider).create(application, {
    protocolVersion: currentProtocolVersion,
    userReference: "user",
    contextToken: "signed-context-token",
    instructions: "Use tools.",
    modelPolicy: {
      requestedModel: null,
      defaultReasoningEffort: "low",
      maximumReasoningEffort: "medium",
      allowPerTurnOverride: true,
    },
    tools: [{
      name: "read_items",
      description: "Read items.",
      execution: "server",
      risk: "read",
      needsApproval: false,
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer" } },
        required: ["limit"],
        additionalProperties: false,
      },
      dataSchema: {
        type: "object",
        properties: {
          count: { type: "integer" },
        },
        required: ["count"],
        additionalProperties: false,
      },
    }, {
      name: "choose_view",
      description: "Choose a local view.",
      execution: "client",
      risk: "ui",
      needsApproval: false,
      inputSchema: { type: "object" },
      dataSchema: { type: "object" },
    }],
  })).record;
}

describe("application tool gateway", () => {
  it("does not sign or dispatch an already-cancelled call", async () => {
    const issue = vi.fn<CallbackTokenIssuer["issue"]>();
    const fetchMock = vi.fn<typeof fetch>();
    const gateway = new ToolGatewayClient(config, { ...callbackTokens, issue }, fetchMock);
    await expect(gateway.execute(await session(), "read_items", "call-cancelled", { limit: 5 }, "run", AbortSignal.abort()))
      .rejects.toMatchObject({ code: "tool_cancelled", retryable: false });
    expect(issue).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates input before making a callback", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const gateway = new ToolGatewayClient(config, callbackTokens, fetchMock);
    await expect(gateway.execute(await session(), "read_items", "call-1", { limit: "bad" }))
      .rejects.toMatchObject({ code: "invalid_tool_arguments" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticates the callback and validates its output", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer signed-callback-token");
      expect(new Headers(init?.headers).get("x-caes-ai-tool-call-id")).toBe("call-2");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        protocolVersion: currentProtocolVersion,
        toolCallId: "call-2",
        toolName: "read_items",
        toolManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      return Response.json({
        protocolVersion: currentProtocolVersion,
        ok: true,
        output: { data: { count: 3 }, uiEffects: [] },
      });
    });
    const gateway = new ToolGatewayClient(config, callbackTokens, fetchMock);
    await expect(gateway.execute(await session(), "read_items", "call-2", { limit: 5 }))
      .resolves.toEqual({ data: { count: 3 }, uiEffects: [] });
  });

  it("rejects callback data outside the registered output schema", async () => {
    const gateway = new ToolGatewayClient(config, callbackTokens, async () =>
      Response.json({
        protocolVersion: currentProtocolVersion,
        ok: true,
        output: { data: { wrong: true }, uiEffects: [] },
      }));
    await expect(gateway.execute(await session(), "read_items", "call-3", { limit: 5 }))
      .rejects.toMatchObject({ code: "invalid_tool_output" });
  });

  it("turns application errors into safe tool errors", async () => {
    const gateway = new ToolGatewayClient(config, callbackTokens, async () => Response.json({
      protocolVersion: currentProtocolVersion,
      ok: false,
      error: { code: "invalid_tool_arguments", message: "Limit is too large.", retryable: false },
    }));
    await expect(gateway.execute(await session(), "read_items", "call-4", { limit: 5 }))
      .rejects.toEqual(new ToolGatewayError("invalid_tool_arguments", "Limit is too large.", false));
  });

  it("enforces the callback timeout", async () => {
    const pendingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const gateway = new ToolGatewayClient(config, callbackTokens, pendingFetch);
    await expect(gateway.execute(await session(), "read_items", "call-5", { limit: 5 }))
      .rejects.toMatchObject({ code: "tool_timeout" });
  });

  it("converts the immutable manifest into server and client TanStack tools", async () => {
    const current = await session();
    const gateway = new ToolGatewayClient(config, callbackTokens, vi.fn<typeof fetch>());
    const tools = createDynamicTools(current, gateway);
    expect(tools.map((tool) => [
      tool.name,
      (tool as typeof tool & { __toolSide: string }).__toolSide,
    ])).toEqual([
      ["read_items", "server"],
      ["choose_view", "client"],
    ]);
  });
});
