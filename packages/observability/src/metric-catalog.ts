import {
  createMetricPoint,
  type MetricKind,
  type MetricPoint,
  type MetricPointInput,
} from "./metrics.js";
import type { SafeLogFields } from "./redaction.js";
import type { RuntimeRole } from "./runtime-role.js";

export type MetricDefinition = Readonly<{
  name: string;
  kind: MetricKind;
  runtimeRole: RuntimeRole;
  unit?: string;
  allowedLabels: readonly string[];
  description: string;
}>;

export const productionMetricDefinitions = Object.freeze([
  metricDefinition({
    name: "api.request.latency",
    kind: "histogram",
    runtimeRole: "api",
    unit: "milliseconds",
    allowedLabels: ["method", "route", "outcome"],
    description: "API request latency by method, normalized route, and outcome category.",
  }),
  metricDefinition({
    name: "queue.work.latency",
    kind: "histogram",
    runtimeRole: "worker",
    unit: "milliseconds",
    allowedLabels: ["work_type", "outcome"],
    description: "Queue work latency by approved work type and outcome category.",
  }),
  metricDefinition({
    name: "provider.connection.state",
    kind: "gauge",
    runtimeRole: "provider",
    allowedLabels: ["state", "provider_family"],
    description: "Provider connection state without raw provider account identifiers.",
  }),
  metricDefinition({
    name: "webhook.delivery.success.total",
    kind: "counter",
    runtimeRole: "webhook",
    allowedLabels: ["outcome", "receiver_category"],
    description: "Webhook delivery success/failure count by receiver category.",
  }),
  metricDefinition({
    name: "worker.utilization.ratio",
    kind: "gauge",
    runtimeRole: "worker",
    allowedLabels: ["worker_type"],
    description: "Worker utilization ratio from 0 to 1 by bounded worker type.",
  }),
  metricDefinition({
    name: "event_stream.errors.total",
    kind: "counter",
    runtimeRole: "api",
    allowedLabels: ["source", "reason_code"],
    description: "SSE/event stream error count by safe source and reason category.",
  }),
]);

export type ProductionMetricName = (typeof productionMetricDefinitions)[number]["name"];

export type CatalogMetricInput = Omit<MetricPointInput, "name" | "kind" | "runtimeRole" | "unit"> &
  Readonly<{
    labels?: SafeLogFields;
  }>;

export function createCatalogMetricPoint(
  name: ProductionMetricName,
  input: CatalogMetricInput,
): MetricPoint {
  const definition = findMetricDefinition(name);
  assertAllowedLabels(definition, input.labels);

  return createMetricPoint({
    ...input,
    name: definition.name,
    kind: definition.kind,
    runtimeRole: definition.runtimeRole,
    ...optional("unit", definition.unit),
  });
}

export function findMetricDefinition(name: ProductionMetricName): MetricDefinition {
  const definition = productionMetricDefinitions.find((candidate) => candidate.name === name);

  if (definition === undefined) {
    throw new TypeError(`Unknown production metric definition: ${name}`);
  }

  return definition;
}

function metricDefinition(definition: MetricDefinition): MetricDefinition {
  return Object.freeze({
    ...definition,
    allowedLabels: Object.freeze([...definition.allowedLabels].sort()),
  });
}

function assertAllowedLabels(
  definition: MetricDefinition,
  labels: SafeLogFields | undefined,
): void {
  if (labels === undefined) {
    return;
  }

  const allowed = new Set(definition.allowedLabels);

  for (const labelName of Object.keys(labels)) {
    if (!allowed.has(labelName)) {
      throw new TypeError(
        `${definition.name} label ${labelName} is not in the approved low-cardinality label set.`,
      );
    }
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
