# ADR 0001: Application-owned dynamic tools with a fixed gateway

Status: Accepted for alpha

## Context

Team-owned applications need to iterate on their own data operations without a central release for every tool. Allowing arbitrary callback URLs, however, would make the central service an outbound request proxy and would weaken destination and credential control.

## Decision

Applications send tool descriptors with argument and business-data JSON Schemas in every session request. CAES AI owns and composes the output envelope containing data, presentation metadata, and constrained UI effects. The central service validates and freezes that manifest but does not keep a Todo tool catalog. Its accepted descriptors are authoritative and are returned to the application for the browser. A small trusted application registry fixes one callback URL per application. Every server tool in that session is dispatched through that callback with a short-lived application-scoped signed token. Client tools remain constrained browser implementations supplied by the host.

## Consequences

Applications can add tools independently. Central policy still enforces schema, size, risk, approval, timeout, and output rules. The application must maintain explicit dispatch, compatibility, authorization, and tests. Changing a tool requires a new session. Adding an application still requires a trusted registration and credential provisioning.
