# Todo frontend

A React/Vite application with TanStack Query and the shared CAES AI assistant.
It demonstrates ordinary Todo operations alongside an assistant drawer and inline
assistant, application-owned result renderers, a client-side filter tool and typed
query-invalidation effects.

`src/App.tsx` connects sessions, tools and UI effects. `src/renderers.tsx` owns the
Todo list, summary and item presentations. `src/api.ts` calls the Todo backend.
The browser gets a short-lived assistant session from that backend and streams chat
directly from CAES AI; it does not receive an application or provider API key.

## Develop and test

Run commands from the repository root after installing dependencies:

```bash
npm run build:packages
npm run dev --workspace @ucdavis/caes-ai-todo-web
```

Vite listens on port 5173 and proxies `/api` and `/health` to the Todo API on port
5180. Use the [full-stack setup](../../../README.md#native-setup) to start both
backends as well. The Compose frontend is served by nginx on localhost port 8080.

```bash
npm run test --workspace @ucdavis/caes-ai-todo-web
npm run build --workspace @ucdavis/caes-ai-todo-web
```

Vitest runs the component test in jsdom with mocked API calls. The separate
[E2E suite](../../../tests/e2e/README.md) tests real services in Chromium.
