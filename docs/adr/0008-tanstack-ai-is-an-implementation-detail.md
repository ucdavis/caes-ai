# ADR 0008: TanStack AI is an implementation detail

Status: Accepted for alpha

## Context

TanStack AI provides useful streaming, tool-loop, approval, and React machinery,
but its APIs are evolving. Exposing its tool and connection types would make
every application track those changes and would turn an implementation choice
into the CAES AI product contract.

## Decision

The central service and React package may use TanStack AI internally. Public
application interfaces use CAES AI-owned session, message, renderer, UI-effect,
and client-tool types. A client tool implementation is only `{ name, execute }`;
its description and schemas come from the server-accepted manifest. The emitted
React package declarations must not import TanStack types.

The browser-to-central SSE transport uses the CAES AI version 1 request
envelope, header, and event-name set. The shared React package owns its AG-UI
translation and validation. Non-React clients may implement the documented wire
contract without importing TanStack.

## Consequences

Applications can use the assistant without constructing TanStack tools or
transport adapters. CAES AI can upgrade or replace its orchestration internals
with a smaller blast radius. The React package still declares TanStack packages
as peer runtime dependencies in this alpha.
