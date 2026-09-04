# Todo API integration tests

xUnit tests drive the API through ASP.NET Core's `WebApplicationFactory`. Each
factory uses an in-memory SQLite connection, synthetic configuration, a recording
CAES AI session client and a test callback-token validator. No running central
server, PostgreSQL database or OpenAI credential is required.

Coverage includes ordinary Todo routes, session assembly, tool dispatch, user
context validation and mutation idempotency. Cryptographic JWT/JWKS behavior is
covered by the separate [SDK tests](../../../../packages/UCDavis.CaesAi.AppSdk.Tests/README.md).

From the repository root, after restoring the solution:

```bash
dotnet test apps/todo-app/api/UCDavis.CaesAi.Todo.Api.IntegrationTests --no-restore
```

These tests are included in `pnpm check`. The [browser E2E suite](../../../../tests/e2e/README.md)
adds the frontend and live provider to the path.
