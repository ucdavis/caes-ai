# Tests

Most tests live beside their application or package. This directory contains the
[live browser E2E suite](e2e/README.md).

| Suite | Dependencies and scope |
| --- | --- |
| [Protocol](../packages/protocol/test) | TypeScript schemas and shared JSON fixtures. |
| [AI server](../apps/ai-server/test) | Scripted providers and local callbacks; four persistence tests use real PostgreSQL. |
| [React package](../packages/assistant-react/test) | jsdom component, transport and client-tool tests. |
| [Todo frontend](../apps/todo-app/web/tests) | jsdom and mocked API calls. |
| [.NET SDK](../packages/UCDavis.CaesAi.AppSdk.Tests/README.md) | Synthetic keys, mocked HTTP and shared contract fixtures. |
| [Todo API](../apps/todo-app/api/UCDavis.CaesAi.Todo.Api.IntegrationTests/README.md) | ASP.NET Core test host and in-memory SQLite. |
| [Browser E2E](e2e/README.md) | Chromium, the complete application stack and live OpenAI. |

`pnpm check` runs the non-E2E suites, builds shared packages and checks types,
lint, migrations and .NET formatting/builds. Follow the
[root verification instructions](../README.md#verification) to configure an isolated
`CAES_AI_TEST_DATABASE_URL`. Tests never provision the Todo demo or infer its database
URL. CI supplies the test database through its PostgreSQL service.
