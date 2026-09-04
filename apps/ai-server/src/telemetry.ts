export interface TelemetryConfiguration {
  enabled: boolean;
  serviceName: string;
}

export interface TelemetryLifecycle extends TelemetryConfiguration {
  shutdown: () => Promise<void>;
}

export function resolveTelemetryConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryConfiguration {
  const rawEnabled = environment.CAES_AI_OTEL_ENABLED?.trim().toLowerCase();
  if (rawEnabled && rawEnabled !== "true" && rawEnabled !== "false") {
    throw new Error("CAES_AI_OTEL_ENABLED must be true or false.");
  }
  const sdkDisabled = environment.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";
  const enabled = rawEnabled === "true" && !sdkDisabled;
  const hasSharedEndpoint = Boolean(environment.OTEL_EXPORTER_OTLP_ENDPOINT?.trim());
  const hasSignalEndpoints = Boolean(
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() &&
    environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim(),
  );
  if (enabled && !hasSharedEndpoint && !hasSignalEndpoints) {
    throw new Error(
      "Enabled OpenTelemetry requires OTEL_EXPORTER_OTLP_ENDPOINT or both signal endpoints.",
    );
  }
  return {
    enabled,
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || "caes-ai",
  };
}

/**
 * Installs providers before the server imports Fastify, PostgreSQL, or the
 * model adapter. Exporters use standard OTEL_EXPORTER_OTLP_* configuration.
 */
export async function startTelemetry(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<TelemetryLifecycle> {
  const configuration = resolveTelemetryConfiguration(environment);
  if (!configuration.enabled) {
    return { ...configuration, shutdown: async () => undefined };
  }

  const [
    { FastifyOtelInstrumentation },
    { OTLPMetricExporter },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { PgInstrumentation },
    { PeriodicExportingMetricReader },
    { NodeSDK },
  ] = await Promise.all([
    import("@fastify/otel"),
    import("@opentelemetry/exporter-metrics-otlp-proto"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-pg"),
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/sdk-node"),
  ]);

  const sdk = new NodeSDK({
    serviceName: configuration.serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
      }),
    ],
    instrumentations: [
      new HttpInstrumentation(),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: (route: { url: string }) =>
          route.url === "/health" || route.url === "/ready",
        instrumentHooks: false,
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  });
  sdk.start();

  return {
    ...configuration,
    shutdown: async () => sdk.shutdown(),
  };
}
