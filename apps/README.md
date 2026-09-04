# Applications

- [AI server](ai-server/README.md): the shared Fastify service, PostgreSQL persistence and administration CLI.
- [Todo example](todo-app/README.md): a runnable application with a .NET backend and React frontend that demonstrates both sides of the integration.

The AI server owns model access and orchestration. Each host application owns its
users, authorization, tools and business data. Start the complete local example with
the [root setup instructions](../README.md#native-setup).
