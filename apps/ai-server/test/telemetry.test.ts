import { describe, expect, it } from "vitest";

import {
  resolveTelemetryConfiguration,
  startTelemetry,
} from "../src/telemetry.js";

describe("OpenTelemetry configuration", () => {
  it("does not install exporters unless explicitly enabled", async () => {
    expect(resolveTelemetryConfiguration({})).toEqual({
      enabled: false,
      serviceName: "caes-ai",
    });

    const lifecycle = await startTelemetry({});
    expect(lifecycle.enabled).toBe(false);
    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
  });

  it("uses the standard service name when telemetry is enabled", () => {
    expect(resolveTelemetryConfiguration({
      CAES_AI_OTEL_ENABLED: "true",
      OTEL_SERVICE_NAME: "caes-ai-beta",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.test",
    })).toEqual({
      enabled: true,
      serviceName: "caes-ai-beta",
    });
  });

  it("requires an explicit export destination", () => {
    expect(() => resolveTelemetryConfiguration({
      CAES_AI_OTEL_ENABLED: "true",
    })).toThrow("requires OTEL_EXPORTER_OTLP_ENDPOINT");
  });

  it("honors the standard SDK disable switch", () => {
    expect(resolveTelemetryConfiguration({
      CAES_AI_OTEL_ENABLED: "true",
      OTEL_SDK_DISABLED: "true",
    }).enabled).toBe(false);
  });

  it("rejects an ambiguous enable flag", () => {
    expect(() => resolveTelemetryConfiguration({
      CAES_AI_OTEL_ENABLED: "sometimes",
    })).toThrow("must be true or false");
  });
});
