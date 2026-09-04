import type {
  ApplicationToolManifest,
  ChatStreamEvent,
  SessionCreationResponse,
} from "@ucdavis/caes-ai-protocol";
import type { ComponentType, ReactNode } from "react";

export type AssistantToolDescriptor = ApplicationToolManifest;
export type AssistantSession = SessionCreationResponse;

export interface AssistantRendererProps {
  data: unknown;
  props: Record<string, unknown>;
}

export type AssistantRendererRegistry = Record<
  string,
  ComponentType<AssistantRendererProps>
>;

export interface AssistantUiBridge {
  invalidateQuery?: (key: readonly unknown[]) => void | Promise<void>;
  showToast?: (level: "success" | "info" | "error", message: string) => void;
}

export interface CreateAssistantClientOptions {
  createSession: () => Promise<AssistantSession>;
  fetchImplementation?: typeof fetch;
  onSession?: (session: AssistantSession) => void;
}

export type AssistantStreamEvent = ChatStreamEvent;

export type AssistantMessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool-call";
      id: string;
      name: string;
      state: string;
      output?: unknown;
    };

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  parts: AssistantMessagePart[];
}

export interface AssistantConnection {
  connect: (
    messages: unknown[],
    data?: Record<string, unknown>,
    abortSignal?: AbortSignal,
    runContext?: {
      threadId: string;
      runId: string;
      [key: string]: unknown;
    },
  ) => AsyncIterable<AssistantStreamEvent>;
}

/** An app-owned implementation for a client tool declared in its session manifest. */
export interface AssistantClientTool {
  name: string;
  execute: (args: unknown) => unknown;
}

export interface AssistantClient {
  /** Internal streaming transport. Prefer AssistantProvider for application code. */
  connection: AssistantConnection;
  ensureSession: (force?: boolean) => Promise<AssistantSession>;
  clearSession: () => void;
  getSession: () => AssistantSession | undefined;
}

export interface AssistantProviderProps {
  children: ReactNode;
  createSession: () => Promise<AssistantSession>;
  eager?: boolean;
  clientTools?: readonly AssistantClientTool[];
  renderers?: AssistantRendererRegistry;
  uiBridge?: AssistantUiBridge;
  client?: AssistantClient;
  title?: string;
}
