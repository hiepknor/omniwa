import {
  classifyValue,
  createCatalogMetricPoint,
  toSafeLogFields,
  type LogEntry,
} from "@omniwa/observability";
import { describe, expect, it } from "vitest";

import {
  InMemoryObservabilityRuntime,
  JsonLineStructuredLogBackendAdapter,
  exportMetricsText,
  registerDependencyHealthChecks,
} from "./index.js";

describe("production observability readiness adapters", () => {
  it("writes structured JSON lines without exposing redacted secret fields", () => {
    const lines: string[] = [];
    const logger = new JsonLineStructuredLogBackendAdapter({
      sink: {
        writeLine: (line) => lines.push(line),
      },
    });

    logger.write({
      level: "warn",
      message: "provider runtime operation completed",
      fields: toSafeLogFields({
        state: classifyValue("action_required", "internal"),
        sessionSecret: classifyValue("synthetic-session-secret", "secret"),
      }),
    } satisfies LogEntry);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      fields: {
        state: "action_required",
        sessionSecret: "[redacted:secret]",
      },
    });
    expect(lines.join("")).not.toContain("synthetic-session-secret");
  });

  it("exports safe metric text with approved labels", () => {
    const metrics = exportMetricsText([
      createCatalogMetricPoint("webhook.delivery.success.total", {
        value: 1,
        labels: toSafeLogFields({
          outcome: classifyValue("delivered", "public"),
          receiver_category: classifyValue("healthy_receiver", "internal"),
        }),
      }),
    ]);

    expect(metrics.contentType).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(metrics.body).toContain("# TYPE webhook_delivery_success_total counter");
    expect(metrics.body).toContain(
      'webhook_delivery_success_total{outcome="delivered",receiver_category="healthy_receiver",runtime_role="webhook"} 1',
    );
  });

  it("fails readiness when critical dependencies are unavailable", async () => {
    const runtime = new InMemoryObservabilityRuntime({
      clock: {
        epochMilliseconds: () => 1_804_000_000_000,
      },
    });

    registerDependencyHealthChecks(runtime, [
      {
        name: "postgres",
        runtimeRole: "health",
        critical: true,
        probe: () => ({ state: "healthy" }),
      },
      {
        name: "queue",
        runtimeRole: "health",
        critical: true,
        probe: () => ({ state: "unavailable", causeCode: "queue_unavailable" }),
      },
      {
        name: "provider",
        runtimeRole: "health",
        critical: false,
        probe: () => ({ state: "degraded", causeCode: "provider_degraded" }),
      },
      {
        name: "event_log",
        runtimeRole: "health",
        critical: true,
        probe: () => ({ state: "healthy" }),
      },
      {
        name: "webhook_dispatcher",
        runtimeRole: "health",
        critical: true,
        probe: () => ({ state: "healthy" }),
      },
    ]);

    const health = await runtime.evaluateHealth("health");

    expect(health).toMatchObject({
      readiness: "not_ready",
      checks: expect.arrayContaining([
        expect.objectContaining({
          name: "queue",
          state: "unavailable",
          critical: true,
          causeCode: "queue_unavailable",
        }),
      ]),
    });
  });
});
