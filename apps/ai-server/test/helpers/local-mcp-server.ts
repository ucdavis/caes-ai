import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export interface LocalMcpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface LocalMcpServerOptions {
  tools?: LocalMcpTool[];
  call?: (name: string, args: unknown, signal: AbortSignal) => CallToolResult | Promise<CallToolResult>;
  /** Return true after answering a raw HTTP request, such as a redirect. */
  intercept?: (request: IncomingMessage, response: ServerResponse) => boolean;
}

const searchSchema = {
  type: "object",
  properties: { query: { type: "string" }, sort: { type: "string" } },
  required: ["query"],
};

export const defaultMcpTools: LocalMcpTool[] = [
  { name: "search_code", description: "Search code.", inputSchema: searchSchema },
  {
    name: "get_file_contents",
    description: "Read a file.",
    inputSchema: {
      type: "object",
      properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } },
      required: ["owner", "repo"],
    },
  },
  { name: "delete_file", description: "Delete a file.", inputSchema: { type: "object", properties: {} } },
];

export async function startLocalMcpServer(options: LocalMcpServerOptions = {}) {
  const requests: Array<{ method: string; authorization: string | undefined }> = [];
  const calls: Array<{ name: string; args: unknown }> = [];

  const http = createServer((request, response) => {
    requests.push({ method: request.method ?? "", authorization: request.headers.authorization });
    if (options.intercept?.(request, response)) return;
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const server = new Server({ name: "local-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: options.tools ?? defaultMcpTools }));
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      calls.push({ name: call.params.name, args: call.params.arguments });
      return options.call?.(call.params.name, call.params.arguments, extra.signal)
        ?? { content: [{ type: "text", text: "match in database/data/Views/v_TransactionInclusion.sql" }] };
    });
    const transport = new StreamableHTTPServerTransport({});
    response.once("close", () => void server.close());
    void server.connect(transport).then(() => transport.handleRequest(request, response));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
    requests,
    calls,
    close: () => new Promise<void>((resolve) => {
      http.closeAllConnections();
      http.close(() => resolve());
    }),
  };
}
