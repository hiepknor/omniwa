import { productionAlertDefinitions, type AlertSeverity } from "./alerts.js";
import type { ProductionMetricName } from "./metric-catalog.js";

export type DashboardAudience = "operator" | "platform" | "security";

export type DashboardPanelDefinition = Readonly<{
  id: string;
  title: string;
  metricName: ProductionMetricName;
  queryIntent: string;
  alertRefs: readonly string[];
}>;

export type DashboardDefinition = Readonly<{
  id: string;
  title: string;
  audience: DashboardAudience;
  runbookRef: string;
  panels: readonly DashboardPanelDefinition[];
}>;

export type AlertReceiverClass = "primary_oncall" | "platform_operations" | "security_operations";

export type AlertRouteDefinition = Readonly<{
  alertId: string;
  severity: AlertSeverity;
  receiverClass: AlertReceiverClass;
  escalationPolicyRef: string;
  dashboardRef: string;
  runbookRef: string;
  notificationCadence: "immediate" | "sustained_window";
}>;

export const productionDashboardDefinitions = Object.freeze([
  dashboardDefinition({
    id: "api_runtime_overview",
    title: "API Runtime Overview",
    audience: "operator",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#api-availability",
    panels: [
      panelDefinition({
        id: "api_request_latency",
        title: "API Request Latency",
        metricName: "api.request.latency",
        queryIntent: "Track normalized route latency and error outcome trends.",
        alertRefs: ["api_availability_degraded", "api_latency_degraded"],
      }),
      panelDefinition({
        id: "api_rate_limit_bucket_count",
        title: "API Rate Limit Bucket Usage",
        metricName: "api.rate_limit.bucket.count",
        queryIntent: "Track aggregate request bucket usage by endpoint class and scope kind.",
        alertRefs: [],
      }),
      panelDefinition({
        id: "api_rate_limit_bucket_remaining",
        title: "API Rate Limit Remaining Capacity",
        metricName: "api.rate_limit.bucket.remaining",
        queryIntent: "Track aggregate remaining capacity without raw bucket identifiers.",
        alertRefs: [],
      }),
      panelDefinition({
        id: "api_rate_limit_bucket_limit",
        title: "API Rate Limit Configured Limit",
        metricName: "api.rate_limit.bucket.limit",
        queryIntent: "Track configured rate limit capacity by approved low-cardinality labels.",
        alertRefs: [],
      }),
      panelDefinition({
        id: "event_stream_errors",
        title: "Event Stream Errors",
        metricName: "event_stream.errors.total",
        queryIntent: "Track sustained SSE/event-stream errors by safe source and reason code.",
        alertRefs: ["event_stream_errors"],
      }),
    ],
  }),
  dashboardDefinition({
    id: "worker_queue_operations",
    title: "Worker And Queue Operations",
    audience: "platform",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#queue-backlog",
    panels: [
      panelDefinition({
        id: "queue_work_latency",
        title: "Queue Work Latency",
        metricName: "queue.work.latency",
        queryIntent: "Track queue processing latency and backlog pressure by work type.",
        alertRefs: ["queue_backlog"],
      }),
      panelDefinition({
        id: "queue_backlog_depth",
        title: "Queue Backlog Depth",
        metricName: "queue.backlog.depth",
        queryIntent: "Track visible queued or retrying work count by approved work type.",
        alertRefs: ["queue_backlog"],
      }),
      panelDefinition({
        id: "queue_backlog_oldest_pending_age",
        title: "Queue Backlog Oldest Pending Age",
        metricName: "queue.backlog.oldest_pending_age",
        queryIntent: "Track oldest visible queued or retrying work age by approved work type.",
        alertRefs: ["queue_backlog"],
      }),
      panelDefinition({
        id: "worker_utilization",
        title: "Worker Utilization",
        metricName: "worker.utilization.ratio",
        queryIntent: "Track worker saturation by approved worker type.",
        alertRefs: ["worker_utilization_saturated"],
      }),
      panelDefinition({
        id: "eventlog_outbox_records",
        title: "EventLog Outbox Records",
        metricName: "eventlog.outbox.records",
        queryIntent: "Track pending and published EventLog outbox record counts.",
        alertRefs: ["queue_backlog"],
      }),
    ],
  }),
  dashboardDefinition({
    id: "provider_webhook_reliability",
    title: "Provider And Webhook Reliability",
    audience: "operator",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#provider-connection",
    panels: [
      panelDefinition({
        id: "provider_connection_state",
        title: "Provider Connection State",
        metricName: "provider.connection.state",
        queryIntent: "Track provider connection state without raw account identifiers.",
        alertRefs: ["provider_connection_degraded"],
      }),
      panelDefinition({
        id: "webhook_delivery_success",
        title: "Webhook Delivery Success",
        metricName: "webhook.delivery.success.total",
        queryIntent: "Track webhook delivery outcomes by safe receiver category.",
        alertRefs: ["webhook_success_degraded"],
      }),
    ],
  }),
  dashboardDefinition({
    id: "dependency_readiness",
    title: "Dependency Readiness",
    audience: "platform",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#dependency-readiness",
    panels: [
      panelDefinition({
        id: "dependency_readiness_alert_context",
        title: "Dependency Readiness Alert Context",
        metricName: "queue.work.latency",
        queryIntent:
          "Use alongside health runtime dependency probes to route critical dependency outages.",
        alertRefs: ["dependency_not_ready"],
      }),
    ],
  }),
]);

export const productionAlertRouteDefinitions = Object.freeze(
  productionAlertDefinitions.map((alert) =>
    alertRouteDefinition({
      alertId: alert.id,
      severity: alert.severity,
      receiverClass: receiverClassFor(alert.severity, alert.id),
      escalationPolicyRef: escalationPolicyRefFor(alert.severity, alert.id),
      dashboardRef: dashboardRefFor(alert.id),
      runbookRef: alert.runbookRef,
      notificationCadence: alert.severity === "p0" ? "immediate" : "sustained_window",
    }),
  ),
);

export function findDashboardDefinition(id: string): DashboardDefinition | undefined {
  return productionDashboardDefinitions.find((definition) => definition.id === id);
}

export function findAlertRouteDefinition(id: string): AlertRouteDefinition | undefined {
  return productionAlertRouteDefinitions.find((definition) => definition.alertId === id);
}

function dashboardDefinition(definition: DashboardDefinition): DashboardDefinition {
  return Object.freeze({
    ...definition,
    panels: Object.freeze(definition.panels.map(panelDefinition)),
  });
}

function panelDefinition(definition: DashboardPanelDefinition): DashboardPanelDefinition {
  return Object.freeze({
    ...definition,
    alertRefs: Object.freeze([...definition.alertRefs].sort()),
  });
}

function alertRouteDefinition(definition: AlertRouteDefinition): AlertRouteDefinition {
  return Object.freeze({ ...definition });
}

function receiverClassFor(severity: AlertSeverity, alertId: string): AlertReceiverClass {
  if (alertId === "dependency_not_ready") {
    return "primary_oncall";
  }

  if (severity === "p0") {
    return "primary_oncall";
  }

  return "platform_operations";
}

function escalationPolicyRefFor(severity: AlertSeverity, alertId: string): string {
  if (alertId === "dependency_not_ready") {
    return "operator-escalation-critical-dependencies";
  }

  return severity === "p0"
    ? "operator-escalation-primary-production"
    : "operator-escalation-platform-sustained";
}

function dashboardRefFor(alertId: string): string {
  switch (alertId) {
    case "api_availability_degraded":
    case "api_latency_degraded":
    case "event_stream_errors":
      return "api_runtime_overview";
    case "queue_backlog":
    case "worker_utilization_saturated":
      return "worker_queue_operations";
    case "provider_connection_degraded":
    case "webhook_success_degraded":
      return "provider_webhook_reliability";
    case "dependency_not_ready":
      return "dependency_readiness";
    default:
      return "api_runtime_overview";
  }
}
