import {
  classifyValue,
  createHealthProbeResult,
  createMetricPoint,
  finishTraceSpan,
  startTraceSpan,
  toSafeLogFields,
  type LogEntry,
} from "@omniwa/observability";
import { createCorrelationId, createRequestId, createTraceId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { InMemoryObservabilityRuntime } from "./in-memory-observability-runtime.js";

describe("InMemoryObservabilityRuntime", () => {
  it("captures structured logs, metrics, traces, and health snapshots without raw sensitive fields", async () => {
    const runtime = new InMemoryObservabilityRuntime();
    const context = {
      correlationId: createCorrelationId("observability-correlation"),
      requestId: createRequestId("observability-request"),
      traceId: createTraceId("observability-trace"),
      runtimeRole: "webhook",
    } satisfies LogEntry["context"];

    runtime.write({
      level: "info",
      message: "webhook delivery observed",
      context,
      fields: toSafeLogFields({
        deliveryId: classifyValue("delivery_1", "internal"),
        signingSecret: classifyValue("synthetic-secret", "secret"),
      }),
      error: Object.freeze({
        failure_category: "webhook",
      }),
    });
    runtime.recordMetric(
      createMetricPoint({
        name: "webhook.delivery.success",
        kind: "counter",
        value: 1,
        runtimeRole: "webhook",
        labels: toSafeLogFields({
          receiver: classifyValue("receiver.category", "internal"),
          payload: classifyValue("raw payload", "confidential"),
        }),
        context,
      }),
    );
    runtime.recordSpan(
      finishTraceSpan(
        startTraceSpan({
          name: "webhook.dispatch",
          runtimeRole: "webhook",
          context,
          startedAtEpochMilliseconds: 100,
        }),
        {
          endedAtEpochMilliseconds: 125,
        },
      ),
    );
    runtime.registerHealthCheck({
      name: "webhook_transport",
      runtimeRole: "webhook",
      critical: true,
      check: () =>
        createHealthProbeResult({
          name: "webhook_transport",
          runtimeRole: "webhook",
          state: "healthy",
          critical: true,
          checkedAtEpochMilliseconds: 1_804_000_000_000,
        }),
    });

    const health = await runtime.evaluateHealth("webhook");
    const snapshot = runtime.snapshot();

    expect(health).toMatchObject({
      runtimeRole: "webhook",
      readiness: "ready",
    });
    expect(snapshot.logs).toHaveLength(1);
    expect(snapshot.metrics).toHaveLength(1);
    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.health).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-secret");
    expect(JSON.stringify(snapshot)).not.toContain("raw payload");
  });

  it("marks runtime readiness as not ready when a critical health check is unavailable", async () => {
    const runtime = new InMemoryObservabilityRuntime();

    runtime.registerHealthCheck({
      name: "postgres",
      runtimeRole: "api",
      critical: true,
      check: () =>
        createHealthProbeResult({
          name: "postgres",
          runtimeRole: "api",
          state: "unavailable",
          critical: true,
          checkedAtEpochMilliseconds: 1_804_000_000_000,
          causeCode: "postgres_unavailable",
        }),
    });

    const health = await runtime.evaluateHealth("api");

    expect(health).toMatchObject({
      runtimeRole: "api",
      readiness: "not_ready",
      checks: [
        {
          name: "postgres",
          causeCode: "postgres_unavailable",
        },
      ],
    });
  });

  it("converts health check exceptions into safe unavailable health state", async () => {
    const runtime = new InMemoryObservabilityRuntime();

    runtime.registerHealthCheck({
      name: "observability_sink",
      runtimeRole: "metrics",
      critical: true,
      check: () => {
        throw new Error("raw observability token secret");
      },
    });

    const health = await runtime.evaluateHealth("metrics");

    expect(health).toMatchObject({
      readiness: "not_ready",
      checks: [
        {
          name: "observability_sink",
          state: "unavailable",
          causeCode: "health_check_failed",
        },
      ],
    });
    expect(JSON.stringify(health)).not.toContain("secret");
  });

  it("can clear captured runtime observations without unregistering health checks", async () => {
    const runtime = new InMemoryObservabilityRuntime();

    runtime.write({
      level: "info",
      message: "safe message",
    });
    runtime.recordMetric(
      createMetricPoint({
        name: "api.request.count",
        kind: "counter",
        value: 1,
        runtimeRole: "api",
      }),
    );
    runtime.registerHealthCheck({
      name: "runtime",
      runtimeRole: "health",
      critical: true,
      check: () =>
        createHealthProbeResult({
          name: "runtime",
          runtimeRole: "health",
          state: "healthy",
          critical: true,
          checkedAtEpochMilliseconds: 1,
        }),
    });
    await runtime.evaluateHealth("health");

    runtime.clear();
    const health = await runtime.evaluateHealth("health");

    expect(runtime.snapshot()).toMatchObject({
      logs: [],
      metrics: [],
      spans: [],
      health: [
        {
          name: "runtime",
          state: "healthy",
        },
      ],
    });
    expect(health.readiness).toBe("ready");
  });
});
