import {
  toolDefinition,
  type AnyClientTool,
} from "@tanstack/ai";
import { useChat, type ConnectConnectionAdapter } from "@tanstack/ai-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  createToolOutputSchema,
  compileToolSchema,
  toolOutputEnvelopeSchema,
} from "@ucdavis/caes-ai-protocol";

import { createAssistantClient } from "./client.js";
import type {
  AssistantClient,
  AssistantClientTool,
  AssistantMessage,
  AssistantProviderProps,
  AssistantRendererRegistry,
  AssistantSession,
  AssistantUiBridge,
} from "./types.js";

interface ApprovalView {
  id: string;
  toolName: string;
  args: unknown;
  status: string;
  canResolve: boolean;
  approve: () => void;
  reject: () => void;
}

interface RuntimeInterrupt {
  id: string;
  kind: string;
  status: string;
  canResolve: boolean;
  metadata?: Readonly<Record<string, unknown>>;
  toolName?: string;
  originalArgs?: unknown;
  resolveInterrupt?: (approved: boolean) => void;
}

interface AssistantContextValue {
  messages: AssistantMessage[];
  isLoading: boolean;
  error: Error | undefined;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  openWithDraft: (draft: string) => void;
  title: string;
  session: AssistantSession | undefined;
  sessionLoading: boolean;
  sessionError: Error | undefined;
  ensureSession: () => Promise<AssistantSession>;
  nextEffort: "default" | "medium";
  setNextEffort: (effort: "default" | "medium") => void;
  draft: string;
  setDraft: (draft: string) => void;
  send: (message: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  approvals: ApprovalView[];
  renderers: AssistantRendererRegistry;
  composerRef: RefObject<HTMLTextAreaElement | null>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);
const emptyClientTools: readonly AssistantClientTool[] = [];
const emptyRenderers: AssistantRendererRegistry = {};
const emptyUiBridge: AssistantUiBridge = {};

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant must be used inside AssistantProvider.");
  return value;
}

function buildTools(
  session: AssistantSession | undefined,
  clientTools: readonly AssistantClientTool[],
): AnyClientTool[] {
  const implementations = new Map(clientTools.map((tool) => [tool.name, tool]));
  const tools = new Map<string, AnyClientTool>();
  for (const descriptor of session?.tools ?? []) {
    const definition = toolDefinition({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.execution === "server"
        ? createToolOutputSchema(descriptor.dataSchema)
        : descriptor.dataSchema,
      needsApproval: descriptor.needsApproval,
    });
    const implementation = implementations.get(descriptor.name);
    const validateInput = descriptor.execution === "client" ? compileToolSchema(descriptor.inputSchema) : undefined;
    const validateData = descriptor.execution === "client" ? compileToolSchema(descriptor.dataSchema) : undefined;
    tools.set(descriptor.name, descriptor.execution === "client"
      ? definition.client(async (args) => {
          if (!implementation) {
            throw new Error(`No client implementation was registered for ${descriptor.name}.`);
          }
          if (!validateInput?.(args)) throw new Error("Client tool arguments do not match the accepted schema.");
          const result = await implementation.execute(args);
          if (!validateData?.(result)) throw new Error("Client tool result does not match the accepted schema.");
          return result;
        })
      : definition.client());
  }
  return [...tools.values()];
}

function applyEffects(
  messages: AssistantMessage[],
  bridge: AssistantUiBridge,
  processed: Set<string>,
): void {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-call" || part.output === undefined || processed.has(part.id)) {
        continue;
      }
      const parsed = toolOutputEnvelopeSchema.safeParse(part.output);
      if (!parsed.success) continue;
      processed.add(part.id);
      for (const effect of parsed.data.uiEffects) {
        if (effect.type === "invalidate-query") {
          void bridge.invalidateQuery?.(effect.key);
        } else {
          bridge.showToast?.(effect.level, effect.message);
        }
      }
    }
  }
}

export function AssistantProvider({
  children,
  createSession,
  eager = false,
  clientTools = emptyClientTools,
  renderers = emptyRenderers,
  uiBridge = emptyUiBridge,
  client,
  title = "CAES AI Assistant",
}: AssistantProviderProps) {
  const [session, setSession] = useState<AssistantSession>();
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<Error>();
  const [isOpen, setOpen] = useState(false);
  const [nextEffort, setNextEffort] = useState<"default" | "medium">("default");
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const processedEffects = useRef(new Set<string>());
  const wasLoading = useRef(false);
  const threadId = useId();

  const assistantClient = useMemo<AssistantClient>(() => {
    if (client) return client;
    return createAssistantClient({ createSession, onSession: setSession });
  }, [client, createSession]);

  const ensureSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const created = await assistantClient.ensureSession();
      setSession(created);
      setSessionError(undefined);
      return created;
    } catch (error: unknown) {
      const sessionFailure = error instanceof Error ? error : new Error(String(error));
      setSessionError(sessionFailure);
      throw sessionFailure;
    } finally {
      setSessionLoading(false);
    }
  }, [assistantClient]);

  useEffect(() => {
    if (eager || isOpen) void ensureSession().catch(() => undefined);
  }, [eager, ensureSession, isOpen]);

  const tools = useMemo(
    () => buildTools(session, clientTools),
    [session, clientTools],
  );
  const chat = useChat({
    connection: assistantClient.connection as unknown as ConnectConnectionAdapter,
    threadId,
    tools,
  });

  useEffect(() => {
    applyEffects(
      chat.messages as unknown as AssistantMessage[],
      uiBridge,
      processedEffects.current,
    );
  }, [chat.messages, uiBridge]);

  useEffect(() => {
    if (wasLoading.current && !chat.isLoading) composerRef.current?.focus();
    wasLoading.current = chat.isLoading;
  }, [chat.isLoading]);

  useEffect(() => {
    if (isOpen && !sessionLoading) composerRef.current?.focus();
  }, [isOpen, sessionLoading]);

  const openWithDraft = useCallback((message: string) => {
    setDraft(message);
    setOpen(true);
  }, []);

  const send = useCallback(
    async (message: string) => {
      if (chat.isLoading) return;
      const content = message.trim();
      if (!content) return;
      const effort = nextEffort;
      setNextEffort("default");
      await chat.sendMessage(
        content,
        effort === "medium" ? { body: { reasoningEffort: "medium" } } : undefined,
      );
    },
    [chat, nextEffort],
  );

  const approvals = useMemo<ApprovalView[]>(
    () =>
      (chat.interrupts as readonly RuntimeInterrupt[]).map((interrupt) => {
        if (
          interrupt.kind === "tool-approval" &&
          interrupt.toolName &&
          interrupt.resolveInterrupt
        ) {
          const resolve = interrupt.resolveInterrupt;
          return {
            id: interrupt.id,
            toolName: interrupt.toolName,
            args: interrupt.originalArgs,
            status: interrupt.status,
            canResolve: interrupt.canResolve,
            approve: () => resolve(true),
            reject: () => resolve(false),
          };
        }
        return {
          id: interrupt.id,
          toolName: "Unavailable approval",
          args: interrupt.metadata ?? {},
          status: interrupt.status,
          canResolve: false,
          approve: () => undefined,
          reject: () => undefined,
        };
      }),
    [chat.interrupts],
  );

  const value = useMemo<AssistantContextValue>(
    () => ({
      messages: chat.messages as unknown as AssistantMessage[],
      isLoading: chat.isLoading,
      error: chat.error,
      isOpen,
      setOpen,
      openWithDraft,
      title,
      session,
      sessionLoading,
      sessionError,
      ensureSession,
      nextEffort,
      setNextEffort,
      draft,
      setDraft,
      send,
      stop: chat.stop,
      reset: () => {
        processedEffects.current.clear();
        setDraft("");
        chat.clear();
      },
      approvals,
      renderers,
      composerRef,
    }),
    [
      approvals,
      chat,
      draft,
      isOpen,
      nextEffort,
      openWithDraft,
      renderers,
      send,
      session,
      sessionError,
      sessionLoading,
      ensureSession,
      title,
    ],
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useComposerSubmit() {
  const assistant = useAssistant();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (assistant.isLoading) return;
    const message = assistant.draft;
    assistant.setDraft("");
    void assistant.send(message);
  };
  return {
    assistant,
    value: assistant.draft,
    setValue: assistant.setDraft,
    submit,
  };
}

export type { ApprovalView, AssistantContextValue };
