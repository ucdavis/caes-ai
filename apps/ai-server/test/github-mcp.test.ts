import { afterEach, describe, expect, it } from "vitest";

import {
  connectGitHubTools,
  type ConnectGitHubToolsOptions,
  type GitHubToolCallDetails,
} from "../src/mcp/github.js";
import { startLocalMcpServer, type LocalMcpServerOptions } from "./helpers/local-mcp-server.js";

const token = "synthetic-github-token";

interface ExecutableTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  execute(args: unknown, context: { toolCallId: string; abortSignal?: AbortSignal }): Promise<unknown>;
}

describe("GitHub MCP client", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  async function setup(server: LocalMcpServerOptions = {}, overrides: Partial<ConnectGitHubToolsOptions> = {}) {
    const local = await startLocalMcpServer(server);
    cleanup.push(local.close);
    const calls: GitHubToolCallDetails[] = [];
    const warnings: Array<{ code: string; toolName?: string }> = [];
    const connection = await connectGitHubTools({
      url: local.url,
      token,
      toolTimeoutMs: 2_000,
      maximumToolResponseBytes: 64 * 1_024,
      signal: new AbortController().signal,
      onToolCall: (details) => void calls.push(details),
      onWarning: (code, details) => void warnings.push({ code, ...details }),
      ...overrides,
    });
    cleanup.push(() => connection.close());
    const tools = connection.tools as unknown as ExecutableTool[];
    const tool = (name: string) => tools.find((item) => item.name === name)!;
    return { local, calls, warnings, connection, tools, tool };
  }

  const failure = async (promise: Promise<unknown>) => promise.then(
    () => { throw new Error("Expected the tool call to fail."); },
    (error: Error) => error,
  );

  it("offers only allowed tools, prefixed, with the server's description and schema", async () => {
    const { tools } = await setup();
    expect(tools.map((item) => item.name).sort()).toEqual(["github_get_file_contents", "github_search_code"]);
    const search = tools.find((item) => item.name === "github_search_code")!;
    expect(search.description).toBe("Search code.");
    expect(search.inputSchema).toMatchObject({ required: ["query"] });
    expect(search.metadata).toMatchObject({ execution: "server", risk: "read" });
  });

  it("skips and warns about an allowed tool the server does not offer", async () => {
    const { tools, warnings } = await setup({
      tools: [{ name: "search_code", inputSchema: { type: "object", properties: {} } }],
    });
    expect(tools.map((item) => item.name)).toEqual(["github_search_code"]);
    expect(warnings).toEqual([{ code: "github_mcp_tool_missing", toolName: "get_file_contents" }]);
  });

  it("sends the bearer token and returns the MCP content", async () => {
    const { local, tool, calls } = await setup();
    const output = await tool("github_search_code").execute({ query: "purpose" }, { toolCallId: "call-1" });
    expect(local.requests.every(({ authorization }) => authorization === `Bearer ${token}`)).toBe(true);
    expect(local.calls).toEqual([{ name: "search_code", args: { query: "purpose" } }]);
    expect(output).toEqual({
      data: { content: [{ type: "text", text: "match in database/data/Views/v_TransactionInclusion.sql" }] },
      uiEffects: [],
    });
    expect(calls).toEqual([expect.objectContaining({
      toolCallId: "call-1", toolName: "github_search_code", risk: "read", ok: true,
    })]);
    expect(calls[0]).not.toHaveProperty("errorCode");
  });

  it("rejects invalid arguments before they reach the server", async () => {
    const { local, tool, calls } = await setup();
    const error = await failure(tool("github_search_code").execute({ query: 7 }, { toolCallId: "call-1" }));
    expect(error.message).toMatch(/arguments/i);
    expect(local.calls).toEqual([]);
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "invalid_tool_arguments" });
  });

  it("removes the nulls strict mode adds to optional parameters", async () => {
    const { local, tool } = await setup();
    await tool("github_get_file_contents").execute(
      { owner: "ucdavis", repo: "AD419", path: "README.md", ref: null },
      { toolCallId: "call-1" },
    );
    expect(local.calls[0]?.args).toEqual({ owner: "ucdavis", repo: "AD419", path: "README.md" });
  });

  it("keeps a null for a required parameter so validation rejects it", async () => {
    const { local, tool, calls } = await setup();
    await failure(tool("github_search_code").execute({ query: null }, { toolCallId: "call-1" }));
    expect(local.calls).toEqual([]);
    expect(calls[0]?.errorCode).toBe("invalid_tool_arguments");
  });

  it("accepts third-party schema keywords and declared drafts", async () => {
    const { tool, warnings } = await setup({
      tools: [{
        name: "search_code",
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          "x-github-hint": "vendor keyword",
          properties: { query: { type: "string", format: "github-query" } },
          required: ["query"],
        },
      }, { name: "get_file_contents", inputSchema: { type: "object", properties: {} } }],
    });
    await expect(tool("github_search_code").execute({ query: "purpose" }, { toolCallId: "call-1" })).resolves.toBeDefined();
    const error = await failure(tool("github_search_code").execute({}, { toolCallId: "call-2" }));
    expect(error.message).toMatch(/arguments/i);
    expect(tool("github_search_code").inputSchema).not.toHaveProperty("$schema");
    expect(warnings).toEqual([]);
  });

  it("gives the model the server's message for an MCP tool error", async () => {
    const { tool, calls } = await setup({
      call: () => ({ isError: true, content: [{ type: "text", text: "Not Found: database/missing.sql" }] }),
    });
    const error = await failure(tool("github_search_code").execute({ query: "x" }, { toolCallId: "call-1" }));
    expect(error.message).toContain("Not Found: database/missing.sql");
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "tool_execution_failed" });
  });

  it("does not follow a redirect from the MCP URL", async () => {
    const target = await startLocalMcpServer();
    cleanup.push(target.close);
    const { connection, warnings } = await setup({
      intercept: (_request, response) => {
        response.writeHead(302, { location: target.url }).end();
        return true;
      },
    });
    expect(connection.tools).toEqual([]);
    expect(warnings).toEqual([{ code: "github_mcp_unavailable" }]);
    expect(target.requests).toEqual([]);
  });

  it("reports a timeout the model can read", async () => {
    const { tool, calls } = await setup(
      { call: (_name, _args, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")))) },
      { toolTimeoutMs: 300 },
    );
    const error = await failure(tool("github_search_code").execute({ query: "x" }, { toolCallId: "call-1" }));
    expect(error.message).toMatch(/did not respond/i);
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "tool_timeout" });
  });

  it("reports an oversized response the model can read", async () => {
    const { tool, calls } = await setup({
      call: () => ({ content: [{ type: "text", text: "x".repeat(70_000) }] }),
    });
    const error = await failure(tool("github_get_file_contents").execute(
      { owner: "ucdavis", repo: "AD419" },
      { toolCallId: "call-1" },
    ));
    expect(error.message).toMatch(/too large/i);
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "tool_response_too_large" });
  });

  it("reports cancellation", async () => {
    const controller = new AbortController();
    const { tool, calls } = await setup({
      call: (_name, _args, signal) => {
        setTimeout(() => controller.abort(), 10);
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped"))));
      },
    });
    const error = await failure(tool("github_search_code").execute(
      { query: "x" },
      { toolCallId: "call-1", abortSignal: controller.signal },
    ));
    expect(error.message).toMatch(/cancelled/i);
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "tool_cancelled" });
  });

  it("reports a broken connection during a call without leaking the token", async () => {
    let dropped = false;
    const { local, tool, calls } = await setup({
      intercept: (request, response) => {
        if (!dropped) return false;
        response.writeHead(500, { authorization: request.headers.authorization ?? "" }).end(request.headers.authorization);
        return true;
      },
      call: () => ({ content: [] }),
    });
    expect(local.requests.length).toBeGreaterThan(0);
    dropped = true;
    const error = await failure(tool("github_search_code").execute({ query: "x" }, { toolCallId: "call-1" }));
    expect(error.message).toMatch(/unavailable/i);
    expect(error.message).not.toContain(token);
    expect(calls[0]).toMatchObject({ ok: false, errorCode: "tool_execution_failed" });
  });

  it("continues without tools when the connection is refused", async () => {
    const warnings: string[] = [];
    const connection = await connectGitHubTools({
      url: "http://127.0.0.1:1/mcp",
      token,
      toolTimeoutMs: 2_000,
      maximumToolResponseBytes: 1_024,
      signal: new AbortController().signal,
      onToolCall: () => undefined,
      onWarning: (code) => void warnings.push(code),
    });
    expect(connection.tools).toEqual([]);
    expect(warnings).toEqual(["github_mcp_unavailable"]);
    await connection.close();
  });

  it("continues without tools when the server hangs during connection", async () => {
    const started = performance.now();
    const { connection, warnings } = await setup({ intercept: () => true }, { toolTimeoutMs: 200 });
    expect(connection.tools).toEqual([]);
    expect(warnings).toEqual([{ code: "github_mcp_unavailable" }]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("continues without tools when the tool list is over the size limit", async () => {
    const { connection, warnings } = await setup(
      { tools: [{ name: "search_code", description: "x".repeat(4_096), inputSchema: { type: "object" } }] },
      { maximumToolResponseBytes: 1_024 },
    );
    expect(connection.tools).toEqual([]);
    expect(warnings).toEqual([{ code: "github_mcp_unavailable" }]);
  });
});
