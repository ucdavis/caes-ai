import { fetchServerSentEvents } from "@tanstack/ai-react";
import {
  caesAiProtocolVersionHeader,
  chatStreamEventSchema,
  parseChatRuntimeEvent,
  currentProtocolVersion,
  sessionCreationResponseSchema,
} from "@ucdavis/caes-ai-protocol";

import type {
  AssistantClient,
  AssistantSession,
  CreateAssistantClientOptions,
} from "./types.js";

export function createAssistantClient({
  createSession,
  fetchImplementation = fetch,
  onSession,
}: CreateAssistantClientOptions): AssistantClient {
  let session: AssistantSession | undefined;
  let pending: Promise<AssistantSession> | undefined;

  const ensureSession = async (force = false): Promise<AssistantSession> => {
    const expiresSoon = session
      ? Date.parse(session.expiresAt) <= Date.now() + 5_000
      : true;
    if (!force && session && !expiresSoon) return session;
    if (!force && pending) return pending;

    pending = createSession()
      .then((created) => sessionCreationResponseSchema.parse(created))
      .then((created) => {
        session = created;
        onSession?.(created);
        return created;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  const send = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const call = async (active: AssistantSession) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${active.accessToken}`);
      headers.set(caesAiProtocolVersionHeader, String(currentProtocolVersion));
      const body = versionChatRequest(init?.body);
      const response = await fetchImplementation(active.chatUrl, {
        ...init,
        headers,
        body,
      });
      if (response.ok) {
        validateChatResponse(response);
        return validateWireEvents(response);
      }
      return response;
    };

    let active = await ensureSession();
    let response = await call(active);
    if (response.status === 401) {
      session = undefined;
      active = await ensureSession(true);
      response = await call(active);
    }
    return response;
  };

  const tanStackConnection = fetchServerSentEvents(
    "https://caes-ai.invalid/session/chat",
    { fetchClient: send },
  );

  return {
    connection: {
      async *connect(messages, data, abortSignal, runContext) {
        for await (const event of tanStackConnection.connect(
          messages as never[],
          data,
          abortSignal,
          runContext,
        )) {
          yield parseChatRuntimeEvent(event);
        }
      },
    },
    ensureSession,
    clearSession() {
      session = undefined;
    },
    getSession: () => session,
  };
}

function versionChatRequest(body: BodyInit | null | undefined): string {
  if (typeof body !== "string") {
    throw new Error("CAES AI chat requests must have a JSON body.");
  }
  const value: unknown = JSON.parse(body);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CAES AI chat requests must be JSON objects.");
  }
  const request = { ...value as Record<string, unknown> };
  Reflect.deleteProperty(request, "data");
  return JSON.stringify({
    ...request,
    protocolVersion: currentProtocolVersion,
  });
}

function validateChatResponse(response: Response): void {
  const responseVersion = response.headers.get(caesAiProtocolVersionHeader);
  if (responseVersion !== String(currentProtocolVersion)) {
    throw new Error(
      `CAES AI returned unsupported chat protocol version ${responseVersion || "unknown"}.`,
    );
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    throw new Error("CAES AI returned an invalid chat stream content type.");
  }
}

function validateWireEvents(response: Response): Response {
  if (!response.body) throw new Error("CAES AI returned an empty chat stream.");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffered = "";
  const validateFrame = (frame: string) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
    if (!data) return;
    try {
      chatStreamEventSchema.parse(JSON.parse(data));
    } catch {
      throw new Error("CAES AI returned an invalid protocol event.");
    }
  };
  // Check the wire before the transport restores convenience aliases from metadata.
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffered)) !== null) {
        const frame = buffered.slice(0, boundary.index);
        validateFrame(frame);
        controller.enqueue(encoder.encode(`${frame}\n\n`));
        buffered = buffered.slice(boundary.index + boundary[0].length);
      }
    },
    flush(controller) {
      buffered += decoder.decode();
      if (buffered.trim()) {
        validateFrame(buffered);
        controller.enqueue(encoder.encode(`${buffered}\n\n`));
      }
    },
  }));
  return new Response(body, { status: response.status, headers: response.headers });
}
