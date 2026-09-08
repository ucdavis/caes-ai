# CAES AI agent guide

Work from the repository root. Keep the central AI server application-neutral. Application tools belong to their application backend and arrive through the session manifest.

Use public HTTP and package interfaces as test seams. Do not test private implementation details or inspect source text as a proxy for behavior.

Never expose provider keys, application keys, callback JWTs, callback private signing keys, context signing keys, or complete bearer tokens in logs or browser responses.

Run `npm run check` before handing off changes. Set `CAES_AI_TEST_DATABASE_URL` to an isolated test database; use the README verification instructions or the PostgreSQL service in CI. Tests must never bootstrap the demo, load local credentials, or fall back to the development database.

Use `npm run dev` for native development and `docker compose up --build` for the containerized demonstration. These commands intentionally provision the Todo demo and require local configuration. Keep them separate from verification.

The alpha snapshot and beta scope are recorded in `docs/beta-milestone.md`. Keep the deferred approval, Markdown-image, quota and shutdown work deferred unless the task explicitly changes that scope.
