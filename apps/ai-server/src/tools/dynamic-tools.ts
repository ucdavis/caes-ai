import { toolDefinition, type AnyTool } from "@tanstack/ai";
import { createToolOutputSchema } from "@ucdavis/caes-ai-protocol";

import type { SessionRecord } from "../sessions.js";
import type { ToolGatewayClient } from "./gateway.js";

export interface ToolRunState {
  mutationStarted: boolean;
  runId?: string;
}

export function createDynamicTools(
  session: SessionRecord,
  gateway: ToolGatewayClient,
  runState?: ToolRunState,
): AnyTool[] {
  return session.tools.map(({ manifest }) => {
    const definition = toolDefinition({
      name: manifest.name,
      description: manifest.description,
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.execution === "server"
        ? createToolOutputSchema(manifest.dataSchema)
        : manifest.dataSchema,
      needsApproval: manifest.needsApproval,
      metadata: {
        execution: manifest.execution,
        risk: manifest.risk,
        ...(manifest.presentation ? { presentation: manifest.presentation } : {}),
      },
    });

    if (manifest.execution === "client") return definition.client();

    return definition.server(async (args, context) => {
      if (!context?.toolCallId) {
        throw new Error("The model provider did not supply a tool-call ID.");
      }
      if (manifest.risk === "write" && runState) {
        runState.mutationStarted = true;
      }
      return gateway.execute(
        session,
        manifest.name,
        context.toolCallId,
        args,
        runState?.runId,
        context.abortSignal,
      );
    });
  });
}
