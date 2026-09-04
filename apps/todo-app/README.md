# Todo reference application

A complete example of adding CAES AI to an application. The [.NET API](api/README.md)
owns Todos, user context, tool definitions and mutations. The [React frontend](web/README.md)
owns the ordinary Todo UI, assistant renderers, client tools and query invalidation.
The shared [AI server](../ai-server/README.md) performs model orchestration.

The example uses one simulated user, SQLite and `EnsureCreated`. Its domain code is
executable integration documentation. Real applications must implement login and
reauthorize the current user when a tool executes.

## Run

From the repository root, complete the [native setup](../../README.md#native-setup)
and run `npm run dev`. Open `http://localhost:5173`; the API listens on port 5180 and
CAES AI on port 4310. The [Compose setup](../../README.md#docker-compose) provides
the same example at `http://localhost:8080`.

## What to follow

Start with the API's `POST /api/assistant/session`, then its `Ai/` manifest and
dispatcher. Follow `web/src/App.tsx` and `web/src/renderers.tsx` to see the assistant,
structured results and host-page effects. Successful writes store their idempotency
record and response in the same SQLite transaction as the mutation.

`UCDavis.CaesAi.Todo.slnx` includes the API, its integration tests, the shared .NET
SDK and SDK tests. The [test overview](../../tests/README.md) separates those checks
from the live OpenAI/browser test.
