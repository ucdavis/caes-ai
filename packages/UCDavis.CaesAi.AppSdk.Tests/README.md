# Application SDK tests

xUnit tests for the [.NET application SDK](../UCDavis.CaesAi.AppSdk/README.md).
They exercise session requests and responses, context signing, callback JWT/body
binding, JWKS caching and concurrent refresh behavior, and strict JSON contracts.

The contract tests consume the same [JSON fixtures](../../contracts/v1/fixtures)
as the TypeScript protocol tests. HTTP dependencies and signing keys are supplied
by the tests; no running application, PostgreSQL database or OpenAI credential is
required.

Run from the repository root after restoring the solution:

```bash
dotnet test packages/UCDavis.CaesAi.AppSdk.Tests --no-restore
```

The project is included in `apps/todo-app/UCDavis.CaesAi.Todo.slnx` and `pnpm check`.
Application-specific callback dispatch and mutation replay are covered separately
by the [Todo API tests](../../apps/todo-app/api/UCDavis.CaesAi.Todo.Api.IntegrationTests/README.md).
