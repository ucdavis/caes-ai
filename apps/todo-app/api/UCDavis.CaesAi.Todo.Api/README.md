# Todo API

An ASP.NET Core minimal API using EF Core and SQLite. It exposes ordinary Todo
operations, creates assistant sessions at `POST /api/assistant/session`, and handles
verified tool callbacks at `POST /api/ai/tools/execute` through the shared .NET SDK.

`Ai/TodoToolManifest.cs` defines the session's tools. `Ai/TodoToolDispatcher.cs`
dispatches them through the same business service used by the ordinary routes.
`Domain/ProcessedToolCall.cs` records completed mutations so exact retries can
replay a response without repeating the write.

## Run

Run commands from the repository root after the [native setup](../../../../README.md#native-setup):

```bash
pnpm exec dotenv -e .env -- dotnet run --project apps/todo-app/api/UCDavis.CaesAi.Todo.Api
```

The local HTTP profile listens on port 5180; `/health` reports liveness. Assistant
session creation also needs the configured central server. `pnpm dev` starts both
services and the frontend together.

Configuration uses `ConnectionStrings:Todos` and the SDK's `CaesAi` section. The
database defaults to a local SQLite file. Startup creates its schema; outside the
`Testing` environment it also seeds demo data. All ordinary routes use a simulated
user; this example does not implement production authentication.

See the [API integration tests](../UCDavis.CaesAi.Todo.Api.IntegrationTests/README.md)
for HTTP behavior and mutation replay coverage.
