import {
  createApplicationPortFailure,
  type ApplicationPortResult,
  type EventOutboxRecord,
} from "@omniwa/application";
import {
  createAsyncEventLogPortFromSync,
  createInMemoryEventLogStore,
} from "@omniwa/infrastructure-persistence";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { err } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  createEventOutboxBacklogMetricPoints,
  recordEventOutboxBacklogMetrics,
} from "./event-outbox-metrics.js";

const timestamp = "2026-07-05T00:00:00.000Z";

describe("EventLog outbox metrics", () => {
  it("creates low-cardinality backlog metrics from a sync outbox port", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_metric_pending_1"));
    eventLog.appendEvent(event("evt_metric_published_1"));
    eventLog.markOutboxPublished("evt_metric_published_1", timestamp);

    const metrics = await createEventOutboxBacklogMetricPoints({
      eventLog,
      observedAtEpochMilliseconds: 1_804_000_000_000,
    });

    expect(metrics.ok ? metrics.value : undefined).toEqual([
      expect.objectContaining({
        name: "eventlog.outbox.records",
        value: 1,
        labels: {
          status: "pending",
        },
        observedAtEpochMilliseconds: 1_804_000_000_000,
      }),
      expect.objectContaining({
        name: "eventlog.outbox.records",
        value: 1,
        labels: {
          status: "published",
        },
      }),
    ]);
    expect(JSON.stringify(metrics)).not.toContain("evt_metric_pending_1");
    expect(JSON.stringify(metrics)).not.toContain("evt_metric_published_1");
  });

  it("records backlog metrics through an async outbox port", async () => {
    const syncEventLog = createInMemoryEventLogStore();
    syncEventLog.appendEvent(event("evt_metric_async_pending"));
    const eventLog = createAsyncEventLogPortFromSync(syncEventLog);
    const recorder = new CapturingMetricRecorder();

    const result = await recordEventOutboxBacklogMetrics({
      eventLog,
      metricRecorder: recorder,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        recorded: 2,
      },
    });
    expect(recorder.points.map((point) => [point.name, point.value, point.labels])).toEqual([
      ["eventlog.outbox.records", 1, { status: "pending" }],
      ["eventlog.outbox.records", 0, { status: "published" }],
    ]);
  });

  it("returns safe failures without leaking raw outbox backend errors", async () => {
    const eventLog = new FailingOutboxPort("raw-provider-payload");

    const result = await createEventOutboxBacklogMetricPoints({ eventLog });
    const serialized = JSON.stringify(result);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "event_outbox_metric_query_rejected",
      message: "EventLog outbox metric collection failed.",
      safeMetadata: {
        causeCode: "raw_outbox_backend_failed",
      },
    });
    expect(serialized).not.toContain("raw-provider-payload");
  });
});

class CapturingMetricRecorder implements MetricRecorder {
  readonly points: MetricPoint[] = [];

  recordMetric(point: MetricPoint): void {
    this.points.push(point);
  }
}

class FailingOutboxPort {
  constructor(private readonly rawFailureMessage: string) {}

  listOutbox(): ApplicationPortResult<readonly EventOutboxRecord[]> {
    void this.rawFailureMessage;
    return err(
      createApplicationPortFailure({
        category: "unavailable",
        code: "raw_outbox_backend_failed",
        message: "Outbox backend failed.",
        retryable: true,
        ownerContext: "observability",
      }),
    );
  }

  markOutboxPublished(): ApplicationPortResult<never> {
    throw new Error("not used");
  }
}

function event(id: string) {
  return {
    id,
    type: "message.accepted.v1",
    timestamp,
    dataClassification: "internal" as const,
    source: "event_outbox_metric_test",
    resourceRef: "msg_event_outbox_metric",
    payload: {
      aggregateId: "msg_event_outbox_metric",
      aggregateType: "Message",
      domainEventName: "MessageAccepted",
      eventIndex: 0,
    },
  };
}
