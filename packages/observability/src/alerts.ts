export const alertSeverities = ["p0", "p1", "p2"] as const;

export type AlertSeverity = (typeof alertSeverities)[number];

export type AlertDefinition = Readonly<{
  id: string;
  severity: AlertSeverity;
  signalName: string;
  condition: string;
  runbookRef: string;
  description: string;
}>;

export const productionAlertDefinitions = Object.freeze([
  alertDefinition({
    id: "api_availability_degraded",
    severity: "p0",
    signalName: "api.request.latency",
    condition: "sustained_5xx_or_availability_below_slo",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#api-availability",
    description: "API availability is below the approved production SLO window.",
  }),
  alertDefinition({
    id: "api_latency_degraded",
    severity: "p1",
    signalName: "api.request.latency",
    condition: "p95_above_500ms_sustained",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#api-latency",
    description: "Common API request latency is above the production threshold.",
  }),
  alertDefinition({
    id: "queue_backlog",
    severity: "p0",
    signalName: "queue.work.latency",
    condition: "oldest_pending_age_or_depth_above_threshold",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#queue-backlog",
    description: "Queue backlog threatens accepted work visibility or processing latency.",
  }),
  alertDefinition({
    id: "webhook_success_degraded",
    severity: "p0",
    signalName: "webhook.delivery.success.total",
    condition: "eventual_success_below_slo",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#webhook-success",
    description: "Webhook eventual delivery success is below the approved target.",
  }),
  alertDefinition({
    id: "provider_connection_degraded",
    severity: "p1",
    signalName: "provider.connection.state",
    condition: "reconnect_failure_or_action_required_spike",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#provider-connection",
    description: "Provider connection health is degraded or action-required states are spiking.",
  }),
  alertDefinition({
    id: "worker_utilization_saturated",
    severity: "p1",
    signalName: "worker.utilization.ratio",
    condition: "sustained_utilization_above_capacity_threshold",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#worker-utilization",
    description: "Worker runtime is saturated and may need backpressure or scaling.",
  }),
  alertDefinition({
    id: "event_stream_errors",
    severity: "p1",
    signalName: "event_stream.errors.total",
    condition: "sustained_event_stream_error_rate",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#event-stream-errors",
    description: "SSE/event stream errors are sustained above the operational baseline.",
  }),
  alertDefinition({
    id: "dependency_not_ready",
    severity: "p0",
    signalName: "dependency.readiness",
    condition: "critical_dependency_unavailable",
    runbookRef: "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md#dependency-readiness",
    description: "A critical runtime dependency is unavailable and readiness must fail closed.",
  }),
]);

export function findAlertDefinition(id: string): AlertDefinition | undefined {
  return productionAlertDefinitions.find((definition) => definition.id === id);
}

function alertDefinition(definition: AlertDefinition): AlertDefinition {
  return Object.freeze({ ...definition });
}
