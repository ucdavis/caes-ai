import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import { caesAiProtocolVersionHeader, currentProtocolVersion } from "@ucdavis/caes-ai-protocol";

import { buildApp, type BuildAppOptions, type ServerConfig } from "../src/app.js";
import type { OperationalStore } from "../src/persistence/operational-store.js";
import { InMemorySessionRepository } from "../src/persistence/session-repository.js";
import { startLocalMcpServer, type LocalMcpServerOptions } from "./helpers/local-mcp-server.js";
import { toolCallingProvider } from "./helpers/scripted-model-provider.js";
import { StaticApplicationRegistry } from "./helpers/static-application-registry.js";

const applicationKey = "application-secret-that-is-long-enough";
const githubToken = "synthetic-github-token";

const config: ServerConfig = {
  host: "127.0.0.1", port: 0, publicBaseUrl: "http://localhost:4310", sessionTtlMs: 1_800_000,
  sessionSweepIntervalMs: 60_000, maximumActiveSessions: 100, maximumSessionsPerApplication: 10,
  defaultModel: "test-model", allowedModels: ["test-model"], maximumReasoningEffort: "high",
  openAiApiKey: "unused-test-key", toolTimeoutMs: 2_000, maximumToolResponseBytes: 64 * 1_024,
  callbackIssuer: "http://localhost:4310", callbackTokenTtlMs: 60_000, providerRetryAttempts: 1,
  providerRetryBaseDelayMs: 0, databaseUrl: "postgresql://unused.test/caes-ai",
  allowInsecureCallbacks: true, githubMcpToken: githubToken,
};

const applicationRegistry = new StaticApplicationRegistry([{
  id: "sample-app", apiKey: applicationKey, toolCallbackUrl: "http://sample-app.test/tools",
  allowedOrigins: [], allowedModels: ["test-model"], maximumReasoningEffort: "medium",
}]);

const sessionRequest = {
  protocolVersion: currentProtocolVersion,
  userReference: "opaque-user",
  contextToken: "signed-context-token",
  instructions: "Use tools for current data.",
  modelPolicy: { requestedModel: null, defaultReasoningEffort: "low", maximumReasoningEffort: "medium", allowPerTurnOverride: true },
  tools: [{
    name: "list_items", description: "Read the items.", execution: "server", risk: "read", needsApproval: false,
    inputSchema: { type: "object" }, dataSchema: { type: "object" },
  }],
};

const chatPayload = {
  protocolVersion: currentProtocolVersion, threadId: "thread-1", runId: "run-1",
  messages: [{ id: "user-1", role: "user", content: "Why are these rows here?" }],
  tools: [], context: [], forwardedProps: {}, state: {},
};

describe("GitHub tools in a chat run", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  async function setup(
    model: ReturnType<typeof toolCallingProvider>,
    {
      server,
      request = { mcpServers: ["github"] },
      overrides = {},
    }: { server?: LocalMcpServerOptions; request?: object; overrides?: Partial<BuildAppOptions> } = {},
  ) {
    const local = await startLocalMcpServer(server);
    cleanup.push(local.close);
    const logs: string[] = [];
    const store = {
      startRun: vi.fn<OperationalStore["startRun"]>(async () => {}),
      finishRun: vi.fn<OperationalStore["finishRun"]>(async () => {}),
      recordToolCall: vi.fn<OperationalStore["recordToolCall"]>(async () => {}),
    };
    const app = buildApp({
      config,
      applicationRegistry,
      modelProvider: model.provider,
      operationalStore: store,
      githubMcpUrl: local.url,
      logger: { stream: new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } }) },
      ...overrides,
    });
    cleanup.push(() => app.close());
    const created = await app.inject({
      method: "POST", url: "/v1/sessions", headers: { authorization: `ApiKey ${applicationKey}` },
      payload: { ...sessionRequest, ...request },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{ sessionId: string; accessToken: string }>();
    const chatRequest = {
      method: "POST" as const,
      url: `/v1/sessions/${session.sessionId}/chat`,
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
      },
      payload: chatPayload,
    };
    return { app, local, logs, store, created, session, chatRequest, chat: () => app.inject(chatRequest) };
  }

  it("leaves sessions that did not opt in alone", async () => {
    const model = toolCallingProvider("list_items", {});
    const { local, chat } = await setup(model, {
      request: {},
      overrides: { fetchImplementation: async () => Response.json({ protocolVersion: 1, ok: true, output: { data: {}, uiEffects: [] } }) },
    });
    expect((await chat()).statusCode).toBe(200);
    expect(local.requests).toEqual([]);
    expect(model.toolNames[0]).toEqual(["list_items"]);
  });

  it("offers GitHub tools beside app tools and returns the content to the model", async () => {
    const model = toolCallingProvider("github_search_code", { query: "purpose" });
    const { local, chat, store } = await setup(model);
    const response = await chat();
    expect(response.statusCode).toBe(200);
    expect(model.toolNames[0]).toEqual(["list_items", "github_search_code", "github_get_file_contents"]);
    expect(local.calls).toEqual([{ name: "search_code", args: { query: "purpose" } }]);
    expect(String(model.toolResults[0])).toContain("v_TransactionInclusion.sql");
    expect(store.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      applicationId: "sample-app", runId: "run-1", toolName: "github_search_code", risk: "read", outcome: "complete",
    }));
    expect(store.recordToolCall.mock.calls[0]![0]).not.toHaveProperty("errorCode");
  });

  it.each([
    ["timeout", { call: () => new Promise<never>(() => undefined) }, { ...config, toolTimeoutMs: 300 }, "tool_timeout", /did not respond/i],
    ["oversized result", { call: () => ({ content: [{ type: "text" as const, text: "x".repeat(70_000) }] }) }, config, "tool_response_too_large", /too large/i],
  ])("gives the model a readable error for a %s", async (_name, server, runConfig, errorCode, message) => {
    const model = toolCallingProvider("github_search_code", { query: "purpose" });
    const { chat, store } = await setup(model, { server, overrides: { config: runConfig } });
    const response = await chat();
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("RUN_ERROR");
    expect(String(model.toolResults[0])).toMatch(message);
    expect(store.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "error", errorCode }));
    expect(store.finishRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "complete" }));
  });

  it("records a call cancelled by a client disconnect", async () => {
    const model = toolCallingProvider("github_search_code", { query: "purpose" });
    const client = new AbortController();
    const { app, store, chatRequest } = await setup(model, {
      server: {
        call: () => {
          setTimeout(() => client.abort(), 20);
          return new Promise<never>(() => undefined);
        },
      },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    await fetch(`${address}${chatRequest.url}`, {
      method: "POST",
      headers: { ...chatRequest.headers, "content-type": "application/json" },
      body: JSON.stringify(chatPayload),
      signal: client.signal,
    }).then((response) => response.text()).catch(() => undefined);
    await vi.waitFor(() => expect(store.recordToolCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ outcome: "cancelled", errorCode: "tool_cancelled" }),
    ));
  });

  it("keeps working with app tools when GitHub is unreachable", async () => {
    const model = toolCallingProvider("list_items", {});
    const { chat, logs } = await setup(model, {
      server: { intercept: (_request, response) => { response.writeHead(503).end(); return true; } },
      overrides: { fetchImplementation: async () => Response.json({ protocolVersion: 1, ok: true, output: { data: {}, uiEffects: [] } }) },
    });
    const response = await chat();
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("RUN_ERROR");
    expect(model.toolNames[0]).toEqual(["list_items"]);
    expect(logs.join("")).toContain("github_mcp_unavailable");
  });

  it("keeps working when the token is removed after the session was created", async () => {
    const model = toolCallingProvider("list_items", {});
    const repository = new InMemorySessionRepository();
    const { local, session, chatRequest } = await setup(model, { overrides: { sessionRepository: repository } });
    const logs: string[] = [];
    const restarted = buildApp({
      config: { ...config, githubMcpToken: undefined },
      applicationRegistry,
      modelProvider: model.provider,
      sessionRepository: repository,
      githubMcpUrl: local.url,
      fetchImplementation: async () => Response.json({ protocolVersion: 1, ok: true, output: { data: {}, uiEffects: [] } }),
      logger: { stream: new Writable({ write(chunk, _encoding, done) { logs.push(String(chunk)); done(); } }) },
    });
    cleanup.push(() => restarted.close());
    const response = await restarted.inject(chatRequest);
    expect(session.sessionId).toBeDefined();
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("RUN_ERROR");
    expect(model.toolNames[0]).toEqual(["list_items"]);
    expect(local.requests).toEqual([]);
    expect(logs.join("")).toContain("github_mcp_not_configured");
  });

  it("sends the token only to the MCP server", async () => {
    const model = toolCallingProvider("github_search_code", { query: "purpose" });
    const { local, logs, store, created, chat } = await setup(model);
    const response = await chat();
    expect(local.requests.length).toBeGreaterThan(0);
    expect(local.requests.every(({ authorization }) => authorization === `Bearer ${githubToken}`)).toBe(true);
    const everything = [
      created.body,
      response.body,
      JSON.stringify(store.recordToolCall.mock.calls),
      JSON.stringify(store.startRun.mock.calls),
      JSON.stringify(store.finishRun.mock.calls),
      JSON.stringify(model.toolResults),
      logs.join(""),
    ].join("");
    expect(everything).not.toContain(githubToken);
  });

  it("stores neither arguments nor results", async () => {
    const model = toolCallingProvider("github_search_code", { query: "private-looking-query" });
    const { store, chat } = await setup(model);
    await chat();
    expect(store.recordToolCall).toHaveBeenCalledOnce();
    const record = JSON.stringify(store.recordToolCall.mock.calls);
    expect(record).not.toContain("private-looking-query");
    expect(record).not.toContain("v_TransactionInclusion");
  });
});
