import { describe, expect, it } from "vitest";

import {
  classifyValue,
  createCatalogMetricPoint,
  findAlertDefinition,
  productionAlertDefinitions,
  productionMetricDefinitions,
  toSafeLogFields,
} from "./index.js";

describe("production observability catalogs", () => {
  it("defines PR-13 required production metric coverage", () => {
    expect(productionMetricDefinitions.map((definition) => definition.name)).toEqual([
      "api.request.latency",
      "queue.work.latency",
      "provider.connection.state",
      "webhook.delivery.success.total",
      "worker.utilization.ratio",
      "event_stream.errors.total",
    ]);
  });

  it("creates catalog metrics with approved low-cardinality labels only", () => {
    const metric = createCatalogMetricPoint("api.request.latency", {
      value: 42,
      labels: toSafeLogFields({
        method: classifyValue("GET", "public"),
        route: classifyValue("/v1/instances", "public"),
        outcome: classifyValue("success", "public"),
      }),
      observedAtEpochMilliseconds: 1_804_000_000_000,
    });

    expect(metric).toMatchObject({
      name: "api.request.latency",
      kind: "histogram",
      runtimeRole: "api",
      unit: "milliseconds",
      labels: {
        method: "GET",
        route: "/v1/instances",
        outcome: "success",
      },
    });
  });

  it("rejects unapproved metric labels before they reach an exporter", () => {
    expect(() =>
      createCatalogMetricPoint("provider.connection.state", {
        value: 1,
        labels: toSafeLogFields({
          state: classifyValue("connected", "public"),
          instanceId: classifyValue("inst_high_cardinality", "internal"),
        }),
      }),
    ).toThrow(TypeError);
  });

  it("defines production alert runbook references for P0 readiness failures", () => {
    expect(findAlertDefinition("dependency_not_ready")).toMatchObject({
      severity: "p0",
      signalName: "dependency.readiness",
    });
    expect(productionAlertDefinitions.every((alert) => alert.runbookRef.startsWith("docs/"))).toBe(
      true,
    );
  });
});
