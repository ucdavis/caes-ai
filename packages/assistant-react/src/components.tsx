import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toolOutputEnvelopeSchema, type ToolOutputEnvelope } from "@ucdavis/caes-ai-protocol";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from "react";

import { useAssistant, useComposerSubmit } from "./context.js";
import type {
  AssistantMessage,
  AssistantMessagePart,
  AssistantRendererProps,
} from "./types.js";

export type AssistantMarkdownRenderer = ComponentType<{ children: string }>;

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ href, children: linkChildren }) {
          const safe = href && (/^https?:\/\//i.test(href) || href.startsWith("/") || href.startsWith("#"));
          if (!safe) return <>{linkChildren}</>;
          const external = /^https?:\/\//i.test(href);
          return (
            <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
              {linkChildren}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function GenericResult({ value }: { value: unknown }) {
  return (
    <pre className="caes-ai-assistant__generic-result" data-caes-ai-slot="generic-result">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

type ToolCallPart = Extract<AssistantMessagePart, { type: "tool-call" }>;

function humanizeToolName(name: string): string {
  const words = name.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function replacesAssistantText(
  part: AssistantMessagePart,
  renderers: ReturnType<typeof useAssistant>["renderers"],
): boolean {
  if (part.type !== "tool-call") return false;
  const parsed = toolOutputEnvelopeSchema.safeParse(part.output);
  const display = parsed.success ? parsed.data.display : undefined;
  return Boolean(
    display?.visibility === "inline" &&
    display.suppressAssistantText &&
    renderers[display.kind],
  );
}

function isHiddenToolPart(part: AssistantMessagePart): boolean {
  if (part.type !== "tool-call" || String(part.state) !== "complete") return false;
  const parsed = toolOutputEnvelopeSchema.safeParse(part.output);
  return parsed.success && parsed.data.display?.visibility === "hidden";
}

function visibleMessageParts(
  message: AssistantMessage,
  hideAssistantText: boolean,
  lastToolCallIndex: number,
): Array<{ part: AssistantMessagePart; index: number }> {
  const visible: Array<{ part: AssistantMessagePart; index: number }> = [];
  for (const [index, part] of message.parts.entries()) {
    if (part.type === "tool-call" && !isHiddenToolPart(part)) {
      visible.push({ part, index });
    }
    if (
      part.type === "text" &&
      !hideAssistantText &&
      (message.role !== "assistant" || index >= lastToolCallIndex)
    ) {
      visible.push({ part, index });
    }
  }
  return visible;
}

function renderToolOutput(
  output: unknown,
  envelope: ToolOutputEnvelope | undefined,
  Renderer: ComponentType<AssistantRendererProps> | undefined,
): ReactNode {
  if (envelope?.display) {
    return Renderer ? (
      <Renderer data={envelope.data} props={envelope.display.props} />
    ) : (
      <GenericResult value={envelope.display.props} />
    );
  }
  return output === undefined ? undefined : <GenericResult value={output} />;
}

function toolStatus(state: string): string {
  if (state === "complete") return "Done";
  if (state === "error") return "Failed";
  return "Working";
}

function ToolPart({ part }: { part: ToolCallPart }) {
  const { renderers, session } = useAssistant();
  const output: unknown = part.output;
  const parsed = toolOutputEnvelopeSchema.safeParse(output);
  const envelope = parsed.success ? parsed.data : undefined;
  const display = envelope?.display;
  const Renderer = display ? renderers[display.kind] : undefined;
  const rendered = renderToolOutput(output, envelope, Renderer);

  const descriptor = session?.tools.find((tool) => tool.name === part.name);
  const label = descriptor?.presentation?.label ?? humanizeToolName(String(part.name));
  const state = String(part.state);
  const complete = state === "complete";
  const status = toolStatus(state);

  if (display?.visibility === "hidden" && complete) return null;

  // Inline output is application-owned user interface, not developer trace
  // data. Keep it visible instead of burying it in a completed-tool row.
  if (
    display?.visibility === "inline" &&
    Renderer &&
    envelope &&
    output !== undefined &&
    state !== "error"
  ) {
    return (
      <section className="caes-ai-assistant__presentation" data-caes-ai-slot="presentation" aria-label={label}>
        <div className="caes-ai-assistant__presentation-heading" data-caes-ai-slot="presentation-heading">{label}</div>
        <div className="caes-ai-assistant__presentation-content" data-caes-ai-slot="presentation-content">
          <Renderer data={envelope.data} props={display.props} />
        </div>
      </section>
    );
  }

  return (
    <details
      className={`caes-ai-assistant__tool caes-ai-assistant__tool--${state}`}
      data-caes-ai-slot="tool"
      data-state={state}
      open={!complete}
      aria-label={`Tool ${String(part.name)}`}
    >
      <summary className="caes-ai-assistant__tool-heading" data-caes-ai-slot="tool-heading">
        <span data-caes-ai-slot="tool-label">{label}</span>
        <span data-caes-ai-slot="tool-status">{status}</span>
      </summary>
      {rendered && <div className="caes-ai-assistant__tool-content" data-caes-ai-slot="tool-content">{rendered}</div>}
    </details>
  );
}

export interface AssistantMessagesProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  emptyState?: ReactNode;
  renderMarkdown?: AssistantMarkdownRenderer;
}

export function AssistantMessages({
  className,
  emptyState,
  renderMarkdown: Markdown = SafeMarkdown,
  ...props
}: AssistantMessagesProps = {}) {
  const { messages, isLoading, renderers } = useAssistant();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  if (messages.length === 0) {
    return (
      <div
        {...props}
        className={classes("caes-ai-assistant__welcome", className)}
        data-caes-ai-slot="empty-state"
      >
        {emptyState === undefined ? (
          <>
            <p>Ask about the data on this page, or request an action.</p>
            <p>Changes always wait for your approval.</p>
          </>
        ) : emptyState}
      </div>
    );
  }
  let suppressAssistantText = false;
  return (
    <div
      {...props}
      ref={containerRef}
      className={classes("caes-ai-assistant__messages", className)}
      data-caes-ai-slot="messages"
      aria-live="polite"
      aria-busy={isLoading}
    >
      {messages.map((message) => {
        if (message.role === "user") suppressAssistantText = false;
        const messageReplacesAssistantText = message.parts.some((part) =>
          replacesAssistantText(part, renderers));
        const hideAssistantText = message.role === "assistant" &&
          (suppressAssistantText || messageReplacesAssistantText);
        if (messageReplacesAssistantText) suppressAssistantText = true;
        const lastToolCallIndex = message.parts.findLastIndex(
          (part) => part.type === "tool-call",
        );
        const visibleParts = visibleMessageParts(
          message,
          hideAssistantText,
          lastToolCallIndex,
        );
        if (visibleParts.length === 0) return null;
        return (
          <article
            className={`caes-ai-assistant__message caes-ai-assistant__message--${message.role}`}
            data-caes-ai-slot="message"
            data-role={message.role}
            key={message.id}
          >
            <span className="caes-ai-assistant__role" data-caes-ai-slot="message-role">
              {message.role === "user" ? "You" : "Assistant"}
            </span>
            {visibleParts.map(({ part, index }) => {
              if (part.type === "text") {
                return <Markdown key={`${message.id}-text-${index}`}>{part.content}</Markdown>;
              }
              if (part.type === "tool-call") {
                return <ToolPart key={part.id} part={part} />;
              }
              return null;
            })}
          </article>
        );
      })}
    </div>
  );
}

export type AssistantApprovalProps = Omit<ComponentPropsWithoutRef<"div">, "children">;

export function AssistantApproval({ className, ...props }: AssistantApprovalProps = {}) {
  const { approvals, isLoading } = useAssistant();
  if (approvals.length === 0) return null;
  return (
    <div
      {...props}
      className={classes("caes-ai-assistant__approvals", className)}
      data-caes-ai-slot="approvals"
      aria-label="Pending approvals"
    >
      {approvals.map((approval) => {
        const disabled = !approval.canResolve || approval.status !== "pending" || isLoading;
        return (
          <section className="caes-ai-assistant__approval" data-caes-ai-slot="approval" key={approval.id}>
            <strong data-caes-ai-slot="approval-title">Approve {approval.toolName}?</strong>
            <pre data-caes-ai-slot="approval-arguments">{JSON.stringify(approval.args, null, 2)}</pre>
            <div className="caes-ai-assistant__approval-actions" data-caes-ai-slot="approval-actions">
              <button data-caes-ai-slot="approval-approve" type="button" disabled={disabled} onClick={approval.approve}>Approve</button>
              <button data-caes-ai-slot="approval-reject" type="button" disabled={disabled} onClick={approval.reject}>Reject</button>
            </div>
            {!approval.canResolve && <p>This approval cannot be safely resolved by this client.</p>}
          </section>
        );
      })}
    </div>
  );
}

export interface AssistantComposerProps
  extends Omit<ComponentPropsWithoutRef<"form">, "children" | "onSubmit"> {
  placeholder?: string;
}

export function AssistantComposer({
  className,
  placeholder = "Ask a question…",
  ...props
}: AssistantComposerProps = {}) {
  const { assistant, value, setValue, submit } = useComposerSubmit();
  const inputId = useId();
  const unavailable = !assistant.session || assistant.sessionLoading || Boolean(assistant.sessionError);
  const composerDisabled = unavailable || assistant.isLoading;
  const canThinkHarder =
    assistant.session?.modelPolicy.allowedReasoningEfforts.includes("medium") ?? false;
  return (
    <form
      {...props}
      className={classes("caes-ai-assistant__composer", className)}
      data-caes-ai-slot="composer"
      onSubmit={submit}
    >
      <label className="caes-ai-assistant__sr-only" data-caes-ai-slot="sr-only" htmlFor={inputId}>Message</label>
      <textarea
        data-caes-ai-slot="composer-input"
        id={inputId}
        ref={assistant.composerRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={unavailable ? "Connecting to assistant…" : assistant.isLoading ? "Waiting for the answer…" : placeholder}
        disabled={composerDisabled}
        rows={2}
      />
      <div className="caes-ai-assistant__composer-actions" data-caes-ai-slot="composer-actions">
        {canThinkHarder && (
          <label data-caes-ai-slot="reasoning-control">
            Reasoning
            <select
              data-caes-ai-slot="reasoning-select"
              value={assistant.nextEffort}
              onChange={(event) => assistant.setNextEffort(event.target.value as "default" | "medium")}
              disabled={assistant.isLoading}
            >
              <option value="default">Default</option>
              <option value="medium">Think harder</option>
            </select>
          </label>
        )}
        {assistant.isLoading ? (
          <button data-caes-ai-slot="stop" type="button" onClick={assistant.stop}>Stop</button>
        ) : (
          <button data-caes-ai-slot="send" type="submit" disabled={unavailable || !value.trim()}>Send</button>
        )}
      </div>
    </form>
  );
}

export interface AssistantPanelProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  inline?: boolean;
  messagesProps?: AssistantMessagesProps;
  approvalProps?: AssistantApprovalProps;
  composerProps?: AssistantComposerProps;
  showDeveloperDetails?: boolean;
}

export function AssistantPanel({
  inline = false,
  className,
  messagesProps,
  approvalProps,
  composerProps,
  showDeveloperDetails = true,
  ...props
}: AssistantPanelProps = {}) {
  const assistant = useAssistant();
  useEffect(() => {
    void assistant.ensureSession().catch(() => undefined);
  }, [assistant.ensureSession]);
  return (
    <div
      {...props}
      className={classes("caes-ai-assistant", inline && "caes-ai-assistant--inline", className)}
      data-caes-ai-slot="panel"
      data-layout={inline ? "inline" : "drawer"}
    >
      <header className="caes-ai-assistant__header" data-caes-ai-slot="header">
        <div>
          <strong data-caes-ai-slot="title">{assistant.title}</strong>
          <span data-caes-ai-slot="status">{assistant.isLoading ? "Working…" : "Ready"}</span>
        </div>
        <div data-caes-ai-slot="header-actions">
          <button data-caes-ai-slot="new-chat" type="button" onClick={assistant.reset}>New chat</button>
          {!inline && <button data-caes-ai-slot="close" type="button" aria-label="Close assistant" onClick={() => assistant.setOpen(false)}>×</button>}
        </div>
      </header>
      <AssistantMessages {...messagesProps} />
      <AssistantApproval {...approvalProps} />
      {assistant.error && <p className="caes-ai-assistant__error" data-caes-ai-slot="error">{assistant.error.message}</p>}
      {assistant.sessionError && <p className="caes-ai-assistant__error" data-caes-ai-slot="error">Assistant unavailable.</p>}
      {showDeveloperDetails && (
        <details className="caes-ai-assistant__details" data-caes-ai-slot="developer-details">
          <summary>Developer details</summary>
          <dl>
            <dt>Model</dt><dd>{assistant.session?.modelPolicy.model ?? "Connecting"}</dd>
            <dt>Default effort</dt><dd>{assistant.session?.modelPolicy.defaultReasoningEffort ?? "—"}</dd>
            <dt>Next message</dt><dd>{assistant.nextEffort === "medium" ? "medium" : "session default"}</dd>
          </dl>
        </details>
      )}
      <AssistantComposer {...composerProps} />
    </div>
  );
}

export interface AssistantDrawerProps
  extends Omit<ComponentPropsWithoutRef<"dialog">, "children" | "open"> {
  panelProps?: Omit<AssistantPanelProps, "inline">;
}

export function AssistantDrawer({
  className,
  panelProps,
  "aria-label": ariaLabel = "Assistant",
  ...props
}: AssistantDrawerProps = {}) {
  const { isOpen } = useAssistant();
  if (!isOpen) return null;
  return (
    <dialog
      {...props}
      open
      className={classes("caes-ai-assistant__drawer", className)}
      data-caes-ai-slot="drawer"
      aria-label={ariaLabel}
    >
      <AssistantPanel {...panelProps} />
    </dialog>
  );
}

export type AssistantInlineProps = Omit<AssistantPanelProps, "inline">;

export function AssistantInline(props: AssistantInlineProps = {}) {
  return <AssistantPanel {...props} inline />;
}

export interface AssistantLauncherProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> {
  closedLabel?: ReactNode;
  controlsId?: string;
  openLabel?: ReactNode;
}

export function AssistantLauncher({
  className,
  closedLabel = "Ask CAES AI",
  controlsId = "caes-ai-assistant-drawer",
  onClick,
  openLabel = "Hide assistant",
  ...props
}: AssistantLauncherProps = {}) {
  const { isOpen, setOpen } = useAssistant();
  return (
    <button
      {...props}
      className={classes("caes-ai-assistant__launcher", className)}
      data-caes-ai-slot="launcher"
      type="button"
      aria-expanded={isOpen}
      aria-controls={controlsId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!isOpen);
      }}
    >
      {isOpen ? openLabel : closedLabel}
    </button>
  );
}
