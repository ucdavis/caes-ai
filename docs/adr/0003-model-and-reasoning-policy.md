# ADR 0003: Layered model and reasoning policy

Status: Accepted for alpha

## Context

Different applications and turns can justify different cost and latency, but neither a browser nor a model should be able to select an unrestricted model or reasoning level.

## Decision

Central configuration owns `default`, `fast`, and `deep` model profiles, the concrete-model allowlist, and the global ceiling. A null selector means `default`; those three reserved names resolve through central profiles; every other value requests that exact model. Each trusted application registration adds an allowlist and ceiling. The resolved concrete model must be present in both allowlists. A session may request a selector, default effort, and lower ceiling. A validated turn may request an effort only when the session allows it. CAES AI rejects disallowed values rather than silently substituting them.

The server intentionally has no Chat Completions compatibility path. Supporting one current provider API avoids transport-specific capability branches and message conversion behavior. The Todo application requests `none`; other applications can request a supported effort within the central and application ceilings. The shared React package renders “Think harder” only when the effective session includes `medium`.

## Consequences

Policy is explicit, observable, and can vary by application and turn when the selected model supports it. Profiles give most applications stable intent-based names without preventing an application from pinning a model. The provider maintains per-model capabilities. This alpha does not automatically classify question complexity or choose an effort.
