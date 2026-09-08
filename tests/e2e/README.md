# Live browser E2E

Playwright drives the Todo application in Chromium through ordinary operations,
assistant reads, structured rendering, write approval, rejection and host-page
updates. It uses the real OpenAI provider and can incur API usage. It is excluded
from `npm run test`, `npm run check` and the ordinary CI job.

## Run

From the repository root, complete the [native setup](../../README.md#native-setup),
including local application configuration and the provider credential, then run:

```bash
npm exec --workspace @ucdavis/caes-ai-e2e -- playwright install chromium
npm run test:e2e
```

The test configuration starts `npm run dev` when needed and waits for the Todo API.
To use an already running Compose stack:

```bash
CAES_AI_E2E_USE_EXISTING_STACK=true CAES_AI_E2E_BASE_URL=http://localhost:8080 npm run test:e2e
```

Failures retain a Playwright trace and screenshot; reports are written under the
ignored test-output directories. The [manual test guide](../../docs/manual-test.md)
describes the same application boundaries and expected behavior.
