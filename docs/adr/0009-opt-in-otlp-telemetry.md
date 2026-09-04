# ADR 0009: Opt-in OTLP telemetry

Status: Accepted for alpha

## Context

CAES AI already records content-free operational rows and creates model spans
through the OpenTelemetry API, but no provider or exporter is installed. Local
development should not emit traffic, while deployed environments need traces,
metrics, alerting, and correlation with structured logs.

## Decision

`CAES_AI_OTEL_ENABLED=true` installs the OpenTelemetry Node SDK before CAES AI
imports Fastify, PostgreSQL, or its model adapter. A shared
`OTEL_EXPORTER_OTLP_ENDPOINT`, or separate trace and metric endpoints, is
required. The service exports OTLP over HTTP/protobuf and uses the standard
`OTEL_SERVICE_NAME`; `OTEL_SDK_DISABLED=true` takes precedence.

Instrumentation covers HTTP, Fastify, PostgreSQL, and model work. Fastify health-route
spans and enhanced database reporting are disabled. Routine capture of prompts, model
results, tool arguments, and tool results is disabled. Full exception messages and
stacks are intentionally retained in the trusted OTEL destination for diagnosis;
an exception can contain provider or application context, so telemetry is not
content-free. The engine's duplicate console exception logger is disabled.
Structured operational logs include the active trace and span IDs and safe error codes.
Telemetry is a no-op unless explicitly enabled.

## Consequences

Deployments can use an OpenTelemetry Collector or any compatible backend without
changing chat orchestration. An enabled deployment fails configuration when no
export destination is present instead of silently sending to localhost. The
PostgreSQL operational tables remain the durable content-free record; telemetry
supports live diagnosis rather than transcript storage.
