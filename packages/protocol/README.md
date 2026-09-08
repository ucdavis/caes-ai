# `@ucdavis/caes-ai-protocol`

Runtime validators and TypeScript types for the CAES AI application protocol.
The package owns session, tool callback, presentation, and UI-effect envelopes.
Applications own each tool's `inputSchema` and `dataSchema`.

## Install the beta

```bash
npm install @ucdavis/caes-ai-protocol@beta
```

The current wire version is exported as `currentProtocolVersion`. CAES AI rejects
requests that use another version.

The normative version 1 JSON Schema lives in the repository at
`contracts/v1/protocol.schema.json` and is published by this package as
`@ucdavis/caes-ai-protocol/schema`. The Zod validators are executable TypeScript
implementations of that specification; shared fixtures are checked against both.
