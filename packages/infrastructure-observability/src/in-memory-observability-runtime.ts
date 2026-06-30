import type {
  HealthCheck,
  HealthProbeResult,
  HealthSnapshot,
  LogEntry,
  MetricPoint,
  MetricRecorder,
  RuntimeRole,
  StructuredLogger,
  TraceRecorder,
  TraceSpan,
} from "@omniwa/observability";
import { createHealthProbeResult, summarizeHealthSnapshot } from "@omniwa/observability";
import { systemClock, type Clock } from "@omniwa/shared";

export type ObservabilityRuntimeSnapshot = Readonly<{
  logs: readonly LogEntry[];
  metrics: readonly MetricPoint[];
  spans: readonly TraceSpan[];
  health: readonly HealthProbeResult[];
}>;

export type InMemoryObservabilityRuntimeOptions = Readonly<{
  clock?: Pick<Clock, "epochMilliseconds">;
}>;

export class InMemoryObservabilityRuntime
  implements StructuredLogger, MetricRecorder, TraceRecorder
{
  private readonly logs: LogEntry[] = [];
  private readonly metrics: MetricPoint[] = [];
  private readonly spans: TraceSpan[] = [];
  private readonly healthChecks = new Map<string, HealthCheck>();
  private readonly latestHealth = new Map<string, HealthProbeResult>();
  private readonly clock: Pick<Clock, "epochMilliseconds">;

  constructor(options: InMemoryObservabilityRuntimeOptions = {}) {
    this.clock = options.clock ?? systemClock;
  }

  write(entry: LogEntry): void {
    this.logs.push(freezeLogEntry(entry));
  }

  recordMetric(point: MetricPoint): void {
    this.metrics.push(freezeMetricPoint(point));
  }

  recordSpan(span: TraceSpan): void {
    this.spans.push(freezeTraceSpan(span));
  }

  registerHealthCheck(check: HealthCheck): void {
    this.healthChecks.set(
      healthCheckKey(check.runtimeRole, check.name),
      Object.freeze({ ...check }),
    );
  }

  async evaluateHealth(runtimeRole: RuntimeRole): Promise<HealthSnapshot> {
    const checks = [...this.healthChecks.values()].filter(
      (check) => check.runtimeRole === runtimeRole,
    );
    const results: HealthProbeResult[] = [];

    for (const check of checks) {
      const result = await evaluateHealthCheck(check, this.clock);
      this.latestHealth.set(healthCheckKey(result.runtimeRole, result.name), result);
      results.push(result);
    }

    return summarizeHealthSnapshot(runtimeRole, results);
  }

  snapshot(): ObservabilityRuntimeSnapshot {
    return Object.freeze({
      logs: Object.freeze([...this.logs]),
      metrics: Object.freeze([...this.metrics]),
      spans: Object.freeze([...this.spans]),
      health: Object.freeze([...this.latestHealth.values()]),
    });
  }

  clear(): void {
    this.logs.length = 0;
    this.metrics.length = 0;
    this.spans.length = 0;
    this.latestHealth.clear();
  }
}

function freezeLogEntry(entry: LogEntry): LogEntry {
  return Object.freeze({
    ...entry,
    ...(entry.context === undefined ? {} : { context: Object.freeze({ ...entry.context }) }),
    ...(entry.fields === undefined ? {} : { fields: Object.freeze({ ...entry.fields }) }),
    ...(entry.error === undefined ? {} : { error: Object.freeze({ ...entry.error }) }),
  });
}

function freezeMetricPoint(point: MetricPoint): MetricPoint {
  return Object.freeze({
    ...point,
    ...(point.context === undefined ? {} : { context: Object.freeze({ ...point.context }) }),
    ...(point.labels === undefined ? {} : { labels: Object.freeze({ ...point.labels }) }),
  });
}

function freezeTraceSpan(span: TraceSpan): TraceSpan {
  return Object.freeze({
    ...span,
    context: Object.freeze({ ...span.context }),
    ...(span.attributes === undefined ? {} : { attributes: Object.freeze({ ...span.attributes }) }),
  });
}

async function evaluateHealthCheck(
  check: HealthCheck,
  clock: Pick<Clock, "epochMilliseconds">,
): Promise<HealthProbeResult> {
  try {
    return createHealthProbeResult(await check.check());
  } catch {
    return createHealthProbeResult({
      name: check.name,
      runtimeRole: check.runtimeRole,
      state: "unavailable",
      critical: check.critical,
      checkedAtEpochMilliseconds: clock.epochMilliseconds(),
      causeCode: "health_check_failed",
    });
  }
}

function healthCheckKey(runtimeRole: RuntimeRole, name: string): string {
  return `${runtimeRole}:${name}`;
}
