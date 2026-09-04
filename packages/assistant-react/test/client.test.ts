import { describe, expect, it, vi } from "vitest";
import {
  caesAiProtocolVersionHeader,
  currentProtocolVersion,
} from "@ucdavis/caes-ai-protocol";

import { createAssistantClient } from "../src/client.js";
import type { AssistantSession } from "../src/types.js";

function session(id: string): AssistantSession {
  return {
    protocolVersion: currentProtocolVersion,
    sessionId: id === "first"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
    accessToken: `token-${id}-${"x".repeat(32)}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    chatUrl: `https://central.test/${id}/chat`,
    modelPolicy: {
      model: "test-model",
      defaultReasoningEffort: "low",
      maximumReasoningEffort: "medium",
      allowedReasoningEfforts: ["low", "medium"],
    },
    toolManifestHash: "a".repeat(64),
    tools: [],
  };
}

function eventStream(): Response {
  const events = [
    { type: "RUN_STARTED", runId: "run-1", threadId: "thread-1", timestamp: Date.now(), metadata: { caesAi: { protocolVersion: currentProtocolVersion } } },
    { type: "RUN_FINISHED", runId: "run-1", threadId: "thread-1", timestamp: Date.now(), metadata: { caesAi: { protocolVersion: currentProtocolVersion } } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: {
      "content-type": "text/event-stream",
      [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
    },
  });
}

describe("createAssistantClient", () => {
  it.each([
    { type: "TEXT_MESSAGE_CONTENT" },
    { type: "TOOL_CALL_START", toolCallId: "call", toolCallName: "read", toolName: "read" },
    { type: "RUN_FINISHED", runId: "run", threadId: "thread", unexpected: true },
  ])("rejects malformed wire events before transport normalization", async (event) => {
    const client = createAssistantClient({ createSession: async () => session("first"),
      fetchImplementation: async () => new Response(`data: ${JSON.stringify({ ...event, metadata: { caesAi: { protocolVersion: 1 } } })}\n\n`, {
        headers: { "content-type": "text/event-stream", [caesAiProtocolVersionHeader]: "1" },
      }),
    });
    await expect((async () => {
      for await (const event of client.connection.connect([], {}, undefined, { threadId: "thread", runId: "run" })) void event;
    })()).rejects.toThrow();
  });

  it("validates SSE frames split across byte and UTF-8 boundaries", async () => {
    const event = { type: "TEXT_MESSAGE_CONTENT", messageId: "message", delta: "café", metadata: { caesAi: { protocolVersion: 1 } } };
    const bytes = new TextEncoder().encode(`: comment\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
    const client = createAssistantClient({ createSession: async () => session("first"),
      fetchImplementation: async () => new Response(new ReadableStream({ start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      } }), { headers: { "content-type": "text/event-stream", [caesAiProtocolVersionHeader]: "1" } }),
    });
    const events = [];
    for await (const value of client.connection.connect([], {}, undefined, { threadId: "thread", runId: "run" })) events.push(value);
    expect(events).toEqual([event]);
  });
  it("rejects an unsupported or malformed host session response", async () => {
    const createSession = vi.fn(async () => ({
      ...session("wrong-version"),
      protocolVersion: 2,
    }) as unknown as AssistantSession);
    const client = createAssistantClient({ createSession });

    await expect(client.ensureSession()).rejects.toThrow();
    expect(client.getSession()).toBeUndefined();
  });

  it("renews an expired server session and retries once", async () => {
    const createSession = vi
      .fn<() => Promise<AssistantSession>>()
      .mockResolvedValueOnce(session("first"))
      .mockResolvedValueOnce(session("second"));
    const authorizations: string[] = [];
    const protocolVersions: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      authorizations.push(headers.get("authorization") ?? "");
      protocolVersions.push(headers.get(caesAiProtocolVersionHeader) ?? "");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return authorizations.length === 1
        ? new Response(null, { status: 401 })
        : eventStream();
    });
    const client = createAssistantClient({ createSession, fetchImplementation });

    const received = [];
    for await (const event of client.connection.connect(
      [],
      {},
      new AbortController().signal,
      { threadId: "thread-1", runId: "run-1" },
    )) {
      received.push(event.type);
    }

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(authorizations).toEqual([
      `Bearer token-first-${"x".repeat(32)}`,
      `Bearer token-second-${"x".repeat(32)}`,
    ]);
    expect(protocolVersions).toEqual(["1", "1"]);
    expect(bodies[1]).toMatchObject({
      protocolVersion: currentProtocolVersion,
      threadId: "thread-1",
      runId: "run-1",
    });
    expect(bodies[1]).not.toHaveProperty("data");
    expect(received).toContain("RUN_FINISHED");
  });

  it("rejects a successful stream without the negotiated protocol version", async () => {
    const client = createAssistantClient({
      createSession: async () => session("first"),
      fetchImplementation: async () => new Response("", {
        headers: { "content-type": "text/event-stream" },
      }),
    });

    const consume = async () => {
      for await (const _event of client.connection.connect(
        [],
        {},
        undefined,
        { threadId: "thread-1", runId: "run-1" },
      )) {
        // Consume the stream so transport validation runs.
        void _event;
      }
    };

    await expect(consume()).rejects.toThrow();
  });

  it("rejects an event from another protocol version", async () => {
    const invalidEvent = new Response(
      `data: ${JSON.stringify({ type: "RUN_STARTED", metadata: { caesAi: { protocolVersion: 2 } } })}\n\n`,
      {
        headers: {
          "content-type": "text/event-stream",
          [caesAiProtocolVersionHeader]: String(currentProtocolVersion),
        },
      },
    );
    const client = createAssistantClient({
      createSession: async () => session("first"),
      fetchImplementation: async () => invalidEvent,
    });

    const consume = async () => {
      for await (const _event of client.connection.connect(
        [],
        {},
        undefined,
        { threadId: "thread-1", runId: "run-1" },
      )) {
        // Consume the stream so event validation runs.
        void _event;
      }
    };

    await expect(consume()).rejects.toThrow();
  });
});
