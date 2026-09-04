import { createServer, request as httpRequest, type Server } from "node:http";

import { EventType, type AnyTextAdapter } from "@tanstack/ai";
import { chatStreamEventSchema, type ChatRequestEnvelope } from "@ucdavis/caes-ai-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp, type BuildAppOptions, type ServerConfig } from "../src/app.js";
import type { OperationalStore } from "../src/persistence/operational-store.js";
import { scriptedModelProvider } from "./helpers/scripted-model-provider.js";
import { StaticApplicationRegistry } from "./helpers/static-application-registry.js";

const config: ServerConfig = {
  host: "127.0.0.1", port: 0, publicBaseUrl: "http://localhost:4310",
  sessionTtlMs: 60_000, sessionSweepIntervalMs: 60_000,
  maximumActiveSessions: 100, maximumSessionsPerApplication: 10,
  defaultModel: "test-model", allowedModels: ["test-model"], maximumReasoningEffort: "medium",
  openAiApiKey: "unused-test-key", toolTimeoutMs: 1_000, maximumToolResponseBytes: 2_048,
  callbackIssuer: "http://caes-ai.test", callbackTokenTtlMs: 60_000,
  providerRetryAttempts: 2, providerRetryBaseDelayMs: 0,
  databaseUrl: "postgresql://unused.test/caes-ai", allowInsecureCallbacks: true,
};
const applicationKey = "synthetic-cancellation-test-key";
const resultBody = JSON.stringify({ protocolVersion: 1, ok: true, output: { data: {}, uiEffects: [] } });
const apps: ReturnType<typeof buildApp>[] = [];
const servers: Server[] = [];
const clients: AbortController[] = [];
const releases: (() => void)[] = [];

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  releases.push(resolve);
  return { promise, resolve };
}

afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  clients.splice(0).forEach((client) => client.abort());
  servers.forEach((server) => server.closeAllConnections());
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

const toolAdapter: AnyTextAdapter = {
  ...scriptedModelProvider.createAdapter("test-model"),
  async *chatStream(options) {
    const run = { runId: options.runId!, threadId: options.threadId! };
    yield { type: EventType.RUN_STARTED, ...run };
    if (!options.messages.some((message) => message.role === "tool")) {
      yield { type: EventType.TOOL_CALL_START, toolCallId: "call-work", toolCallName: "work" };
      yield { type: EventType.TOOL_CALL_ARGS, toolCallId: "call-work", delta: "{}" };
      yield { type: EventType.TOOL_CALL_END, toolCallId: "call-work", input: {} };
      yield { type: EventType.RUN_FINISHED, ...run, finishReason: "tool_calls" };
    } else {
      yield { type: EventType.RUN_FINISHED, ...run, finishReason: "stop" };
    }
  },
};

async function fixture(
  risk: "read" | "write",
  overrides: Partial<BuildAppOptions> = {},
  callbackUrl = "http://callback.test/tools",
) {
  const disconnected = gate();
  const store = {
    startRun: vi.fn<OperationalStore["startRun"]>(async () => {}),
    finishRun: vi.fn<OperationalStore["finishRun"]>(async () => {}),
    recordToolCall: vi.fn<OperationalStore["recordToolCall"]>(async () => {}),
  };
  const app = buildApp({
    config,
    applicationRegistry: new StaticApplicationRegistry([{
      id: "sample", apiKey: applicationKey, toolCallbackUrl: callbackUrl, allowedOrigins: [],
      allowedModels: ["test-model"], maximumReasoningEffort: "medium",
    }]),
    modelProvider: { ...scriptedModelProvider, createAdapter: () => toolAdapter },
    operationalStore: store,
    ...overrides,
  });
  apps.push(app);
  app.addHook("onRequest", async (_request, reply) => {
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) disconnected.resolve();
    });
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const created = await app.inject({
    method: "POST", url: "/v1/sessions", headers: { authorization: `ApiKey ${applicationKey}` },
    payload: {
      protocolVersion: 1, userReference: "user", contextToken: "synthetic-context-token",
      instructions: "Use tools.",
      modelPolicy: { requestedModel: null, defaultReasoningEffort: "low", maximumReasoningEffort: "medium", allowPerTurnOverride: true },
      tools: [{ name: "work", description: "Perform the test operation.", execution: "server", risk,
        needsApproval: risk === "write", inputSchema: { type: "object" }, dataSchema: { type: "object" } }],
    },
  });
  expect(created.statusCode).toBe(201);
  const session = created.json();
  const path = `/v1/sessions/${session.sessionId}/chat`;
  const headers = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", "x-caes-ai-protocol-version": "1" };
  let body: ChatRequestEnvelope = {
    protocolVersion: 1, runId: "run-work", threadId: "thread-work", tools: [], context: [],
    messages: [{ id: "message-user", role: "user", content: "Perform the operation." }],
  };
  if (risk === "write") {
    const proposal = await app.inject({ method: "POST", url: path, headers, payload: { ...body, runId: "run-proposal" } });
    const events = proposal.body.split("\n").filter((line) => line.startsWith("data: "))
      .map((line) => chatStreamEventSchema.parse(JSON.parse(line.slice(6))));
    const finish = events.find((event) => event.type === "RUN_FINISHED");
    if (finish?.type !== "RUN_FINISHED" || finish.outcome?.type !== "interrupt") {
      throw new Error("Expected an approval interrupt.");
    }
    const approval = finish.outcome.interrupts[0]!;
    expect(store.recordToolCall).not.toHaveBeenCalled();
    body = { ...body, parentRunId: "run-proposal",
      messages: [...body.messages, { id: "message-assistant", role: "assistant", toolCalls: [{
        id: approval.toolCallId, type: "function", function: { name: "work", arguments: "{}" },
      }] }],
      resume: [{ interruptId: approval.id, status: "resolved", payload: { approved: true } }],
    };
    store.startRun.mockClear();
    store.finishRun.mockClear();
  }
  return {
    app, store, disconnected,
    start() {
      const client = new AbortController();
      clients.push(client);
      // Use a dedicated socket so test cleanup does not wait for a client's keep-alive pool.
      const completed = new Promise<string | undefined>((resolve) => {
        const request = httpRequest(address + path, { method: "POST", headers, signal: client.signal, agent: false }, (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { text += chunk; });
          response.once("end", () => resolve(text));
          response.once("error", () => resolve(undefined));
        });
        request.once("error", () => resolve(undefined));
        request.end(JSON.stringify(body));
      });
      return { client, completed };
    },
  };
}

describe("chat cancellation over HTTP", () => {
  it.each(["read", "write"] as const)("does not dispatch a %s when disconnected during signing", async (risk) => {
    const signing = gate();
    const releaseSigning = gate();
    const fetchMock = vi.fn<typeof fetch>();
    const test = await fixture(risk, {
      fetchImplementation: fetchMock,
      callbackTokens: {
        issuer: config.callbackIssuer, getJwks: () => ({ keys: [] }),
        async issue() { signing.resolve(); await releaseSigning.promise; return "synthetic-callback-token"; },
      },
    });
    const { client, completed } = test.start();
    await signing.promise;
    client.abort();
    await test.disconnected.promise;
    releaseSigning.resolve();
    await vi.waitFor(() => expect(test.store.finishRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled", errorCode: "run_cancelled" })));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(test.store.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "cancelled", errorCode: "tool_cancelled" }));
    await completed;
  });

  it.each([
    ["read", "headers", "cancelled", "tool_cancelled"],
    ["read", "body", "cancelled", "tool_cancelled"],
    ["write", "complete", "complete", undefined],
    ["write", "timeout", "error", "tool_timeout"],
  ] as const)("handles a disconnected %s callback awaiting %s", async (risk, phase, outcome, errorCode) => {
    const received = gate();
    const releaseResponse = gate();
    const callbackClosed = gate();
    let calls = 0;
    let responseFinished = false;
    const server = createServer((request, response) => {
      calls++;
      request.resume();
      response.once("close", () => { responseFinished = response.writableEnded; callbackClosed.resolve(); });
      if (phase === "body" || phase === "timeout") {
        response.writeHead(200, { "content-type": "application/json" });
        response.write(resultBody.slice(0, 10));
      }
      received.resolve();
      void releaseResponse.promise.then(() => {
        if (!response.destroyed) response.end(phase === "body" || phase === "timeout" ? resultBody.slice(10) : resultBody);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener.");
    const test = await fixture(risk, {}, `http://127.0.0.1:${address.port}/tools`);
    const { client, completed } = test.start();
    await received.promise;
    client.abort();
    await test.disconnected.promise;
    if (phase === "complete") releaseResponse.resolve();
    await callbackClosed.promise;
    await vi.waitFor(() => expect(test.store.finishRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "cancelled", errorCode: "run_cancelled" })));
    expect(test.store.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome }));
    expect(test.store.recordToolCall.mock.calls[0]![0].errorCode).toBe(errorCode);
    expect(responseFinished).toBe(phase === "complete");
    expect(calls).toBe(1);
    await completed;
  });

  it("finishes a cancelled run when persistence outlasts the connection", async () => {
    const starting = gate();
    const releaseStart = gate();
    const test = await fixture("read");
    test.store.startRun.mockImplementation(async () => { starting.resolve(); await releaseStart.promise; });
    const { client, completed } = test.start();
    await starting.promise;
    client.abort();
    await test.disconnected.promise;
    releaseStart.resolve();
    await vi.waitFor(() => expect(test.store.finishRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "cancelled", errorCode: "run_cancelled" })));
    expect(test.store.recordToolCall).not.toHaveBeenCalled();
    await completed;
  });

  it.each([false, true])("records cancellation when the model stops with throw=%s", async (throws) => {
    const started = gate();
    let attempts = 0;
    const adapter: AnyTextAdapter = { ...toolAdapter, async *chatStream(options) {
      attempts++;
      yield { type: EventType.RUN_STARTED, runId: options.runId!, threadId: options.threadId! };
      const stopped = gate();
      options.request!.signal!.addEventListener("abort", stopped.resolve, { once: true });
      started.resolve();
      await stopped.promise;
      if (throws) throw new DOMException("Cancelled", "AbortError");
    } };
    const test = await fixture("read", { modelProvider: { ...scriptedModelProvider, createAdapter: () => adapter } });
    const { client, completed } = test.start();
    await started.promise;
    client.abort();
    await vi.waitFor(() => expect(test.store.finishRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "cancelled", errorCode: "run_cancelled" })));
    expect(attempts).toBe(1);
    await completed;
  });

  it("keeps normal stream and callback completion successful", async () => {
    const test = await fixture("read", { fetchImplementation: async () => new Response(resultBody) });
    const { completed } = test.start();
    expect(await completed).toContain('"type":"RUN_FINISHED"');
    expect(test.store.finishRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "complete" }));
    expect(test.store.recordToolCall).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "complete" }));
    expect(test.store.finishRun.mock.calls[0]![0].errorCode).toBeUndefined();
  });
});
