# CAES AI protocol

The normative application-facing specification is `contracts/v1/README.md` plus `contracts/v1/protocol.schema.json`. `@ucdavis/caes-ai-protocol` contains the matching TypeScript runtime validators and publishes the schema at its `schema` export; `UCDavis.CaesAi.AppSdk` contains the matching application-side .NET DTOs and packages the same schema as content. Every session-creation and tool-callback contract body includes `protocolVersion: 1`; central error responses also report the version they speak. Unsupported versions fail explicitly. Shared JSON fixtures under `contracts/v1/fixtures` must pass the normative JSON Schema, TypeScript validators, and .NET contract tests.

## Application session creation

`POST /v1/sessions` uses `Authorization: ApiKey <credential>`. The key identifies the application; no application ID is accepted from the request body. The body contains the protocol version, an opaque user reference, an application-signed context token, application instructions, requested model policy, and up to 32 tools. `requestedModel` is a selector: null and `default` use the central default profile, `fast` and `deep` use their central profiles, and any other string requests that exact model. Every resolved concrete model still has to pass the central and application allowlists.

Each tool declares a lowercase name, bounded description, `server | client` execution, `read | write | ui` risk, approval flag, an object `inputSchema`, an object `dataSchema`, and an optional presentation kind. The application schemas describe tool arguments and business data only. CAES AI composes the server-tool output schema from `dataSchema` plus its shared `display` and `uiEffects` envelope. A write tool must require approval; a client tool cannot be a write. Descriptors are strict, so an attempted callback URL or other unrecognized property fails validation.

The serialized manifest is limited to 64 KiB by `SessionStore`; each central HTTP body and tool response is separately bounded. Schemas compile under strict Ajv. The server stores a deep-frozen clone and returns its canonical SHA-256 hash.

## Browser session response

The central response has `protocolVersion`, `sessionId`, `accessToken`, `expiresAt`, `chatUrl`, the effective model policy, `toolManifestHash`, and CAES AI's validated tool descriptors. The application backend forwards that browser-safe response without reattaching its original manifest. It does not return the application key, callback JWT, context token, signing key, or provider key.

## Chat

`POST /v1/sessions/{sessionId}/chat` uses `Authorization: Bearer <session token>`. The request sends `X-CAES-AI-Protocol-Version: 1` and the strict CAES AI chat envelope. CAES AI accepts only `reasoningEffort` as a forwarded property. The response repeats the version header and is `text/event-stream`; every JSON event includes `metadata.caesAi.protocolVersion: 1` and a permitted version 1 event name.

The React transport removes its internal transport library's legacy duplicate `data` field, adds the request version, validates the response header and content type, and validates each event. It renews once on an HTTP 401 using the host application's session factory. It does not send a central session token to the Todo API.

## Tool callback

The central service calls the configured application gateway with:

- `Authorization: Bearer <short-lived CAES AI-signed JWT>`
- `X-CAES-AI-Request-Id`
- `X-CAES-AI-Tool-Call-Id`
- protocol version, session ID, tool-call ID, tool name, frozen manifest hash, arguments, and opaque application context in JSON

CAES AI publishes public keys at `GET /.well-known/jwks.json`. The JWT header is `alg=ES256`, `typ=caes-ai-tool-callback+jwt`, and carries a `kid`. Standard claims include the configured CAES AI issuer, `aud=caes-ai-app:<applicationId>`, `sub=caes-ai-tool-service`, `iat`, `nbf`, `exp`, and `jti`. Custom claims repeat the session ID, tool-call ID, tool name, manifest hash, and the base64url SHA-256 hash of the exact request body. The application must validate all of them before dispatch. CAES AI rejects HTTP redirects rather than forwarding a signed callback to another destination.

Success returns `{ protocolVersion: 1, ok: true, output }`. `output` contains application data, optional CAES AI presentation metadata, and only known UI effects. `display.visibility` is `inline`, `details`, or `hidden`, and defaults to `details`. This lets one tool return a visible answer on one call and private working data on another. A display may set `suppressAssistantText: true` when its inline registered renderer fully answers the request. The client honors that only when the renderer exists, so a missing host integration cannot hide the model's fallback answer. Failure returns `{ protocolVersion: 1, ok: false, error: { code, message, retryable } }`. The central service converts transport, validation, timeout, and application failures into short safe tool errors.

## Stable error vocabulary

The alpha uses stable boundary codes including `unsupported_protocol_version`, `invalid_application_key`, `invalid_callback_token`, `invalid_session_token`, `origin_not_allowed`, `insecure_tool_callback`, `session_expired`, `session_limit_reached`, `invalid_tool_manifest`, `invalid_tool_arguments`, `invalid_tool_output`, `tool_not_found`, `tool_timeout`, `tool_execution_failed`, `model_not_allowed`, `reasoning_effort_not_allowed`, and provider-unavailable/error variants. Human messages are safe and intentionally do not contain exception details.

## Versioning

Version 1 is explicit but not negotiated. A client sends the one version it supports, and the receiver either accepts it or returns `unsupported_protocol_version`. A future version can add an overlap window when independently deployed applications require it. TanStack-specific types stay internal to the browser package and central implementation. Application registration, session creation, browser chat, callbacks, errors, presentations, and UI effects use CAES AI-owned schemas.
