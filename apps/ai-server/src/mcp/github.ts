import { toolDefinition, type AnyTool } from "@tanstack/ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const githubMcpUrl = "https://api.githubcopilot.com/mcp/x/repos/readonly";
export const githubAllowedTools = ["search_code", "get_file_contents"] as const;
export const githubToolNames: readonly string[] = githubAllowedTools.map((name) => `github_${name}`);

export interface GitHubToolCallDetails {
  toolCallId: string;
  toolName: string;
  risk: "read";
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}

export interface GitHubToolConnection {
  tools: AnyTool[];
  close(): Promise<void>;
}

export interface ConnectGitHubToolsOptions {
  url: string;
  token: string;
  toolTimeoutMs: number;
  maximumToolResponseBytes: number;
  signal: AbortSignal;
  onToolCall(details: GitHubToolCallDetails): void | Promise<void>;
  onWarning(errorCode: string, details?: { toolName: string }): void;
}

class ResponseTooLargeError extends Error {}

/** The message is the tool result the model reads, so it must never carry upstream error detail. */
class GitHubToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

// Redirects are errors so the token can only ever reach the configured URL.
// POST bodies are read here so an oversized result is never buffered whole.
function boundedFetch(maximumBytes: number): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, { ...init, redirect: "error" });
    // GET is the long-lived server stream, which has no end to read to.
    if (init?.method !== "POST" || !response.ok || !response.body) return response;

    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function withoutSchemaDeclaration(schema: Tool["inputSchema"]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...schema };
  delete copy.$schema;
  return copy;
}

// compileToolSchema is strict for manifests the application owns. GitHub's schema is
// third-party, and an unfamiliar keyword should not remove the tool.
function compileGitHubSchema(schema: Record<string, unknown>): (value: unknown) => boolean {
  const Constructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => {
    compile(schema: Record<string, unknown>): (value: unknown) => boolean;
  };
  const compiler = new Constructor({ strict: false, allErrors: true, logger: false });
  (addFormats as unknown as (compiler: unknown) => void)(compiler);
  return compiler.compile(schema);
}

// OpenAI strict mode makes every parameter required and optional ones nullable, and
// TanStack does not undo that for tool calls, so an unset optional arrives as null.
function withoutNullOptionals(args: unknown, schema: Record<string, unknown>): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const required = Array.isArray(schema.required) ? schema.required as unknown[] : [];
  return Object.fromEntries(Object.entries(args)
    .filter(([key, value]) => value !== null || required.includes(key)));
}

function toolErrorMessage(content: unknown): string {
  const text = Array.isArray(content)
    ? content.flatMap((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n")
    : "";
  return text.slice(0, 1_024) || "GitHub could not complete the tool call.";
}

function classifyFailure(error: unknown, signal: AbortSignal): GitHubToolError {
  if (error instanceof GitHubToolError) return error;
  if (signal.aborted) return new GitHubToolError("tool_cancelled", "The tool call was cancelled.");
  if (error instanceof ResponseTooLargeError) {
    return new GitHubToolError(
      "tool_response_too_large",
      "The GitHub response is too large to read. Try a narrower search or a smaller file.",
    );
  }
  if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
    return new GitHubToolError("tool_timeout", "GitHub did not respond in time.");
  }
  return new GitHubToolError(
    "tool_execution_failed",
    "GitHub is unavailable, so the code could not be checked.",
  );
}

function wrapTool(client: Client, tool: Tool, options: ConnectGitHubToolsOptions): AnyTool {
  const inputSchema = withoutSchemaDeclaration(tool.inputSchema);
  const validate = compileGitHubSchema(inputSchema);
  const name = `github_${tool.name}`;

  return toolDefinition({
    name,
    description: tool.description ?? name,
    inputSchema,
    needsApproval: false,
    metadata: { execution: "server", risk: "read" },
  }).server(async (args, context) => {
    if (!context?.toolCallId) {
      throw new Error("The model provider did not supply a tool-call ID.");
    }
    const signal = context.abortSignal ?? options.signal;
    const startedAt = new Date();
    const start = performance.now();
    let errorCode: string | undefined;
    try {
      const cleaned = withoutNullOptionals(args, inputSchema);
      if (!validate(cleaned)) {
        throw new GitHubToolError(
          "invalid_tool_arguments",
          "The tool arguments do not match the GitHub tool schema.",
        );
      }
      const result = await client.callTool(
        { name: tool.name, arguments: cleaned as Record<string, unknown> },
        undefined,
        { signal, timeout: options.toolTimeoutMs },
      );
      if (result.isError) {
        throw new GitHubToolError("tool_execution_failed", toolErrorMessage(result.content));
      }
      return { data: { content: result.content }, uiEffects: [] };
    } catch (error) {
      const failure = classifyFailure(error, signal);
      errorCode = failure.code;
      throw failure;
    } finally {
      try {
        await options.onToolCall({
          toolCallId: context.toolCallId,
          toolName: name,
          risk: "read",
          startedAt,
          completedAt: new Date(),
          durationMs: Math.round(performance.now() - start),
          ok: errorCode === undefined,
          ...(errorCode ? { errorCode } : {}),
        });
      } catch {
        // Recording a call must not change its result.
      }
    }
  });
}

/** Never rejects: a GitHub outage leaves the run with no GitHub tools. */
export async function connectGitHubTools(
  options: ConnectGitHubToolsOptions,
): Promise<GitHubToolConnection> {
  const client = new Client({ name: "caes-ai", version: "1.0.0" });
  const close = () => client.close().catch(() => undefined);
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    fetch: boundedFetch(options.maximumToolResponseBytes),
    requestInit: { headers: { authorization: `Bearer ${options.token}` } },
  });
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.toolTimeoutMs)]);

  try {
    await client.connect(transport, { signal, timeout: options.toolTimeoutMs });
    const { tools: offered } = await client.listTools(undefined, {
      signal,
      timeout: options.toolTimeoutMs,
    });

    const tools: AnyTool[] = [];
    for (const name of githubAllowedTools) {
      const tool = offered.find((candidate) => candidate.name === name);
      if (!tool) {
        options.onWarning("github_mcp_tool_missing", { toolName: name });
        continue;
      }
      try {
        tools.push(wrapTool(client, tool, options));
      } catch {
        options.onWarning("github_mcp_tool_invalid", { toolName: name });
      }
    }
    return { tools, close };
  } catch {
    options.onWarning("github_mcp_unavailable");
    await close();
    return { tools: [], close: async () => {} };
  }
}
