import {
  createApplicationPortFailure,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type AsyncEventOutboxPort,
  type EventOutboxPort,
  type EventOutboxStatus,
} from "@omniwa/application";
import {
  classifyValue,
  createCatalogMetricPoint,
  toSafeLogFields,
  type MetricPoint,
  type MetricRecorder,
} from "@omniwa/observability";
import { err, ok } from "@omniwa/shared";

export type EventOutboxBacklogMetricOptions = Readonly<{
  eventLog: EventOutboxPort | AsyncEventOutboxPort;
  observedAtEpochMilliseconds?: number;
}>;

export type EventOutboxBacklogMetricRecordOptions = EventOutboxBacklogMetricOptions &
  Readonly<{
    metricRecorder: MetricRecorder;
  }>;

export type EventOutboxBacklogMetricRecordResult = Readonly<{
  recorded: number;
}>;

const measuredStatuses: readonly EventOutboxStatus[] = Object.freeze(["pending", "published"]);

export async function createEventOutboxBacklogMetricPoints(
  options: EventOutboxBacklogMetricOptions,
): Promise<ApplicationPortResult<readonly MetricPoint[]>> {
  const metrics: MetricPoint[] = [];

  for (const status of measuredStatuses) {
    const records = await options.eventLog.listOutbox({ status });

    if (!records.ok) {
      return err(eventOutboxMetricFailure("event_outbox_metric_query_rejected", records.error));
    }

    metrics.push(
      createCatalogMetricPoint("eventlog.outbox.records", {
        value: records.value.length,
        labels: toSafeLogFields({
          status: classifyValue(status, "public"),
        }),
        ...optional("observedAtEpochMilliseconds", options.observedAtEpochMilliseconds),
      }),
    );
  }

  return ok(Object.freeze(metrics));
}

export async function recordEventOutboxBacklogMetrics(
  options: EventOutboxBacklogMetricRecordOptions,
): Promise<ApplicationPortResult<EventOutboxBacklogMetricRecordResult>> {
  const metrics = await createEventOutboxBacklogMetricPoints(options);

  if (!metrics.ok) {
    return err(metrics.error);
  }

  for (const metric of metrics.value) {
    options.metricRecorder.recordMetric(metric);
  }

  return ok({
    recorded: metrics.value.length,
  });
}

function eventOutboxMetricFailure(
  code: string,
  cause?: ApplicationPortFailure,
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: cause?.category ?? "unavailable",
    code,
    message: "EventLog outbox metric collection failed.",
    retryable: cause?.retryable ?? true,
    ownerContext: "observability",
    safeMetadata: Object.freeze({
      ...(cause === undefined ? {} : { causeCode: cause.code }),
    }),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
