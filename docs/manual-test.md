# Manual test

## Live OpenAI smoke test

1. Set a valid `OPENAI_API_KEY` in `.env` and ensure the selected `OPENAI_DEFAULT_MODEL` is also in `OPENAI_ALLOWED_MODELS`.
2. Run `npm run dev`.
3. Open <http://localhost:5173>, expand Developer details, and confirm the effective model and default effort `none`.
4. Enter each prompt as a new message:

```text
What are my Todos?

How many are incomplete?

Which category has the most Todos?

Add "Submit the Walter budget report" for Friday in the Work category.

Mark "Submit the Walter budget report" complete.

Show only my incomplete Todos.
```

5. For each data question, confirm the model uses a tool and the rendered data matches the ordinary interface.
6. For add and completion, inspect the exact arguments, reject once to prove no mutation, then ask again and approve once. Confirm one Todo change and an ordinary-page refresh without reload.
7. Ask a short follow-up such as `Which one is due next?` and confirm it uses the existing conversation context without a provider error.
8. Confirm the Reasoning control reflects the effective policy. The Todo demo currently requests and permits only `none`.
9. Confirm the final prompt activates the ordinary Active filter through the client tool.
10. Run `npm run caes-ai -- app list` and confirm `todo-app` is enabled with one active key ID. The command must not print an API key or hash.
11. Inspect browser responses and server logs. The browser may contain a short-lived session token, but must not contain the application key, callback JWT, context signing key, context token, CAES AI private signing key, database URL, or OpenAI key. Logs must not contain complete credentials, prompts, arguments, or tool output. A completed-run log should include application, session, run, provider, transport, model, effort, duration, outcome, and normalized usage when the provider supplied it.

Record the date, model, prompt outcomes, approval/rejection behavior, log check, and any provider errors.

The Playwright suite runs this live path with `npm run test:e2e`; it requires the provider credential and can incur API usage. To run it against an already running Compose stack, use `CAES_AI_E2E_USE_EXISTING_STACK=true CAES_AI_E2E_BASE_URL=http://localhost:8080 npm run test:e2e`.

## Compose check

Run `docker compose up --build`, wait for PostgreSQL and the three long-running application services to become healthy, and confirm the one-shot `setup` service exited successfully. Open <http://localhost:8080>. Confirm a session response uses the public `http://localhost:4310` chat URL while central-to-Todo calls use the internal `todo-api:8080` destination.
