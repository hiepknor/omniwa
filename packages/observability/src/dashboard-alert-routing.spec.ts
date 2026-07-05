import { describe, expect, it } from "vitest";

import {
  findAlertRouteDefinition,
  findDashboardDefinition,
  productionAlertDefinitions,
  productionAlertRouteDefinitions,
  productionDashboardDefinitions,
  productionMetricDefinitions,
} from "./index.js";

describe("production dashboard and alert routing catalogs", () => {
  it("covers every approved production metric with at least one dashboard panel", () => {
    const panelMetricNames = new Set(
      productionDashboardDefinitions.flatMap((dashboard) =>
        dashboard.panels.map((panel) => panel.metricName),
      ),
    );

    expect([...panelMetricNames].sort()).toEqual(
      productionMetricDefinitions.map((definition) => definition.name).sort(),
    );
  });

  it("routes every approved production alert to an operator receiver and dashboard", () => {
    expect(productionAlertRouteDefinitions.map((route) => route.alertId).sort()).toEqual(
      productionAlertDefinitions.map((definition) => definition.id).sort(),
    );

    for (const alert of productionAlertDefinitions) {
      const route = findAlertRouteDefinition(alert.id);

      expect(route).toMatchObject({
        alertId: alert.id,
        severity: alert.severity,
        runbookRef: alert.runbookRef,
      });
      expect(route?.receiverClass).toMatch(/^(primary_oncall|platform_operations)$/u);
      expect(route?.escalationPolicyRef).toMatch(/^operator-escalation-/u);
      expect(findDashboardDefinition(route?.dashboardRef ?? "")).toBeDefined();
    }
  });

  it("keeps dashboard alert references tied to approved alert ids", () => {
    const alertIds = new Set(productionAlertDefinitions.map((definition) => definition.id));

    for (const dashboard of productionDashboardDefinitions) {
      expect(dashboard.runbookRef).toMatch(/^docs\/runbooks\//u);

      for (const panel of dashboard.panels) {
        expect(panel.queryIntent.length).toBeGreaterThan(0);

        for (const alertRef of panel.alertRefs) {
          expect(alertIds.has(alertRef)).toBe(true);
        }
      }
    }
  });

  it("does not place raw identifiers or target URLs in catalog references", () => {
    const serialized = JSON.stringify({
      dashboards: productionDashboardDefinitions,
      routes: productionAlertRouteDefinitions,
    });

    expect(serialized).not.toMatch(/https?:\/\//iu);
    expect(serialized).not.toMatch(/@s\.whatsapp\.net|@g\.us/iu);
    expect(serialized).not.toMatch(/local-dev-secret|bearer\s+[a-z0-9._-]+/iu);
    expect(serialized).not.toMatch(/jid|phone|providerPayload|sessionMaterial/iu);
  });
});
