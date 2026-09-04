# CAES AI

CAES AI is a shared AI integration service for applications maintained by the
UC Davis College of Agricultural and Environmental Sciences.

The service will provide a central place for model credentials, model policy,
streaming chat orchestration, operational telemetry, and application
registration. Applications will continue to own their users, authorization,
data, business rules, tools, and user interface.

## Status

This repository is the starting point for the beta implementation. The design
has been exercised in a local proof of concept, but this repository does not yet
contain a deployable service.

## Planned repository contents

- A TypeScript central service using OpenAI's Responses API
- A versioned, implementation-owned protocol
- Shared React and .NET integration packages
- PostgreSQL persistence for registrations, sessions, and content-free
  operational records
- A reference application and end-to-end tests

## Design principles

- Applications define and execute their own tools.
- The model does not receive direct database access or write SQL.
- Browser, application, and callback credentials have separate scopes.
- Public contracts do not expose orchestration-library types.
- Prompts, tool arguments, and tool results are not persisted by default.
- Local development and production deployment use the same protocol and
  authorization flow.

Development instructions will be added with the first beta implementation.
