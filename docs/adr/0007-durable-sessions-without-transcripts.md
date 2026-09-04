# ADR 0007: Durable sessions and content-free operations

Status: Accepted for alpha

## Context

Application registrations were durable while browser sessions disappeared on a
restart. Logs had useful run metadata, but no queryable operational record.
Persisting full conversations would create a much larger privacy, retention,
access-control, and product scope.

## Decision

PostgreSQL stores session authentication hashes, the application snapshot,
accepted manifest, effective policy, opaque application context, and expiration.
It also stores run and tool-call identity, model, effort, timing, outcomes, safe
error codes, and token counts. It does not store prompts, assistant messages,
tool arguments, tool results, or rendered presentation data.

Expired sessions cannot authenticate or consume active-session capacity, but
their rows remain until a separately designed retention job removes them.
Applications continue to own user authentication and reauthorization for each
business operation.

## Consequences

Sessions survive restarts and work across central replicas. Basic reliability,
cost, and failure analysis can query PostgreSQL without creating a transcript
database. Session revocation, retention periods, and any future transcript
feature require separate decisions.
