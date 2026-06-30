import type { LogContext } from "./logger.js";
import type { SafeLogFields } from "./redaction.js";
import type { RuntimeRole } from "./runtime-role.js";

export const metricKinds = ["counter", "gauge", "histogram"] as const;

export type MetricKind = (typeof metricKinds)[number];

export type MetricPoint = Readonly<{
  name: string;
  kind: MetricKind;
  value: number;
  runtimeRole: RuntimeRole;
  unit?: string;
  labels?: SafeLogFields;
  context?: LogContext;
  observedAtEpochMilliseconds?: number;
}>;

export type MetricPointInput = Omit<MetricPoint, "name"> &
  Readonly<{
    name: string;
  }>;

export interface MetricRecorder {
  recordMetric(point: MetricPoint): void;
}

export function createMetricPoint(input: MetricPointInput): MetricPoint {
  assertSafeTelemetryName(input.name, "MetricPoint.name");
  assertFiniteNumber(input.value, "MetricPoint.value");

  if (input.unit !== undefined) {
    assertSafeTelemetryName(input.unit, "MetricPoint.unit");
  }

  return Object.freeze({
    ...input,
    ...optional("labels", freezeSafeFields(input.labels)),
    ...optional("context", freezeLogContext(input.context)),
  });
}

export function assertSafeTelemetryName(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_.-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a safe lowercase telemetry name.`);
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

function freezeSafeFields(fields: SafeLogFields | undefined): SafeLogFields | undefined {
  return fields === undefined ? undefined : Object.freeze({ ...fields });
}

function freezeLogContext(context: LogContext | undefined): LogContext | undefined {
  return context === undefined ? undefined : Object.freeze({ ...context });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
