# ADR 0006: Versioned protocol and CAES AI-owned envelopes

Status: Accepted for alpha

## Context

The TypeScript service, .NET application SDK, and React package can be deployed independently. Implicit compatibility and duplicated output schemas would allow them to disagree silently. Application teams still need to evolve their own business data without a central tool catalog.

## Decision

Every CAES AI-owned session, browser chat, and callback body carries `protocolVersion: 1`; each SSE event carries the same value in `metadata.caesAi.protocolVersion`. Browser chat also sends and receives `X-CAES-AI-Protocol-Version: 1`. Receivers reject any unsupported version with the stable `unsupported_protocol_version` code. `contracts/v1/protocol.schema.json` is the normative body specification. Shared JSON fixtures under `contracts/v1/fixtures` are validated against it and consumed by the relevant TypeScript and .NET implementations.

Applications own tool names, descriptions, execution and risk metadata, argument schemas, and business-data schemas. CAES AI owns the output envelope containing `data`, `display`, and `uiEffects` and composes runtime output validation from those parts. The validated descriptors returned by session creation are authoritative for the browser.

## Consequences

Compatibility failures are early and explicit. One contract shape drives the service, React client, and .NET SDK, while applications remain free to change their domain data by creating new sessions. The browser stream freezes its accepted event-name set and checks its version before the internal chat runtime sees it. A future protocol version will need an overlap and deprecation policy before independently deployed applications depend on it.
