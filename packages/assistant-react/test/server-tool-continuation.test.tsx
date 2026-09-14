import { EventType, type AnyTextAdapter, type ModelMessage } from "@tanstack/ai";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { describe, expect, it, vi } from "vitest";
import { chatRequestEnvelopeSchema, chatStreamEventSchema } from "@ucdavis/caes-ai-protocol";
import { buildApp, type ServerConfig } from "../../../apps/ai-server/src/app.js";
import { scriptedModelProvider } from "../../../apps/ai-server/test/helpers/scripted-model-provider.js";
import { StaticApplicationRegistry } from "../../../apps/ai-server/test/helpers/static-application-registry.js";
import { AssistantProvider, useAssistant } from "../src/context.js";
import { createAssistantClient } from "../src/client.js";
import { AssistantInline } from "../src/ui.js";

// Opt-in evidence contains only synthetic conversation data and rendered UI.
async function saveEvidence(name: string, html: string, transcript?: unknown) {
  const directory = process.env.CAES_AI_TEST_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const theme = await readFile(join(dirname(fileURLToPath(import.meta.url)), "../src/theme.css"), "utf8");
  await writeFile(join(directory, `${name}.html`), `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>CAES AI ${name}</title><style>${theme}
body { margin: 32px auto; max-width: 820px; padding: 0 24px; background: #f4f5f7; font-family: system-ui; }
</style></head><body><p>Local scripted Responses integration: ${name}</p>${html}</body></html>`);
  if (transcript) await writeFile(join(directory, `${name}.json`), JSON.stringify(transcript, null, 2));
}

const config: ServerConfig = {
  host: "127.0.0.1", port: 0, publicBaseUrl: "https://central.test", sessionTtlMs: 1800000,
  sessionSweepIntervalMs: 60000, maximumActiveSessions: 100, maximumSessionsPerApplication: 10,
  defaultModel: "test-model", allowedModels: ["test-model"], maximumReasoningEffort: "none",
  openAiApiKey: "synthetic-unused", toolTimeoutMs: 5000, maximumToolResponseBytes: 262144,
  callbackIssuer: "https://central.test", callbackTokenTtlMs: 60000, providerRetryAttempts: 1,
  providerRetryBaseDelayMs: 0, databaseUrl: "postgresql://unused.test/test", allowInsecureCallbacks: false,
};

describe("server tool continuations through the React client and HTTP API", () => {
  it.each(["read", "approve", "reject"] as const)("round trips Responses events through %s and a later turn", async (mode) => {
    let assistant!: ReturnType<typeof useAssistant>;
    const modelMessages: ModelMessage[][] = [];
    const requests: ReturnType<typeof chatRequestEnvelopeSchema.parse>[] = [];
    const wireEvents: ReturnType<typeof chatStreamEventSchema.parse>[] = [];
    const verifiedCallbacks: unknown[] = [];
    const adapter: AnyTextAdapter = {
      ...scriptedModelProvider.createAdapter("test-model"),
      async *chatStream(options) {
        modelMessages.push(structuredClone(options.messages));
        const { runId = "run", threadId = "thread" } = options;
        yield { type: EventType.RUN_STARTED, runId, threadId };
        const priorCall = options.messages.some(message => message.role === "assistant" && message.toolCalls?.length);
        if (!priorCall) {
          yield { type: EventType.TOOL_CALL_START, toolCallId: "call-work", toolCallName: "work", toolName: "work",
            parentMessageId: "message-work", metadata: { itemId: "fc_work" } };
          yield { type: EventType.TOOL_CALL_ARGS, toolCallId: "call-work", delta: "{}" };
          yield { type: EventType.TOOL_CALL_END, toolCallId: "call-work", toolCallName: "work", toolName: "work", input: {} };
          yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "tool_calls" };
          return;
        }
        const laterTurn = options.messages.filter(message => message.role === "user").length > 1;
        const answer = laterTurn ? "History received." : mode === "reject" ? "Rejected." : "Completed.";
        yield { type: EventType.TEXT_MESSAGE_START, messageId: laterTurn ? "later-answer" : "answer", role: "assistant" };
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: laterTurn ? "later-answer" : "answer", delta: answer };
        yield { type: EventType.TEXT_MESSAGE_END, messageId: laterTurn ? "later-answer" : "answer" };
        yield { type: EventType.RUN_FINISHED, runId, threadId, finishReason: "stop" };
      },
    };
    const callback = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://host.test/callback");
      const body = String(init?.body);
      const request = JSON.parse(body);
      const authorization = new Headers(init?.headers).get("authorization");
      expect(authorization?.startsWith("Bearer ")).toBe(true);
      const jwks = (await app.inject({ method: "GET", url: "/.well-known/jwks.json" })).json<JSONWebKeySet>();
      const { payload } = await jwtVerify(authorization!.slice(7), createLocalJWKSet(jwks), {
        algorithms: ["ES256"], issuer: config.callbackIssuer,
        audience: "caes-ai-app:example", typ: "caes-ai-tool-callback+jwt",
      });
      expect(payload).toMatchObject({
        sessionId: request.sessionId, toolCallId: "call-work", toolName: "work",
        requestHash: createHash("sha256").update(body).digest("base64url"),
      });
      verifiedCallbacks.push({ url: String(input), toolCallId: request.toolCallId,
        toolName: request.toolName, arguments: request.arguments, signatureVerified: true, bodyHashVerified: true });
      return Response.json({ protocolVersion: 1, ok: true, output: { data: { count: 4 }, uiEffects: [] } });
    });
    const app = buildApp({ config, modelProvider: { ...scriptedModelProvider, createAdapter: () => adapter }, fetchImplementation: callback,
      applicationRegistry: new StaticApplicationRegistry([{
        id: "example", apiKey: "synthetic-application-key", allowedOrigins: ["https://host.test"],
        toolCallbackUrl: "https://host.test/callback", allowedModels: ["test-model"], maximumReasoningEffort: "none",
      }]),
    });
    const createSession = async () => (await app.inject({ method: "POST", url: "/v1/sessions",
      headers: { authorization: "ApiKey synthetic-application-key" }, payload: {
        protocolVersion: 1, userReference: "example-user", contextToken: "synthetic-context-token",
        instructions: "Use the registered tool.",
        tools: [{ name: "work", description: "Perform the test operation.", execution: "server", risk: mode === "read" ? "read" : "write",
          needsApproval: mode !== "read", inputSchema: { type: "object", properties: {}, additionalProperties: false },
          dataSchema: { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false } }],
        modelPolicy: { requestedModel: null, defaultReasoningEffort: "none", maximumReasoningEffort: "none", allowPerTurnOverride: false },
      },
    })).json();
    const client = createAssistantClient({ createSession, fetchImplementation: async (input, init) => {
      requests.push(chatRequestEnvelopeSchema.parse(JSON.parse(String(init?.body))));
      const response = await app.inject({ method: "POST", url: new URL(String(input)).pathname,
        headers: Object.fromEntries(new Headers(init?.headers)), payload: String(init?.body) });
      expect(response.statusCode).toBe(200);
      for (const line of response.body.split("\n").filter(line => line.startsWith("data: "))) {
        const event = chatStreamEventSchema.parse(JSON.parse(line.slice(6)));
        expect(event.type).not.toBe("RUN_ERROR");
        expect(event.metadata.caesAi.protocolVersion).toBe(1);
        if (event.type === "TOOL_CALL_START") expect(event.metadata).not.toHaveProperty("itemId");
        if (event.type === "TOOL_CALL_END") {
          expect(event).not.toHaveProperty("toolName");
          expect(event).not.toHaveProperty("toolCallName");
        }
        wireEvents.push(event);
      }
      return new Response(response.body, { status: response.statusCode, headers: { "content-type": String(response.headers["content-type"]), "x-caes-ai-protocol-version": "1" } });
    } });
    function Control() { assistant = useAssistant(); return null; }
    const rendered = render(<AssistantProvider eager client={client} createSession={createSession}><Control /><AssistantInline /></AssistantProvider>);
    const user = userEvent.setup();
    const send = async (message: string) => {
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
        expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
      });
      await user.type(screen.getByRole("textbox", { name: "Message" }), message);
      await user.click(screen.getByRole("button", { name: "Send" }));
    };
    const text = () => JSON.stringify(assistant.messages);
    try {
      await waitFor(() => expect(assistant.session).toBeDefined());
      await send("Perform the operation.");
      if (mode !== "read") {
        await waitFor(() => expect(assistant.approvals).toHaveLength(1));
        expect(callback).not.toHaveBeenCalled();
        expect(screen.getByLabelText("Pending approvals")).toBeVisible();
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
          expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
        });
        await saveEvidence(`${mode}-pending`, rendered.container.innerHTML);
        await user.click(screen.getByRole("button", { name: mode === "approve" ? "Approve" : "Reject" }));
      }
      await waitFor(() => expect(text()).toContain(mode === "reject" ? "Rejected." : "Completed."));
      expect(assistant.error).toBeUndefined();
      expect(callback).toHaveBeenCalledTimes(mode === "reject" ? 0 : 1);
      if (mode === "read") {
        expect(modelMessages.at(-1)).toEqual(expect.arrayContaining([
          expect.objectContaining({ role: "assistant", toolCalls: expect.arrayContaining([
            expect.objectContaining({ metadata: expect.objectContaining({ itemId: "fc_work" }) }),
          ]) }),
        ]));
      } else {
        expect(requests.some(request => request.resume?.some(resume => resume.status === "resolved"))).toBe(true);
      }
      await send("What happened earlier?");
      expect(assistant.error).toBeUndefined();
      await waitFor(() => expect(text()).toContain("History received."));
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
      expect(assistant.error).toBeUndefined();
      expect(callback).toHaveBeenCalledTimes(mode === "reject" ? 0 : 1);
      expect(modelMessages.at(-1)).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: "assistant", toolCalls: expect.arrayContaining([
          expect.objectContaining({ id: "call-work", function: { name: "work", arguments: "{}" } }),
        ]) }),
        expect.objectContaining({ role: "tool", toolCallId: "call-work" }),
      ]));
      expect(screen.getByText("History received.")).toBeVisible();
      expect(JSON.stringify(requests)).not.toContain('"caesAi"');
      expect(JSON.stringify(assistant.messages)).not.toContain('"caesAi"');
      expect(verifiedCallbacks).toHaveLength(mode === "reject" ? 0 : 1);
      const transcript = { mode, transport: "Fastify public HTTP injection; HTTPS callback fetch seam",
        provider: "scripted Responses events", verifiedCallbacks, requests, wireEvents, messages: assistant.messages };
      expect(JSON.stringify(transcript)).not.toMatch(/synthetic-application-key|synthetic-context-token|Bearer /);
      await saveEvidence(`${mode}-history`, rendered.container.innerHTML, transcript);
    } finally { rendered.unmount(); await app.close(); }
  });
});
