# ADR 0004: CAES AI-signed tool callbacks

Status: Accepted for alpha

## Context

A shared callback secret makes every application generate, distribute, and protect another long-lived credential. CAES AI and each application already have a stable identity and fixed callback destination, so symmetric per-application callback secrets add operational weight without adding a useful trust boundary.

## Decision

CAES AI signs a new ES256 JWT for every server tool callback and publishes its public keys as JWKS. The token is valid for 60 seconds, has a fixed issuer, type, algorithm, and subject, and uses `caes-ai-app:<applicationId>` as its audience. It binds the session, tool call, tool name, frozen manifest, and exact request-body hash.

`UCDavis.CaesAi.AppSdk` owns validation. It caches the JWKS, refreshes when a new `kid` appears, retains valid overlap keys, and uses a last-known-good known key if a scheduled refresh temporarily fails. Applications configure only their ID, the issuer they expect, and CAES AI's base URL; they do not hold a callback secret.

The default signer loads a durable private JWK key ring from a mode-0600 file outside source control. The administration CLI explicitly rotates and retires keys. Rotation retains prior public keys for overlap; operators restart the service to load the new ring, wait through the callback-token lifetime and application JWKS cache window, then retire the previous key and restart again. A production deployment can replace the file implementation with a managed signer without changing the wire contract.

## Consequences

Adding an application no longer requires provisioning a second shared secret. A stolen callback token has a short lifetime and cannot be used for another application, tool, session, or modified body. Applications depend on CAES AI's public-key endpoint, mitigated by caching, overlap, and last-known-good behavior. Central restarts retain the signing identity.
