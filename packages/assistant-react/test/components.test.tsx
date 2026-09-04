import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  caesAiProtocolVersionHeader,
  currentProtocolVersion,
} from "@ucdavis/caes-ai-protocol";

import { createAssistantClient } from "../src/client.js";
import {
  AssistantDrawer,
  AssistantInline,
  AssistantLauncher,
  AssistantPanel,
} from "../src/ui.js";
import { AssistantProvider, useAssistant } from "../src/context.js";
import type { AssistantSession } from "../src/types.js";

const testSession: AssistantSession = {
  protocolVersion: currentProtocolVersion,
  sessionId: "00000000-0000-4000-8000-000000000001",
  accessToken: "browser-session-token-that-is-long-enough",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  chatUrl: "https://central.test/chat",
  modelPolicy: {
    model: "test-model",
    defaultReasoningEffort: "low",
    maximumReasoningEffort: "medium",
    allowedReasoningEfforts: ["low", "medium"],
  },
  toolManifestHash: "a".repeat(64),
  tools: [],
};

function response(text: string): Response {
  const events = [
    { type: "RUN_STARTED", runId: "run-1", threadId: "thread-1", timestamp: Date.now() },
    { type: "TEXT_MESSAGE_START", messageId: "assistant-1", role: "assistant", timestamp: Date.now() },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant-1", delta: text.slice(0, 5), timestamp: Date.now() },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant-1", delta: text.slice(5), timestamp: Date.now() },
    { type: "TEXT_MESSAGE_END", messageId: "assistant-1", timestamp: Date.now() },
    { type: "RUN_FINISHED", runId: "run-1", threadId: "thread-1", timestamp: Date.now() },
  ];
  return eventResponse(events);
}

function eventResponse(events: Array<Record<string, unknown>>): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify({
    ...event,
    metadata: {
      ...(event.metadata as Record<string, unknown> | undefined),
      caesAi: { protocolVersion: currentProtocolVersion },
    },
  })}\n\n`).join(""), {
    headers: {
      "content-type": "text/event-stream",
      [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
    },
  });
}

function toolEvents(
  name: string,
  args: Record<string, unknown>,
  output?: unknown,
  runId = "run-tool",
  threadId = "thread-1",
  finalMessageId = "after-tool",
): Array<Record<string, unknown>> {
  const now = Date.now();
  const events: Array<Record<string, unknown>> = [
    { type: "RUN_STARTED", runId, threadId, timestamp: now },
    { type: "TOOL_CALL_START", toolCallId: "call-tool", toolCallName: name, parentMessageId: "tool-message", timestamp: now },
    { type: "TOOL_CALL_ARGS", toolCallId: "call-tool", delta: JSON.stringify(args), timestamp: now },
    { type: "TOOL_CALL_END", toolCallId: "call-tool", timestamp: now, metadata: { tanstack: { input: args } } },
    { type: "RUN_FINISHED", runId, threadId, timestamp: now, metadata: { tanstack: { finishReason: "tool_calls" } } },
  ];
  if (output !== undefined) {
    events.push(
      { type: "TOOL_CALL_RESULT", messageId: "tool-message", toolCallId: "call-tool", content: JSON.stringify(output), role: "tool", timestamp: now },
      { type: "TEXT_MESSAGE_START", messageId: finalMessageId, role: "assistant", timestamp: now },
      { type: "TEXT_MESSAGE_CONTENT", messageId: finalMessageId, delta: "Done.", timestamp: now },
      { type: "TEXT_MESSAGE_END", messageId: finalMessageId, timestamp: now },
      { type: "RUN_FINISHED", runId, threadId, timestamp: now, metadata: { tanstack: { finishReason: "stop" } } },
    );
  }
  return events;
}

function approvalEvents(
  args: Record<string, unknown>,
  runId: string,
  threadId: string,
): Array<Record<string, unknown>> {
  const now = Date.now();
  const inputSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      dueDate: { type: ["string", "null"], format: "date" },
      category: { type: ["string", "null"] },
    },
    required: ["title"],
    additionalProperties: false,
  };
  const responseSchema = {
    oneOf: [
      {
        type: "object",
        properties: { approved: { const: true }, editedArgs: inputSchema },
        required: ["approved"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { approved: { const: false } },
        required: ["approved"],
        additionalProperties: false,
      },
    ],
  };
  return [
    ...toolEvents("add_todo", args, undefined, runId, threadId).slice(0, -1),
    {
      type: "MESSAGES_SNAPSHOT",
      timestamp: now,
      messages: [
        { id: "user-approval", role: "user", content: "Add it" },
        {
          id: "tool-message",
          role: "assistant",
          toolCalls: [{
            id: "call-tool",
            type: "function",
            function: { name: "add_todo", arguments: JSON.stringify(args) },
          }],
        },
      ],
    },
    { type: "STATE_SNAPSHOT", timestamp: now, snapshot: {} },
    {
      type: "RUN_FINISHED",
      runId,
      threadId,
      timestamp: now,
      outcome: {
        type: "interrupt",
        interrupts: [{
          id: "approval_call-tool",
          reason: "tool_call",
          message: "Approval required to run add_todo",
          toolCallId: "call-tool",
          responseSchema,
          metadata: {
            kind: "approval",
            toolName: "add_todo",
            input: args,
            "tanstack:interruptBinding": {
              v: 1,
              kind: "tool-approval",
              interruptId: "approval_call-tool",
              toolName: "add_todo",
              toolCallId: "call-tool",
              originalArgs: args,
              inputSchemaHash: "sha256:cf5f62f51ea6d7766da7bfd3be7cbf1a5d41a9f8654023f89c8fb7d970d0c38e",
              approvalSchemaHash: "sha256:22f76d9a1c618a3cfaa891208a14f6e5e6ab1be4ff1c38cc8a8cd1e8fd0c0e4e",
              responseSchemaHash: "sha256:1c1996e67855b0d84c9802c0c8bd5a1ec85d540d391ea68ef3ee6b39f9a182be",
              interruptedRunId: runId,
              generation: 0,
            },
          },
        }],
      },
      metadata: { tanstack: { finishReason: "tool_calls" } },
    },
  ];
}

function OpenWithDraftButton() {
  const assistant = useAssistant();
  return (
    <button
      type="button"
      onClick={() => assistant.openWithDraft("How many active Todos do I have?")}
    >
      Try an example
    </button>
  );
}

describe("assistant components", () => {
  it("opens the drawer with an editable draft without sending it", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const createSession = vi.fn(async () => testSession);
    const client = createAssistantClient({
      createSession,
      fetchImplementation,
    });
    const user = userEvent.setup();
    render(
      <AssistantProvider createSession={createSession} client={client}>
        <OpenWithDraftButton />
        <AssistantDrawer />
      </AssistantProvider>,
    );

    expect(createSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try an example" }));

    const composer = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeVisible();
    expect(composer).toHaveValue("How many active Todos do I have?");
    await waitFor(() => expect(composer).toHaveFocus());
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("supports an unthemed host composition through props and semantic slots", async () => {
    render(
      <AssistantProvider createSession={async () => testSession}>
        <AssistantPanel
          className="host-panel"
          composerProps={{ className: "host-composer", placeholder: "Ask about projects" }}
          messagesProps={{ emptyState: <p>Host empty state</p> }}
          showDeveloperDetails={false}
        />
      </AssistantProvider>,
    );

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
    expect(screen.getByText("Host empty state")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute(
      "placeholder",
      "Ask about projects",
    );
    expect(document.querySelector('[data-caes-ai-slot="panel"]')).toHaveClass("host-panel");
    expect(document.querySelector('[data-caes-ai-slot="composer"]')).toHaveClass("host-composer");
    expect(screen.queryByText("Developer details")).toBeNull();
  });

  it("opens the drawer, streams safe Markdown, applies one-turn effort, and restores focus", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response("Hello **there** <img src=x onerror=alert(1)>");
    });
    const client = createAssistantClient({
      createSession: async () => testSession,
      fetchImplementation,
    });
    const user = userEvent.setup();
    const { container } = render(
      <AssistantProvider createSession={async () => testSession} client={client}>
        <AssistantLauncher />
        <AssistantInline />
        <AssistantDrawer />
      </AssistantProvider>,
    );

    expect(container.querySelector(".caes-ai-assistant--inline")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ask CAES AI" }));
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeInTheDocument();
    const message = screen.getAllByRole("textbox", { name: "Message" })[0]!;
    await waitFor(() => expect(message).toBeEnabled());
    const reasoning = screen.getAllByRole("combobox", { name: "Reasoning" })[0]!;
    await user.selectOptions(reasoning, "medium");
    await user.type(message, "Test the stream");
    fireEvent.keyDown(message, { key: "Enter" });

    await screen.findAllByText("there", { exact: false });
    expect(container.querySelector("img")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(reasoning).toHaveValue("default");
    expect(requestBodies[0]).toMatchObject({ forwardedProps: { reasoningEffort: "medium" } });

    await user.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByRole("dialog", { name: "Assistant" })).not.toBeInTheDocument();
  });

  it("shows exact approval arguments and resolves a rejection once", async () => {
    const approvalSession: AssistantSession = {
      ...testSession,
      sessionId: "00000000-0000-4000-8000-000000000002",
      tools: [{
        name: "add_todo",
        description: "Add an item.",
        execution: "server",
        risk: "write",
        needsApproval: true,
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            dueDate: { type: ["string", "null"], format: "date" },
            category: { type: ["string", "null"] },
          },
          required: ["title"],
          additionalProperties: false,
        },
        dataSchema: { type: "object" },
      }],
    };
    let requestCount = 0;
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      requestCount += 1;
      if (requestCount > 1) return response("Okay — no change was made.");
      const body = JSON.parse(String(init?.body)) as { runId: string; threadId: string };
      return eventResponse(approvalEvents({
        title: "Exact title",
        dueDate: null,
        category: null,
      }, body.runId, body.threadId));
    });
    const client = createAssistantClient({
      createSession: async () => approvalSession,
      fetchImplementation,
    });
    const user = userEvent.setup();
    render(
      <AssistantProvider createSession={async () => approvalSession} client={client}>
        <AssistantInline />
      </AssistantProvider>,
    );

    const message = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(message).toBeEnabled());
    await user.type(message, "Add it{Enter}");
    const approval = await screen.findByText("Approve add_todo?");
    expect(approval.closest("section")).toHaveTextContent('"title": "Exact title"');
    const reject = screen.getByRole("button", { name: "Reject" });
    await user.click(reject);

    await screen.findByText("Okay — no change was made.");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("renders unknown results safely and applies each typed UI effect once", async () => {
    const readSession: AssistantSession = {
      ...testSession,
      sessionId: "00000000-0000-4000-8000-000000000003",
      tools: [{
        name: "read_items",
        description: "Read items.",
        execution: "server",
        risk: "read",
        needsApproval: false,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        dataSchema: { type: "object" },
        presentation: { kind: "unknown-card", label: "Item list" },
      }],
    };
    const invalidateQuery = vi.fn();
    const showToast = vi.fn();
    const output = {
      data: { ignored: true },
      display: { kind: "unknown-card", props: { safe: "fallback data" } },
      uiEffects: [
        { type: "invalidate-query", key: ["items"] },
        { type: "toast", level: "success", message: "Items loaded." },
      ],
    };
    const client = createAssistantClient({
      createSession: async () => readSession,
      fetchImplementation: vi.fn<typeof fetch>(async () => {
        const events = toolEvents("read_items", {}, output, "run-tool", "thread-1", "tool-message");
        events.splice(
          1,
          0,
          { type: "TEXT_MESSAGE_START", messageId: "tool-message", role: "assistant", timestamp: Date.now() },
          { type: "TEXT_MESSAGE_CONTENT", messageId: "tool-message", delta: "Draft answer that should be hidden.", timestamp: Date.now() },
          { type: "TEXT_MESSAGE_END", messageId: "tool-message", timestamp: Date.now() },
        );
        return eventResponse(events);
      }),
    });
    const user = userEvent.setup();
    render(
      <AssistantProvider
        createSession={async () => readSession}
        client={client}
        uiBridge={{ invalidateQuery, showToast }}
      >
        <AssistantInline />
      </AssistantProvider>,
    );

    const message = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(message).toBeEnabled());
    await user.type(message, "Read{Enter}");

    await screen.findByText(/fallback data/);
    expect(screen.queryByText("Draft answer that should be hidden.")).toBeNull();
    await waitFor(() => {
      expect(invalidateQuery).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledTimes(1);
    });
    expect(invalidateQuery).toHaveBeenCalledWith(["items"]);
    expect(showToast).toHaveBeenCalledWith("success", "Items loaded.");
    await screen.findByText("Done.");
    const toolDetails = screen.getByText("Item list").closest("details");
    expect(toolDetails).not.toHaveAttribute("open");
    expect(invalidateQuery).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("renders a registered tool presentation as visible application UI", async () => {
    const summarySession: AssistantSession = {
      ...testSession,
      sessionId: "00000000-0000-4000-8000-000000000005",
      tools: [{
        name: "read_summary",
        description: "Read a summary.",
        execution: "server",
        risk: "read",
        needsApproval: false,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        dataSchema: { type: "object" },
        presentation: { kind: "summary-card", label: "Visible summary" },
      }],
    };
    const output = {
      data: { active: 7 },
      display: {
        kind: "summary-card",
        props: { scope: "active" },
        visibility: "inline",
        suppressAssistantText: true,
      },
      uiEffects: [],
    };
    const client = createAssistantClient({
      createSession: async () => summarySession,
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        eventResponse(toolEvents(
          "read_summary",
          {},
          output,
          "run-tool",
          "thread-1",
          "tool-message",
        ))),
    });
    const user = userEvent.setup();
    const { container } = render(
      <AssistantProvider
        createSession={async () => summarySession}
        client={client}
        renderers={{
          "summary-card": ({ data, props }) => (
            <div>{String((data as { active: number }).active)} {String(props.scope)} items</div>
          ),
        }}
      >
        <AssistantInline />
      </AssistantProvider>,
    );

    const message = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(message).toBeEnabled());
    await user.type(message, "Summarize{Enter}");

    await waitFor(() => expect(message).toBeEnabled());
    expect(await screen.findByRole("region", { name: "Visible summary" })).toBeVisible();
    expect(screen.getByText("7 active items")).toBeVisible();
    expect(screen.queryByText("Done.")).toBeNull();
    expect(container.querySelector("details.caes-ai-assistant__tool")).toBeNull();
  });

  it("keeps hidden tool data out of the conversation", async () => {
    const hiddenSession: AssistantSession = {
      ...testSession,
      sessionId: "00000000-0000-4000-8000-000000000006",
      tools: [{
        name: "read_for_analysis",
        description: "Read data for analysis.",
        execution: "server",
        risk: "read",
        needsApproval: false,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        dataSchema: { type: "object" },
        presentation: { kind: "private-list", label: "Private list" },
      }],
    };
    const output = {
      data: { items: ["raw item"] },
      display: {
        kind: "private-list",
        props: { items: ["raw item"] },
        visibility: "hidden",
      },
      uiEffects: [],
    };
    const client = createAssistantClient({
      createSession: async () => hiddenSession,
      fetchImplementation: vi.fn<typeof fetch>(async () =>
        eventResponse(toolEvents("read_for_analysis", {}, output))),
    });
    const user = userEvent.setup();
    const { container } = render(
      <AssistantProvider
        createSession={async () => hiddenSession}
        client={client}
        renderers={{ "private-list": () => <div>Raw private list</div> }}
      >
        <AssistantInline />
      </AssistantProvider>,
    );

    const message = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(message).toBeEnabled());
    await user.type(message, "Analyze{Enter}");

    expect(await screen.findByText("Done.")).toBeVisible();
    expect(screen.queryByText("Raw private list")).toBeNull();
    expect(screen.queryByText("Private list")).toBeNull();
    expect(container.querySelector("details.caes-ai-assistant__tool")).toBeNull();
  });

  it("hides the reasoning control when the effective session does not allow medium", async () => {
    const noReasoningSession: AssistantSession = {
      ...testSession,
      sessionId: "00000000-0000-4000-8000-000000000004",
      modelPolicy: {
        ...testSession.modelPolicy,
        defaultReasoningEffort: "none",
        maximumReasoningEffort: "none",
        allowedReasoningEfforts: ["none"],
      },
    };
    const client = createAssistantClient({
      createSession: async () => noReasoningSession,
      fetchImplementation: vi.fn<typeof fetch>(async () => response("Done.")),
    });
    render(
      <AssistantProvider createSession={async () => noReasoningSession} client={client}>
        <AssistantInline />
      </AssistantProvider>,
    );

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
    expect(screen.queryByRole("combobox", { name: "Reasoning" })).toBeNull();
  });
});
