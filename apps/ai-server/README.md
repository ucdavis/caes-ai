# CAES AI server

The shared TypeScript/Fastify service for application-defined assistants. It owns
model credentials and policy, short-lived browser sessions, streaming chat, tool
validation, signed callbacks, provider retries and operational telemetry.
Applications supply their own instructions and tool manifests and execute business
operations through their registered callback. They retain user authorization and data access.

## Run and build

Run commands from the repository root. Follow the [local setup](../../README.md#native-setup)
to configure the environment and start PostgreSQL. `npm run dev` starts this service
together with the Todo example. To run only this service against the configured database:

```bash
npm run build --workspace @ucdavis/caes-ai-protocol
npm exec -- dotenv -e .env -- npm run dev --workspace @ucdavis/caes-ai-server
```

The default local address is `http://localhost:4310`. Startup applies the checked-in
SQL migrations. Runtime configuration requires PostgreSQL and an OpenAI credential;
tests use scripted model providers. The [root configuration table](../../README.md#configuration)
lists model policy, callback signing and OTEL settings.

```bash
npm run build --workspace @ucdavis/caes-ai-protocol
npm run build --workspace @ucdavis/caes-ai-server
```

## HTTP interface

| Route | Purpose |
| --- | --- |
| `POST /v1/sessions` | Authenticate an application API key and create an immutable session. |
| `POST /v1/sessions/{sessionId}/chat` | Authenticate a browser session token and stream versioned SSE events. |
| `GET /.well-known/jwks.json` | Publish callback verification keys. |
| `GET /health` | Process liveness. |
| `GET /ready` | PostgreSQL readiness. |

PostgreSQL stores application registrations, key and session-token hashes, session
snapshots, and run/tool metadata. Conversation transcripts and tool payloads are not
stored in the operational tables. Full exceptions can reach the configured trusted
OTEL destination. See [architecture](../../docs/architecture.md) and
[protocol](../../docs/protocol.md) for the boundaries.

## Tests and administration

Prepare the isolated database and export `CAES_AI_TEST_DATABASE_URL` using the
[verification instructions](../../README.md#verification), then run:

```bash
npm run test --workspace @ucdavis/caes-ai-server
```

Four tests in [application-registry.database.test.ts](test/application-registry.database.test.ts)
use real PostgreSQL for registration/key lifecycle, bootstrap collisions, session
reload and operational persistence. The remaining tests use injected stores,
scripted providers and local callback servers as needed.

The administration CLI uses direct database credentials. Run `npm run caes-ai -- app list`
or follow the [administration guide](../../README.md#application-administration)
to register applications and rotate keys. `scripts/dev/` contains the separate Todo
bootstrap; it is not part of normal server startup or test setup.
