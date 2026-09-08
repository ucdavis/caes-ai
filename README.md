# CAES AI

CAES AI is a shared AI integration service for applications maintained by the UC Davis College of Agricultural and Environmental Sciences. The central service holds the model credential and policy; each application keeps ownership of its users, data, business rules, tools, and UI integration.

This repository contains the reviewed foundation for an internal beta: a TypeScript/Fastify AI server using TanStack AI, reusable React and .NET application packages, and a React + .NET 10 Todo reference application. The local path is tested. Azure deployment and integration with a real authenticated host are the next milestones. See [first internal beta](docs/beta-milestone.md) for the scope and acceptance criteria.

## Architecture

```mermaid
sequenceDiagram
  participant B as Browser + assistant-react
  participant T as .NET Todo API
  participant C as Central AI server
  participant P as PostgreSQL
  participant O as OpenAI API

  B->>T: POST /api/assistant/session
  T->>C: App API key + context + dynamic tools
  C->>P: Resolve app, key hash, callback, and policy
  C->>P: Persist session and content-free operations
  C-->>T: Protocol v1 + accepted tools + short-lived token
  T-->>B: Browser-safe session
  B->>C: TanStack AI chat over SSE
  C->>O: Messages, policy, runtime tools
  O-->>C: Text and tool calls
  C->>T: Fixed callback + per-call ES256 JWT
  T->>C: Fetch JWKS on first callback / unknown kid
  C-->>T: Public verification keys
  T-->>C: Validated structured result + UI effects
  C-->>B: Streamed result
  B->>B: Invalidate TanStack Query / change host filter
```

The browser never receives an application key, callback JWT, context-signing key, CAES AI private signing key, or OpenAI key. It gets only a 30-minute token bound to one immutable session manifest. The assistant creates that session only when its UI is opened or rendered unless the host explicitly opts into eager creation.

## Package map

| Location | Purpose |
| --- | --- |
| [apps/ai-server](apps/ai-server/README.md) | Central Fastify service, PostgreSQL application registry, admin CLI, bounded sessions, provider boundary, TanStack AI orchestration, and generic tool gateway |
| [packages/UCDavis.CaesAi.AppSdk](packages/UCDavis.CaesAi.AppSdk/README.md) | Packable .NET contracts, session client, signed context, schema and idempotency helpers, and ASP.NET Core callback endpoint |
| [packages/assistant-react](packages/assistant-react/README.md) | Headless React runtime plus opt-in accessible UI components and starter theme |
| [packages/protocol](packages/protocol/README.md) | Strict shared session, manifest, callback, error, and UI-effect schemas |
| [apps/todo-app/api](apps/todo-app/api/README.md) | .NET 10/EF Core Todo API, signed application context, tool definitions, explicit handlers, and SQLite data |
| [apps/todo-app/web](apps/todo-app/web/README.md) | Todo UI, TanStack Query integration, client tool, and Todo-specific result renderers |
| [tests/e2e](tests/e2e/README.md) | Playwright proof of the normal and live assistant flows |

## Requirements

- Node.js 22+
- npm 11.19.1, matching CI and Docker builds
- .NET SDK 10
- Chromium installed by Playwright for the browser test
- Docker Desktop or another Compose implementation. PostgreSQL runs in Docker for native and containerized development.

If your Node installation includes a different npm version, run
`npm install --global npm@11.19.1` once. Corepack is not required.

The root `package.json` lists npm workspaces in build order: protocol, React
package, AI server, Todo frontend and E2E tests. Keep dependencies before their
consumers when adding a workspace. Internal package dependencies use normal
version ranges, and npm links matching local workspaces during installation.

The npm override keeps `@tanstack/openai-base` at the previously tested 0.10.8.
Version 0.10.10 requires TanStack AI 0.53, beyond the current 0.52 provider contract.
Update that override with the TanStack AI packages when upgrading the provider.
The root esbuild development dependency supplies Vite's build peer; Drizzle keeps
its older esbuild dependency separately.

## Native setup

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env.
npm ci
dotnet restore apps/todo-app/UCDavis.CaesAi.Todo.slnx
npm exec --workspace @ucdavis/caes-ai-e2e -- playwright install chromium
npm run dev
```

`npm run dev` starts the PostgreSQL container, applies checked-in migrations, idempotently creates the local Todo registration, and starts the applications. It always uses OpenAI's Responses API and requires `OPENAI_API_KEY`. Open <http://localhost:5173>. The central service is at <http://localhost:4310>, the Todo API is at <http://localhost:5180>, and PostgreSQL is exposed on port 54329.

## Docker Compose

The complete demonstration starts with an `OPENAI_API_KEY` in `.env` and:

```bash
docker compose up --build
```

Open <http://localhost:8080>. Compose exposes the central server on 4310 and the Todo API on 5180, uses internal DNS for callbacks, and persists the CAES AI database, callback signing key ring, and Todo SQLite data in separate Docker volumes. A one-shot development bootstrap container applies migrations and creates the local Todo registration before CAES AI starts. That demo bootstrap is separate from the general administration CLI.

Compose supplies development-only fallback application credentials. It does not supply a fallback OpenAI credential. Override all credential variables before using the stack outside a single-developer machine.

## Configuration

| Variable | Owner | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | central + admin CLI | PostgreSQL connection string; local development uses the Docker database on port 54329 |
| `CAES_AI_POSTGRES_PASSWORD` | Compose | Optional override for the local PostgreSQL container password |
| `OPENAI_API_KEY` | central | Provider credential; never sent to an application |
| `OPENAI_DEFAULT_MODEL` / `OPENAI_ALLOWED_MODELS` | central | Back-compatible default and central concrete-model allowlist |
| `CAES_AI_MODEL_PROFILE_DEFAULT` / `CAES_AI_MODEL_PROFILE_FAST` / `CAES_AI_MODEL_PROFILE_DEEP` | central | Stable model selectors resolved to concrete model names |
| `CAES_AI_MAX_REASONING_EFFORT` | central | Global reasoning ceiling |
| `CAES_AI_PUBLIC_BASE_URL` | central | Browser-reachable base used in session chat URLs |
| `CAES_AI_CALLBACK_ISSUER` | central + application | Exact issuer expected in signed tool callbacks; defaults to the central public URL |
| `CAES_AI_CALLBACK_SIGNING_KEYS_PATH` | central + signing-key CLI | Durable private JWK key-ring path; keep outside source control and protect as a secret |
| `CAES_AI_ALLOW_INSECURE_CALLBACKS` | central + admin/local setup | Development-only override for HTTP callback destinations such as Docker's internal service URL |
| `CAES_AI_SESSION_TTL_MS` / `CAES_AI_SESSION_SWEEP_INTERVAL_MS` | central | Session lifetime and expired-session cleanup interval |
| `CAES_AI_MAX_ACTIVE_SESSIONS` / `CAES_AI_MAX_SESSIONS_PER_APPLICATION` | central | Global and per-application active-session limits backed by PostgreSQL |
| `CAES_AI_PROVIDER_RETRY_ATTEMPTS` / `CAES_AI_PROVIDER_RETRY_BASE_DELAY_MS` | central | Bounded pre-output retry count and exponential-backoff base |
| `CAES_AI_OTEL_ENABLED` | central | Explicitly enables OTLP trace and metric export; defaults to `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | central | Standard OTLP base endpoint required when export is enabled; separate trace and metric endpoints are also supported |
| `OTEL_SERVICE_NAME` | central | Exported service name; defaults to `caes-ai` |
| `CAES_AI_ALLOWED_ORIGINS` | local setup command | Exact Todo browser origins written to the local database registration |
| `TODO_APP_API_KEY` | local setup command + Todo API | Local application authentication credential; CAES AI stores only its SHA-256 hash |
| `CAES_AI_TODO_GATEWAY_URL` | local setup command | Fixed Todo callback destination written to PostgreSQL |
| `CaesAi__ApplicationId` | Todo API | Stable ID used as the callback JWT audience |
| `CaesAi__ContextSigningKey` | Todo API | HMAC key for the opaque per-session application context |
| `CaesAi__ServerUrl` | Todo API | Server-to-server central URL |
| `TODO_AI_MODEL` / `CaesAi__Model` | Todo API | Optional requested model, still subject to central policy |
| `CaesAi__DefaultReasoningEffort` | Todo API | Session default (`none` in the Todo demo) |
| `CaesAi__MaximumReasoningEffort` | Todo API | Session ceiling (`none` in the Todo demo) |

The trusted application registry is in PostgreSQL. `applications` stores callback and policy metadata. `application_api_keys` stores key IDs and SHA-256 hashes, never plaintext keys. The local bootstrap command uses `.env` only to create the Todo demo registration. The running CAES AI server does not read that application key.

`assistant_sessions` stores restart-safe sessions, including only the browser-token hash. `assistant_runs` and `assistant_tool_calls` store identifiers, policy, timing, outcomes, safe error codes, and token counts. They deliberately have no columns for prompts, messages, arguments, results, or rendered output.

## Application administration

Create an application with a fixed callback, one or more browser origins, and its model policy:

```bash
npm run caes-ai -- app create walter \
  --display-name "Walter" \
  --callback-url https://walter.example.edu/api/ai/tools/execute \
  --origin https://walter.example.edu \
  --model gpt-5.6-luna \
  --max-reasoning medium
```

The command prints the new API key once. CAES AI stores its key ID and hash. Operational commands do not print key material:

```bash
npm run caes-ai -- app list
npm run caes-ai -- app update walter --model gpt-5.6-luna --model gpt-5.6-sol
npm run caes-ai -- app rotate-key walter --label september-rotation
npm run caes-ai -- app revoke-key walter <old-key-id>
npm run caes-ai -- app disable walter
npm run caes-ai -- app enable walter
```

`rotate-key` leaves the prior key active so the application can switch without downtime. Revoke it after the application uses the replacement. Each command applies pending migrations before changing data.

Callback signing keys have a separate overlap workflow:

```bash
npm run caes-ai -- signing-key list
npm run caes-ai -- signing-key rotate
# Restart CAES AI, then wait beyond callback JWT lifetime and app JWKS caches.
npm run caes-ai -- signing-key retire <old-kid>
# Restart CAES AI again.
```

## Dynamic tools and approvals

The Todo API builds its current manifest every time it calls `POST /v1/sessions`. The central service validates protocol version 1, names, sizes, uniqueness, JSON Schemas, execution location, risk, and approval requirements; compiles argument and business-data validators; hashes the manifest; then freezes it for the session. CAES AI owns the output envelope around each application's `dataSchema`. Its accepted descriptors are returned as the authoritative browser manifest. Runtime TanStack tool definitions are reconstructed from that immutable data.

Server tools all use the application's single fixed callback. The model cannot supply a URL, user ID, SQL, handler name, or credential. For each call CAES AI signs a 60-second ES256 JWT whose audience is the application and whose claims bind the session, tool call, tool name, frozen manifest hash, and exact request-body hash. `UCDavis.CaesAi.AppSdk` verifies that token from CAES AI's cached JWKS, then verifies the application's HMAC context before calling the Todo-owned dispatcher, which uses the same `TodoService` as the ordinary HTTP API.

TanStack AI's interrupt mechanism pauses `add_todo` and `set_todo_completion` before execution. The shared UI shows the exact arguments and resolves the interrupt through Approve or Reject. The .NET SDK derives a stable request identity from the protocol version, session, tool call, tool name, verified user, and arguments. The Todo app stores its request hash and response, replays an exact duplicate, and rejects a mismatched reuse.

## UI effects

Tool output may request only two effects: invalidating a structured query key or showing a typed toast. `@ucdavis/caes-ai-assistant-react` validates that union and processes each tool-call ID once. The host maps invalidation to TanStack Query. The client-only `set_todo_filter` tool demonstrates a constrained page change without granting arbitrary JavaScript, HTML, CSS, URL, or component execution.

Application renderers can be first-class answers without making every tool call visible. Each result chooses `display.visibility`: `inline` renders the registered component in the conversation, `details` keeps it in a collapsed technical row, and `hidden` leaves intermediate data out of the conversation. The default is `details`. A result may also set `display.suppressAssistantText` when an inline renderer fully answers the question. The client honors suppression only when the matching renderer is installed, preserving a readable fallback in hosts that do not support the presentation.

The Todo `list_todos` tool demonstrates per-call presentation. It accepts server-side filters such as `hasDueDate` and a bounded `resultView`. A direct request to show matching Todos uses the filtered result as an inline list. A lookup performed on the way to another answer uses the same tool with a hidden result. The raw rows still reach the model, but they do not leak into the visible conversation.

## Model and reasoning policy

The session requests a model selector. Null or `default` uses the central default profile; `fast` and `deep` use those central profiles; any other string requests that exact model. The resulting concrete model must pass both central and application allowlists. Reasoning is selected per turn or from the session default, then constrained by model support and the central, application, and session ceilings. The browser cannot select a model, and the model cannot raise its own effort.

CAES AI always uses OpenAI's Responses API. The shared UI hides its one-turn “Think harder” control when `medium` is not in the session's allowed efforts; the Todo demo currently requests and permits only `none`.

## Provider reliability and telemetry

The chat route depends on a small provider interface for adapter construction, model capabilities, options, and middleware. Its one runtime implementation is Responses-specific; the interface remains primarily as a clean test seam.

CAES AI retries only transient provider failures that occur before any visible stream event and before a write tool begins. It never replays a partially visible answer or a potentially started mutation. Retry count and exponential backoff are centrally bounded.

Structured logs and PostgreSQL records capture application, session, run, provider, transport, model, effort, duration, outcome, and normalized token usage when available. Tool rows capture the tool name, declared risk, timing, outcome, and safe error code. Operational code does not deliberately capture prompts or results; persistence failures log fixed error codes without SQL parameters.

Set `CAES_AI_OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` to export traces and metrics through OTLP over HTTP/protobuf. The server installs OpenTelemetry before importing Fastify, PostgreSQL, or the model adapter. It instruments HTTP, Fastify, PostgreSQL, and TanStack AI model work; omits Fastify health-route spans; disables enhanced database reporting; and keeps routine prompt and result capture off. Full exception messages and stacks are retained in the trusted OTEL destination, so error telemetry can include provider or application context. The engine’s duplicate console exception logger is disabled. Structured logs include active trace and span IDs. Local development remains no-op unless explicitly enabled. `OTEL_SDK_DISABLED=true` overrides the CAES AI switch.

## Adding another application

1. Run `npm run caes-ai -- app create` with the application's fixed callback, origins, model allowlist, and reasoning ceiling. Save the one-time API key in the application's secret configuration.
2. Configure the application ID and the callback issuer it expects. The application ID must match the database registration.
3. Reference `UCDavis.CaesAi.AppSdk`, register it with `AddCaesAiAppSdk`, and create a session definition containing the authenticated user reference, instructions, and current tool manifest.
4. Implement `ICaesAiToolDispatcher` with an explicit application-owned dispatch table, then map the authenticated callback with `MapCaesAiToolCallback`.
5. Install `@ucdavis/caes-ai-assistant-react`, supply any client tools and renderers, and map typed UI effects to the host. Import `/ui` for the shared components and `theme.css` only when the starter appearance is wanted.
6. Add contract, authorization, idempotency, and end-to-end tests for that application.

No central tool-catalog edit is required.

## Verification

Checks use an isolated PostgreSQL database and scripted model providers. They require
no OpenAI credential and never bootstrap the demo. For local checks on macOS or Linux:

```bash
npm ci
dotnet restore apps/todo-app/UCDavis.CaesAi.Todo.slnx
npm run test:db:up
export CAES_AI_TEST_DATABASE_URL=postgresql://caesai_test:caes-ai-test-password@127.0.0.1:54330/caesai_test
npm run check
npm run build
npm run test:db:down
```

The test database uses its own Compose project, localhost port 54330 and temporary
storage. Its setup command ignores the local `.env`. Tests fail if
`CAES_AI_TEST_DATABASE_URL` is unset, so they cannot silently select the demo database.
The GitHub Actions workflow supplies an ephemeral PostgreSQL service and runs the
same checks, application builds and package creation on pull requests and `main`.
CI shows JavaScript/PostgreSQL tests and .NET tests as separate steps. Locally,
`npm run test:js` runs the four ordinary JavaScript suites, and `npm run test:dotnet`
runs the SDK and API tests. The live E2E workspace is excluded from both.

`npm run pack:protocol`, `npm run pack:assistant` and `npm run pack:dotnet` create inspectable
npm and NuGet artifacts without publishing. `npm run test:e2e` is separate, starts the
demo when needed and uses a live provider credential. See
[manual-test.md](docs/manual-test.md) for that check.

Publishable JavaScript package changes use [Changesets](.changeset/README.md) to record release notes and requested version bumps:

```bash
npm run changeset
npm run release:version
```

Versioning and publishing remain separate, explicit operations. `@tanstack/ai`, `@tanstack/ai-react`, React, and React DOM are peers of the React package rather than bundled framework copies.

The first public package release is prepared as `0.2.0-beta.0`, with npm's `beta`
dist-tag and a NuGet prerelease version. See [package releases](docs/package-releases.md)
for installation, registry setup and the manual publishing workflow. Publishing
these libraries does not deploy the central server.

## Known limitations

- Application API keys and a direct-database administration CLI remain the current administration model. Sessions and operational metadata are durable, but session revocation and retention jobs are not implemented. The file-backed callback signer survives restarts and supports overlap rotation, but deployment must mount it from protected secret storage or replace it with a managed signer.
- The Todo app uses one simulated user and `EnsureCreated`, not authentication or a migration pipeline.
- OpenAI is the only production provider implementation, chat history is browser-local, and CAES AI intentionally stores no transcript in this version.
- Automated server tests inject a private scripted model provider. Runtime configuration has no fake-model mode, and Playwright exercises the live provider.
- Tool schemas intentionally support a conservative JSON Schema subset.
- The Todo example's frontend bundle is not code-split.
- TanStack AI is evolving. CAES AI's public React declarations and client-tool shape do not expose TanStack types. Browser chat uses a CAES AI-owned version 1 envelope, version header, and validated event-name set while the shared client contains the underlying AG-UI implementation.
- Per-application request quotas and outbound-network allowlisting are deferred. Applications own current-user authentication and reauthorization for business actions.
- The server intentionally supports only OpenAI's Responses API; it has no Chat Completions compatibility path.
- No live OpenAI test can run without a valid `OPENAI_API_KEY`; follow the documented credential-gated smoke test.

Further detail is in the [documentation index](docs/README.md),
[architecture.md](docs/architecture.md) and [protocol.md](docs/protocol.md).
