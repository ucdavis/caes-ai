# Architecture

## Trust boundaries

CAES AI separates model orchestration from application authority.

- The central service trusts only an active PostgreSQL application registration and API-key hash at session creation, and a session token at chat time.
- The application trusts only short-lived callbacks signed by CAES AI and its own signed context token at tool-execution time.
- The browser is untrusted for application credentials and identity assertions. It receives a scoped, expiring central token.
- The model is untrusted input. Its tool arguments cross JSON Schema validation and application business validation before anything executes.

The PostgreSQL application registry stores fixed destinations and policy, not tools. Application keys have public key IDs for lookup, but CAES AI stores only their SHA-256 hashes. The session request carries tools but cannot carry a callback URL. That combination lets team-owned applications iterate on their tools without allowing a model or compromised browser to turn the central server into a general HTTP proxy.

## Session lifecycle

1. The Todo API resolves `demo-user-1` and gives `UCDavis.CaesAi.AppSdk` its instructions and current five-tool manifest. The SDK creates a nonce-bearing HMAC context token, applies the configured model request, and calls the central service.
2. The central service resolves the key ID in PostgreSQL, compares the stored and supplied hashes in constant time, rejects revoked keys or disabled applications, then resolves policy. It validates protocol version 1, compiles Ajv validators, creates a canonical SHA-256 manifest hash, and deep-freezes the session data.
3. It returns 256 bits of random token material and stores only the token hash in PostgreSQL. The record expires after 30 minutes, and remains until a future retention job removes it. The session snapshot retains instructions, tool definitions and the application context token, but no conversation transcript.
4. The browser sends TanStack/AG-UI messages to the returned chat URL. A 401 makes the React client obtain one new application-created session and retry once.
5. The central service rebuilds TanStack tool definitions from the frozen manifest for each chat run and streams SSE without buffering the full answer.

The React provider creates no session merely because it mounted. Opening or embedding the assistant creates one lazily; `eager` is an explicit opt-in. Every server instance reads session state from PostgreSQL, so restarts and horizontal scaling do not invalidate or partition sessions. Expiration is enforced on authentication and active-session counts.

## Application registry

Drizzle's TypeScript schema defines the registry, session, run, and tool-call tables; generated SQL migrations are checked in. CAES AI applies pending migrations before it starts listening. The administration CLI uses the same migration and database code.

Each generated application key has a random key ID and 256 bits of secret material. The key ID selects one active row. CAES AI hashes the complete key and compares it to the stored hash before returning the application callback and policy. Rotation creates an overlapping key. Revocation marks one key, while application disablement blocks every key and browser origin for that application.

`/health` reports process liveness. `/ready` queries PostgreSQL and returns 503 when persistence is unavailable. Browser CORS begins with the union of enabled application origins, and the chat handler additionally binds each request origin to the application snapshot on that authenticated session. One registered application origin therefore cannot use another application's stolen session token.

## Tool execution

`ToolGatewayClient` is generic. It looks up a descriptor by name, validates arguments, signs a per-call ES256 JWT, and calls the registration's fixed callback with the session context. It applies timeout and response-size limits and validates the returned envelope. It never retries a mutation.

Applications describe only a tool's argument schema and business-data schema. CAES AI owns and composes the output envelope containing `data`, `display`, and `uiEffects`. The central response returns the exact validated descriptors stored in the session, so application backends do not reconstruct a second, potentially divergent browser manifest.

The JWT audience identifies the application. Its claims bind the session ID, tool-call ID, tool name, immutable manifest hash, and SHA-256 hash of the exact JSON body. `UCDavis.CaesAi.AppSdk` accepts only `ES256` and the CAES AI callback token type; validates issuer, audience, signature, and lifetime from CAES AI's JWKS; refreshes on an unknown `kid`; and retains last-known-good keys through a temporary JWKS outage. It then validates the app-owned context and passes the verified user reference to the Todo-owned dispatcher. CAES AI refuses redirects on callback requests and requires HTTPS callback registrations outside loopback or an explicit local-development override.

The default signer stores a private JWK key ring in a mode-0600 file outside source control. `pnpm caes-ai signing-key rotate` creates a new active key while retaining old verification keys; after the maximum callback lifetime and application JWKS cache window, `signing-key retire <kid>` removes the old key. A server restart reloads the key ring after either operation. Deployment can replace this implementation with a managed signer without changing JWT claims or application validation.

The SDK supplies a stable request identity derived from protocol version, session, tool call, tool name, verified user, and arguments. The Todo application durably records that identity, the request hash, and the response before replaying a mutation result. A reused tool-call ID with different arguments or user scope fails instead of returning an unrelated result.

Read tools execute automatically. Write descriptors are rejected at session creation unless `needsApproval` is true. TanStack's approval interrupt occurs before the gateway executor runs.

## Host-page integration

The React package does not know about Todos. The host registers `todo-list`, `todo-summary`, and `todo-item` renderers. The application marks each result `inline`, `details`, or `hidden`, so registering a renderer does not make every invocation user-visible. A result can suppress redundant assistant prose when an inline renderer fully answers the request; the client ignores that request when the renderer is unavailable. Structured tool results can emit only validated query invalidations and toasts. A processed-ID set makes effects at-most-once within the mounted conversation.

The browser-owned `set_todo_filter` client tool changes a closed `all | active | completed` state union. It proves page control without exposing a general callback or script mechanism.

## Reasoning policy

Policy is an intersection, not delegation:

```text
central allowed models and effort ceiling
  ∩ application allowlist and effort ceiling
    ∩ session request and ceiling
      ∩ optional one-turn effort request
        ∩ efforts supported by the chosen model
```

Null and `default` resolve through the central default model profile. `fast` and `deep` resolve through their corresponding central profiles. Any other selector requests that exact model. This preserves application control while requiring the resolved concrete model to pass both the central and application allowlists.

Invalid requests fail instead of being silently downgraded. Logs include the effective model and effort, not hidden reasoning.

CAES AI has one model transport: OpenAI's Responses API through TanStack AI. The provider reports the reasoning efforts it supports, and the policy intersection determines which of those an application and session may use.

## Provider operations

Chat orchestration depends on a small `ModelProvider` interface rather than constructing an OpenAI adapter in the HTTP route. The sole runtime implementation builds the OpenAI Responses adapter, reports model capabilities, supplies model options, and adds telemetry middleware. The interface remains a useful unit-test seam; it is not a runtime provider plugin system.

Runs carry application, session, run, provider, transport, model, effort, duration, outcome, and normalized token-usage metadata. Tool-call records carry IDs, tool name, declared risk, timing, outcome, and a safe error code. PostgreSQL stores those records but never prompts, messages, tool arguments, tool results, or assistant text.

OpenTelemetry export is opt-in. When enabled, CAES AI installs the Node SDK before loading the HTTP server, database driver, or model adapter. OTLP HTTP/protobuf exporters send traces and metrics to the configured standard endpoint. Instrumentation covers HTTP, Fastify, PostgreSQL, and model work while disabling Fastify health-route spans, enhanced database reporting, and routine prompt/result capture. Full exception messages and stacks remain in the trusted OTEL destination; telemetry therefore has no content-free guarantee. The engine’s duplicate console exception logger is disabled. Active trace and span IDs are added to structured logs. With export disabled, local development installs no provider or exporter.

Provider retries are deliberately narrow. CAES AI buffers only the initial `RUN_STARTED` event and retries a transient failure only before any other observable output and before any write tool executor begins. Authentication, permission, invalid-request, content, and not-found failures are not retried. Backoff and attempt count are bounded by central configuration.

Browser disconnects cancel the chat run. Cancellation prevents callback dispatch, including after asynchronous token signing, and aborts read callbacks in flight. A dispatched, approved write retains its existing callback timeout and can finish after the browser disconnects. Its tool record captures the actual result while the chat run records `cancelled`. Cancellation cannot roll back an application mutation, and this path does not retry callbacks. Shutdown coordination and mutation-outcome recovery remain deferred.

## Protocol ownership

Every CAES AI-owned session, browser chat, stream event metadata, and callback body carries protocol version 1. Browser chat also sends and receives `X-CAES-AI-Protocol-Version: 1`. `contracts/v1/protocol.schema.json` is normative. The TypeScript validators and .NET DTOs implement the application-side schema; the React client implements the browser-chat schema. Shared checked-in fixtures verify both. Version 1 is strict rather than negotiated: unknown versions fail with `unsupported_protocol_version`. A later version can support an overlap period without weakening the current contract.

`@ucdavis/caes-ai-protocol` owns runtime wire validation and shared envelopes. `UCDavis.CaesAi.AppSdk` owns application-side .NET transport, callback authentication, context validation, and request-identity helpers. The React package exposes CAES AI session, message, renderer, UI-effect, and tiny client-tool types; TanStack AI stays behind that public boundary. Applications still own current-user authentication and reauthorization, business handlers, persistence, and output data schemas.

## Production work

Before production: mount or replace the file key ring with deployment-grade secret storage, add managed workload identity, complete a data-classification review, accessibility review, connect the OTLP endpoint to the chosen monitoring backend, and finish deployment/runbook work. Automated signing-key rotation, session revocation and retention jobs, per-application request quotas, and outbound-network allowlisting are deferred. Current-user authentication and reauthorization remain application responsibilities rather than central policy.

The September 2026 [review dispositions](architecture-review-follow-up.md) record the targeted repairs, pinned findings and deferred shutdown and session-limit work.
