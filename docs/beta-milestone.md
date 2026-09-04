# First internal beta

## Baseline

This repository starts from the reviewed alpha snapshot `ec1d1c1`, following the
architecture review of `9dceb26`. The import preserves the central runtime, protocol
v1, React and .NET packages, migrations, tests and Todo reference application.
It carries source files into this repository's existing history. It excludes local
environment files, data, signing material, generated build state and the historical
alpha task brief. The development environment template contains newly supplied
synthetic defaults.

The foundation adds GitHub Actions checks and a separate test database. The old
root `pretest` demo bootstrap is removed. Database tests require an explicit
`CAES_AI_TEST_DATABASE_URL`, and Drizzle configuration uses the caller's environment
without automatically reading a local environment file.

## First beta acceptance

The first beta should let a logged-in Walter user ask a question that calls one
Walter-owned read tool and renders its result. Walter must authenticate the user,
create the session server-side and authorize the recovered user at callback time.
An unauthorized user must receive no protected tool data. This proves the application
boundary beyond the simulated Todo user.

Deploy one central instance with PostgreSQL, HTTPS, exact application origins,
protected persistent callback signing material and the team's OTEL destination.
Verify readiness, migrations, JWKS verification, session continuity after a restart,
and a complete Walter request through the deployed services. Package distribution
and deployment credentials are separate setup work; CI builds packages without
publishing them or deploying the service.

## Scope decisions

Keep the dynamic application tools, provider interface, transcript-free persistence,
owned wire protocol, and host-owned renderers. Todo's simulated user, SQLite setup,
domain tools and renderers remain example code.

Findings 1 and 4 remain deferred at the owner's request: browser-owned approval
continuations and external Markdown images. Strict concurrent session limits,
shutdown coordination and multi-instance migration coordination also remain deferred.
Full exceptions remain enabled for the configured trusted OTEL destination; ordinary
operational records and public errors stay sanitized. See the
[review dispositions](architecture-review-follow-up.md) for the full decisions.

## Foundation validation

On September 4, 2026, the beta checkout passed `pnpm check` with 209 tests,
`pnpm build`, and all three package commands. The missing-test-database path was
also checked: database tests stop before connecting when the explicit URL is absent.
The local test database was created and removed through the documented commands.
The GitHub Actions workflow passed actionlint. Hosted CI, live OpenAI E2E and Azure
deployment remain separate checks.
