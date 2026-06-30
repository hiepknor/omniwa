import { createCorrelationId, createRequestId, createTraceId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  classifyValue,
  createHealthProbeResult,
  createMetricPoint,
  finishTraceSpan,
  isRuntimeRole,
  startTraceSpan,
  summarizeHealthSnapshot,
  toSafeLogFields,
} from "./index.js";

describe("observability runtime contracts", () => {
  it("creates safe metric points with redacted labels", () => {
    const metric = createMetricPoint({
      name: "webhook.delivery.latency",
      kind: "histogram",
      value: 42,
      runtimeRole: "webhook",
      unit: "milliseconds",
      labels: toSafeLogFields({
        receiverCategory: classifyValue("healthy_receiver", "internal"),
        webhookSecret: classifyValue("synthetic-secret", "secret"),
      }),
      context: {
        correlationId: createCorrelationId("metric-correlation"),
      },
      observedAtEpochMilliseconds: 1_804_000_000_000,
    });

    expect(metric).toMatchObject({
      name: "webhook.delivery.latency",
      kind: "histogram",
      value: 42,
      runtimeRole: "webhook",
      unit: "milliseconds",
      labels: {
        receiverCategory: "healthy_receiver",
        webhookSecret: "[redacted:secret]",
      },
    });
    expect(Object.isFrozen(metric)).toBe(true);
    expect(Object.isFrozen(metric.labels)).toBe(true);
  });

  it("rejects unsafe metric names and non-finite values", () => {
    expect(() =>
      createMetricPoint({
        name: "Webhook Delivery Latency",
        kind: "gauge",
        value: 1,
        runtimeRole: "webhook",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createMetricPoint({
        name: "webhook.delivery.latency",
        kind: "gauge",
        value: Number.NaN,
        runtimeRole: "webhook",
      }),
    ).toThrow(TypeError);
  });

  it("starts and finishes trace spans with safe context", () => {
    const started = startTraceSpan({
      name: "webhook.dispatch",
      runtimeRole: "webhook",
      startedAtEpochMilliseconds: 100,
      context: {
        correlationId: createCorrelationId("trace-correlation"),
        requestId: createRequestId("trace-request"),
        traceId: createTraceId("trace-id"),
        runtimeRole: "webhook",
      },
      attributes: toSafeLogFields({
        deliveryId: classifyValue("delivery_1", "internal"),
        payload: classifyValue("raw webhook payload", "confidential"),
      }),
    });

    const ended = finishTraceSpan(started, {
      endedAtEpochMilliseconds: 175,
    });

    expect(started).toMatchObject({
      name: "webhook.dispatch",
      status: "started",
      attributes: {
        deliveryId: "delivery_1",
        payload: "[redacted:confidential]",
      },
    });
    expect(ended).toMatchObject({
      status: "ended",
      durationMilliseconds: 75,
    });
  });

  it("summarizes runtime health readiness from health probes", () => {
    const healthy = createHealthProbeResult({
      name: "postgres",
      runtimeRole: "api",
      state: "healthy",
      critical: true,
      checkedAtEpochMilliseconds: 100,
    });
    const degraded = createHealthProbeResult({
      name: "observability_sink",
      runtimeRole: "api",
      state: "degraded",
      critical: false,
      checkedAtEpochMilliseconds: 200,
      causeCode: "sink_lag",
    });
    const notReady = createHealthProbeResult({
      name: "queue",
      runtimeRole: "worker",
      state: "unavailable",
      critical: true,
      checkedAtEpochMilliseconds: 300,
      causeCode: "queue_unavailable",
    });

    expect(summarizeHealthSnapshot("api", [healthy]).readiness).toBe("ready");
    expect(summarizeHealthSnapshot("api", [healthy, degraded])).toMatchObject({
      readiness: "degraded",
      checkedAtEpochMilliseconds: 200,
    });
    expect(summarizeHealthSnapshot("worker", [notReady]).readiness).toBe("not_ready");
  });

  it("recognizes approved runtime roles only", () => {
    expect(isRuntimeRole("metrics")).toBe(true);
    expect(isRuntimeRole("analytics")).toBe(false);
  });
});
