# ADR 0005: PostgreSQL application registry

Status: Accepted for alpha

## Context

The first alpha loaded application callback and policy metadata from a local JSON file and loaded every application API key from environment variables. That requires a central code or configuration change for each application and gives CAES AI no key lifecycle, disable switch, or durable administrative record.

## Decision

CAES AI uses PostgreSQL for application registrations and API-key hashes. Drizzle defines the TypeScript schema and generates checked-in SQL migrations. The server and administration CLI apply pending migrations before use.

An application key contains a random public key ID and 256 bits of random secret material. CAES AI uses the key ID to select an active key, hashes the complete supplied key with SHA-256, and compares that hash to the stored value in constant time. The database never stores or returns the plaintext key.

The CLI creates, lists, updates, enables, and disables applications. It also creates overlapping replacement keys and revokes individual old keys. CLI access requires direct database credentials in this version. The local Todo bootstrap is an explicit demo setup command and is not part of CAES AI server configuration.

PostgreSQL also stores restart-safe session records and content-free run and tool-call metadata. It stores no prompts, assistant messages, tool arguments, or tool results. Expired session rows remain operational records pending an explicit retention policy.

## Consequences

Adding or disabling an application no longer requires a CAES AI deployment. Key rotation can avoid downtime. CAES AI depends on PostgreSQL for readiness, session creation and lookup, and operational metadata; local development depends on Docker. Retention and session-revocation policy remain beta work.
