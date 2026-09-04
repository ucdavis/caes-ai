# Todo backend

The .NET 10 half of the [Todo reference application](../README.md).

- [UCDavis.CaesAi.Todo.Api](UCDavis.CaesAi.Todo.Api/README.md) implements the ordinary Todo HTTP API and CAES AI session/callback integration.
- [UCDavis.CaesAi.Todo.Api.IntegrationTests](UCDavis.CaesAi.Todo.Api.IntegrationTests/README.md) exercises those HTTP routes with an in-memory SQLite database.

The API calls the shared [application SDK](../../../packages/UCDavis.CaesAi.AppSdk/README.md).
Its business tools remain in this application rather than the central server.

Run from the repository root after [restoring dependencies](../../../README.md#native-setup):

```bash
dotnet build apps/todo-app/UCDavis.CaesAi.Todo.slnx --no-restore
dotnet test apps/todo-app/UCDavis.CaesAi.Todo.slnx --no-build
```

The solution also builds and tests the shared SDK. Use the project READMEs for
commands targeting only the API or its tests.
