# CAES AI application protocol version 1

This directory is the normative specification for the application-facing CAES
AI protocol. `protocol.schema.json` defines JSON bodies. This document defines
HTTP bindings and semantic constraints that JSON Schema cannot express. Files
under `fixtures/` are conformance examples, not an additional source of truth.

## Conformance

- Every body must validate against its named definition in
  `protocol.schema.json` and satisfy the semantic rules below.
- Receivers must reject unknown `protocolVersion` values. Version 1 is not
  negotiated.
- Unknown object properties are rejected wherever the schema sets
  `additionalProperties: false`.
- Tool names in one session request must be unique. Tool input and data schemas
  must describe JSON objects and compile under CAES AI's supported strict JSON
  Schema 2020-12 subset.
- A write tool must require approval. A client-executed tool cannot have write
  risk.

## Create session

`POST /v1/sessions`

- Request authorization: `Authorization: ApiKey <application-key>`
- Request body: `#/$defs/sessionCreationRequest`
- Success: HTTP 201 with `#/$defs/sessionCreationResponse`
- Failure: HTTP 4xx or 5xx with `#/$defs/caesAiErrorResponse`

The credential, not the body, identifies the application. `requestedModel` is a
model selector. Null and `default` select the central default profile; `fast`
and `deep` select those central profiles; any other string requests that exact
model. The resolved concrete model remains subject to central and application
allowlists.

## Tool callback

CAES AI sends `POST` to the fixed URL in the authenticated application
registration. It does not follow redirects.

- Authorization: `Authorization: Bearer <CAES-AI-signed-JWT>`
- Correlation: `X-CAES-AI-Request-Id` and `X-CAES-AI-Tool-Call-Id`
- Request body: `#/$defs/toolExecutionRequest`
- Response body: `#/$defs/toolExecutionResponse`

The ES256 JWT type is `caes-ai-tool-callback+jwt`, issuer is deployment
configuration, audience is `caes-ai-app:<applicationId>`, and subject is
`caes-ai-tool-service`. Its custom claims must match the session ID, tool-call
ID, tool name, manifest hash, and base64url SHA-256 hash of the exact request
body. Applications must validate signature, algorithm, type, issuer, audience,
subject, lifetime, unique token ID, custom claims, and body hash before dispatch.

## Browser chat transport

The `chatUrl` response identifies `POST /v1/sessions/{sessionId}/chat`, and the
`accessToken` is used as a Bearer credential. Clients must send
`X-CAES-AI-Protocol-Version: 1` and a `#/$defs/chatRequestEnvelope` body. The
server returns the same header and `Content-Type: text/event-stream`.

The request and event shapes use the AG-UI event vocabulary as a CAES AI-owned
version 1 profile. Requests contain the thread and run identifiers, current
messages, declared client tools, context, state, optional interrupt resume
values, and a `forwardedProps` object. CAES AI accepts only
`forwardedProps.reasoningEffort`; server tools always come from the frozen
session manifest rather than the browser request.

Each non-empty SSE `data:` field is one JSON object matching
`#/$defs/chatStreamEvent`. Every event repeats the version in
`metadata.caesAi.protocolVersion`. A
`RUN_STARTED` event opens a run. Text, reasoning, tool, state, activity, raw,
and custom events may follow. `RUN_FINISHED` or `RUN_ERROR` terminates it. CAES
AI does not send the legacy `[DONE]` sentinel. Event-specific fields follow the
event name and semantics listed by the version 1 AG-UI profile; CAES AI freezes
the permitted event-name set in `chatStreamEvent` so dependency upgrades cannot
silently introduce a new wire event.

The shared React package is the supported browser implementation. It removes
the underlying transport library's legacy duplicate `data` field, adds the
request version, verifies the response header and content type, and validates
every event before handing it to the internal chat runtime. TanStack types are
not part of this contract.

## Receiver validation and retained runtime metadata

The `chatRequestEnvelope` and `chatStreamEvent` definitions specify payload shapes,
including required event IDs, deltas, tool calls, terminal outcomes and approval
interrupts. Version 1 chat history supports text user messages, assistant messages,
tool results and reasoning messages. Multimodal and activity message inputs are not
part of this profile. Registered session tools remain authoritative; incoming tool
descriptors and context entries do not replace them.

Unknown fields are rejected except inside explicitly open application data, JSON
Schema and extension payload objects. `CUSTOM.value` and `RAW.event` are JSON extension
payloads; their presence does not grant tool execution authority. Resume payloads are
validated against the selected interrupt and registered tool schema at runtime.
Tool names must also be unique in a session manifest, a semantic registration rule.

The retained `metadata.tanstack` fields are enumerated in the schema. The retained
`tanstack:interruptBinding` object has `v: 1` and supports tool approval and client
tool execution. These are version 1 CAES AI wire fields despite their historical
names. New dependency metadata requires an explicit contract update. Runtime aliases
such as `toolName` are removed before wire validation; the client runtime can restore
them from the validated event. These structural checks do not add a signed approval
receipt or change the application's authorization responsibilities.

The server validates emitted events and returns a sanitized versioned `RUN_ERROR`
when an event is invalid. The React receiver checks events before delivering them
to the runtime. The .NET SDK embeds this schema and validates session/error responses
and callbacks before constructing DTOs. `fixtures/conformance.json` supplies shared
positive and negative receiver cases. After changing the chat profile, run the
protocol build, then `node packages/protocol/scripts/update-chat-schema.mjs`; the
conformance tests fail if the checked-in definitions differ.
