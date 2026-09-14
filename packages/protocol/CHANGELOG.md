# @ucdavis/caes-ai-protocol

## 0.2.0-beta.1

### Patch Changes

- Remove transport version metadata after validating incoming chat events so it is not stored in message history and rejected on subsequent turns.

  Keep protocol package versions aligned for the coordinated beta release; the v1 wire contract is unchanged.

## 0.2.0-beta.0

### Minor Changes

- 78bea29: Add the normative versioned protocol schema, authoritative session manifests,
  application data schemas, lazy sessions, and CAES AI-owned client-tool, message,
  and browser-stream types that keep TanStack implementation types out of
  application code.

### Patch Changes

- 78bea29: Validate version 1 message, event and interrupt payloads, reject unknown wire fields,
  and enforce accepted client tool argument and result schemas. Keep each tool schema's
  compiler and ID namespace independent.

Changes are recorded here by Changesets when a package version is prepared.
