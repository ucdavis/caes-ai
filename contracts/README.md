# Wire contracts

Language-neutral specifications for CAES AI session creation, browser chat,
streaming events, tool callbacks, errors, presentations and UI effects.

[Version 1](v1/README.md) is the current protocol. Its
[JSON Schema](v1/protocol.schema.json) is normative; shared
[fixtures](v1/fixtures) exercise accepted and rejected payloads in TypeScript and .NET.
Applications own their tool argument and business-data schemas inside these envelopes.

There is no build or service to run here. Contract checks run through the
[protocol package](../packages/protocol/README.md) and
[.NET SDK tests](../packages/UCDavis.CaesAi.AppSdk.Tests/README.md), both included in
`pnpm check`. Update implementations and shared fixtures together when changing a
contract. Protocol versions are explicit; independent deployments must not silently
reinterpret version 1.
