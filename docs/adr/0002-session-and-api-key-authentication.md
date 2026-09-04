# ADR 0002: API keys and short-lived session tokens

Status: Accepted for alpha

## Context

The spike must work from local development tools and Postman without an Entra setup while keeping long-lived server credentials out of browsers.

## Decision

The application backend authenticates session creation with its own API key. The central service hashes registered keys for lookup and compares hashes in constant time. It returns at least 256 bits of random session-token material, stores only its hash, binds it to one session, and expires it after 30 minutes. Application user context is an HMAC-signed, expiring opaque token. Callback authentication is defined separately in ADR 0004.

## Consequences

The local flow is straightforward and credentials remain separated by purpose. The PostgreSQL registry and CLI now support overlapping key rotation and revocation as defined in ADR 0005, but applications must still store and update their own key securely. In-memory sessions do not support revocation, restart survival, or horizontal scale. Production may replace application API keys with managed workload identity while preserving scoped browser sessions.
