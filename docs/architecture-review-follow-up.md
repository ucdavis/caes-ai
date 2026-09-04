# Architecture review follow-up

Decisions from the review of alpha commit `9dceb26`, updated September 4, 2026.
These dispositions supersede the original report's recommendations for this repair pass.

| Finding | Disposition |
| --- | --- |
| 1. Browser-owned approval continuation | Pinned for discussion; behavior unchanged at the owner's request. Approval is an interaction safeguard. The application still authorizes every write. There is no central-issued proposal receipt; session renewal can change a resumed call's idempotency identity. |
| 2. Database error disclosure | Unexpected HTTP failures use a versioned, generic error. Operational persistence failures log fixed codes, without raw database exceptions or SQL parameters. |
| 3. Full exception telemetry | Keep full provider/tool exceptions in the configured, trusted OTEL destination. Normal prompt/result capture stays disabled. Disable the engine's duplicate console exception logger. HTTP responses and operational error codes remain sanitized. |
| 4. Markdown external images | Pinned for discussion; behavior unchanged at the owner's request. Markdown images can cause browser requests to model-supplied image URLs. |
| 5. Provider retry replay | Commit the stream on observable output, including tool events. Thrown exceptions cannot restart a committed stream. Flush buffered start events once; disable nested OpenAI HTTP retries. |
| 6. Callback cancellation and shutdown | Propagate run cancellation to callbacks before dispatch and to reads in flight. Dispatched writes retain their timeout and finish independently of the browser connection. Record cancelled runs explicitly. Shutdown coordination remains deferred. |
| 7. Schema compiler lifetime | Each root schema has an independent compiler and ID namespace. Authenticate and check expiry before compilation. Compilers have no process-wide retained cache. |
| 8. Client tool validation | Validate arguments and results in the React package; validate client results and their arguments again on the central request boundary before model work. |
| 9. JWKS failure concurrency | Share refresh work, allow cached-key callbacks during refresh, back off for 30 seconds after failure/unknown-key refresh, bound refresh to two seconds and key age to one hour by default. Successful refresh replaces the full key set, including retirements. |
| 10. Concurrent session limits | Assessment below; counts remain best-effort under concurrent session creation. |
| 11. Concurrent migrations | Leave unchanged. The first deployment will use one central instance. |
| 12. Contract strictness | Define message, event and interrupt shapes, pin retained binding metadata to version 1, validate emitted events, and validate .NET receivers against the embedded contract. Shared positive and negative fixtures exercise both languages. |

## Cancellation: implemented propagation, deferred shutdown work

The tool-context signal passes through `dynamic-tools.ts` into `gateway.ts`.
Cancellation prevents every callback before dispatch, including when it arrives
during asynchronous token signing. Read callbacks combine the run signal with the
existing timeout. Once an approved write is dispatched, only its timeout can cancel
the HTTP request. The application can finish the write and return its result even
after the browser disconnects. Cancelling an HTTP request cannot roll back a mutation
the application has already committed.

Disconnected chat runs finish with `outcome: cancelled` and `run_cancelled`, including
when cancellation happens while the run record is being created. A cancelled callback
records `cancelled` and `tool_cancelled`. A dispatched write records its actual success
or failure independently; a timeout remains `tool_timeout`. Cancellation does not
trigger provider retries or a new callback attempt.

A shutdown deadline, active-run tracking, and a user-visible unknown mutation outcome
are separate, larger changes. They affect lifecycle and retry semantics across both
services. They remain deferred. This change adds no active-run registry, shutdown
deadline, tables, or mutation-outcome recovery flow.

## Session limits: defer strict admission until it is required

Exact limits require count/reserve/insert to run in one PostgreSQL transaction with
a stable lock order, such as a global advisory lock followed by application admission.
The repository interface must expose that atomic operation, and tests must cover
parallel admission, expired sessions and rollback. A simple global lock serializes
all session creation; finer locking adds complexity.

For a small internal beta, retain the current limits as capacity guardrails. Concurrent
requests can exceed them even in a single process. Strict admission is worth adding
when the limit becomes a contractual quota or protects a measured resource ceiling.
No locks or quota subsystem were added in this pass.

## Verification

After the cancellation repair, `pnpm check` passed in an isolated source copy with the root demo-bootstrap
`pretest` hook removed. All reviewed source files were compared with that copy;
the check covered package builds and public declaration checks, TypeScript, ESLint,
migration consistency, .NET formatting and builds, and 209 tests: 78 protocol,
70 central server, 22 React, one Todo web, 22 SDK and 16 API integration tests.
The eleven new tests cover cancellation before signing, during signing, during reads
awaiting headers or body data, after an approved write starts, and while run persistence
is pending. They also check write timeouts after disconnect, both normal and exceptional
model cancellation, and ordinary successful completion. HTTP tests use local sockets
and scripted models. PostgreSQL tests used a disposable database with synthetic
credentials. React Doctor reported 100/100 in the earlier repair pass; this change does
not touch React. Live OpenAI/browser E2E and Azure deployment were not rerun.

The initial root check unexpectedly ran the demo bootstrap despite the supplied
lifecycle setting. It loaded the alpha `.env` and reported an update to the local
Todo registration. That bootstrap upserts registration settings and enables the
configured application/key. No environment values were printed. The command was
stopped and subsequent full checks used the isolated copy; no attempt was made to
restore unknown prior registration state. The alpha `.data` files were not inspected.
