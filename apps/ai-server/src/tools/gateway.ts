import { randomUUID } from "node:crypto";

import {
  currentProtocolVersion,
  toolExecutionResponseSchema,
  type CaesAiError,
  type ToolExecutionRequest,
  type ToolOutputEnvelope,
} from "@ucdavis/caes-ai-protocol";

import type { ServerConfig } from "../config.js";
import type { CallbackTokenIssuer } from "../security/callback-tokens.js";
import type { CompiledTool, SessionRecord } from "../sessions.js";

export class ToolGatewayError extends Error {
  constructor(
    readonly code:
      | "invalid_tool_arguments"
      | "invalid_tool_output"
      | "tool_not_found"
      | "tool_timeout"
      | "tool_cancelled"
      | "tool_execution_failed",
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function readLimitedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) {
    throw new ToolGatewayError(
      "invalid_tool_output",
      "The application returned too much tool data.",
    );
  }

  if (!response.body) {
    throw new ToolGatewayError("tool_execution_failed", "The application returned no tool data.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new ToolGatewayError(
        "invalid_tool_output",
        "The application returned too much tool data.",
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ToolGatewayError(
      "invalid_tool_output",
      "The application returned invalid tool data.",
    );
  }
}

function findTool(session: SessionRecord, name: string): CompiledTool {
  const tool = session.tools.find((candidate) => candidate.manifest.name === name);
  if (!tool) {
    throw new ToolGatewayError("tool_not_found", "The requested tool is not available.");
  }
  return tool;
}

export class ToolGatewayClient {
  constructor(
    private readonly config: Pick<
      ServerConfig,
      "toolTimeoutMs" | "maximumToolResponseBytes"
    >,
    private readonly callbackTokens: CallbackTokenIssuer,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly onComplete?: (details: {
      sessionId: string;
      applicationId: string;
      runId: string;
      toolCallId: string;
      toolName: string;
      risk: string;
      startedAt: Date;
      completedAt: Date;
      durationMs: number;
      ok: boolean;
      errorCode?: string;
    }) => void | Promise<void>,
  ) {}

  async execute(
    session: SessionRecord,
    toolName: string,
    toolCallId: string,
    args: unknown,
    runId = "unknown",
    signal?: AbortSignal,
  ): Promise<ToolOutputEnvelope> {
    const tool = findTool(session, toolName);
    if (!tool.validateInput(args)) {
      throw new ToolGatewayError(
        "invalid_tool_arguments",
        "The tool arguments do not match the registered schema.",
      );
    }

    const startedAt = performance.now();
    let errorCode: string | undefined;
    let callbackSignal: AbortSignal | undefined;
    try {
      signal?.throwIfAborted();
      const request: ToolExecutionRequest = {
        protocolVersion: currentProtocolVersion,
        sessionId: session.id,
        toolCallId,
        toolName,
        toolManifestHash: session.toolManifestHash,
        arguments: args,
        contextToken: session.contextToken,
      };
      const requestBody = JSON.stringify(request);
      const callbackToken = await this.callbackTokens.issue({
        applicationId: session.application.id,
        sessionId: session.id,
        toolCallId,
        toolName,
        toolManifestHash: session.toolManifestHash,
        requestBody,
      });
      // Signing is asynchronous. Cancellation must still prevent dispatch after it finishes.
      signal?.throwIfAborted();
      const timeoutSignal = AbortSignal.timeout(this.config.toolTimeoutMs);
      // A dispatched write may already commit. Let it return its outcome within the timeout.
      callbackSignal = signal && tool.manifest.risk !== "write"
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;
      const response = await this.fetchImplementation(session.application.toolCallbackUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${callbackToken}`,
          "content-type": "application/json",
          "x-caes-ai-request-id": randomUUID(),
          "x-caes-ai-tool-call-id": toolCallId,
        },
        body: requestBody,
        signal: callbackSignal,
      });
      const body = await readLimitedJson(response, this.config.maximumToolResponseBytes);
      const parsed = toolExecutionResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        throw new ToolGatewayError(
          "tool_execution_failed",
          "The application could not complete the tool call.",
          response.status >= 500,
        );
      }
      if (!parsed.data.ok) {
        throw safeApplicationError(parsed.data.error);
      }
      if (!tool.validateData(parsed.data.output.data)) {
        throw new ToolGatewayError(
          "invalid_tool_output",
          "The application returned data that does not match the registered schema.",
        );
      }
      return parsed.data.output;
    } catch (error) {
      // Use the effective signal's reason: response-body aborts may surface as AbortError
      // even when the timeout fired. A later run cancellation must not relabel a write failure.
      const abortReason: unknown = callbackSignal?.aborted ? callbackSignal.reason
        : !callbackSignal && signal?.aborted ? signal.reason : undefined;
      if (abortReason !== undefined) {
        const timedOut = abortReason instanceof DOMException && abortReason.name === "TimeoutError";
        errorCode = timedOut ? "tool_timeout" : "tool_cancelled";
        throw new ToolGatewayError(
          timedOut ? "tool_timeout" : "tool_cancelled",
          timedOut ? "The application tool timed out." : "The tool call was cancelled.",
          timedOut,
        );
      }
      if (error instanceof ToolGatewayError) {
        errorCode = error.code;
        throw error;
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        errorCode = "tool_timeout";
        throw new ToolGatewayError("tool_timeout", "The application tool timed out.", true);
      }
      errorCode = "tool_execution_failed";
      throw new ToolGatewayError(
        "tool_execution_failed",
        "The application could not complete the tool call.",
        true,
      );
    } finally {
      const completedAt = new Date();
      await Promise.resolve(this.onComplete?.({
        sessionId: session.id,
        applicationId: session.application.id,
        runId,
        toolCallId,
        toolName,
        risk: tool.manifest.risk,
        startedAt: new Date(completedAt.getTime() - (performance.now() - startedAt)),
        completedAt,
        durationMs: Math.round(performance.now() - startedAt),
        ok: errorCode === undefined,
        ...(errorCode ? { errorCode } : {}),
      })).catch(() => undefined);
    }
  }
}

function safeApplicationError(error: CaesAiError): ToolGatewayError {
  const allowedCodes = new Set([
    "invalid_tool_arguments",
    "tool_not_found",
    "tool_execution_failed",
  ]);
  const code = allowedCodes.has(error.code)
    ? (error.code as "invalid_tool_arguments" | "tool_not_found" | "tool_execution_failed")
    : "tool_execution_failed";
  return new ToolGatewayError(code, error.message, error.retryable);
}
