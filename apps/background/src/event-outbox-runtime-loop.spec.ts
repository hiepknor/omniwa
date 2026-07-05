import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type EventOutboxRecord,
} from "@omniwa/application";
import {
  EventOutboxConsumer,
  createInMemoryEventLogStore,
  type EventOutboxConsumerRunResult,
  type EventOutboxPublisher,
  type EventOutboxPublisherReceipt,
} from "@omniwa/infrastructure-persistence";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, ok, type Clock } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  EventOutboxRuntimeLoop,
  readEventOutboxRuntimeLoopIntervalMilliseconds,
  type EventOutboxRuntimeLoopConsumer,
} from "./event-outbox-runtime-loop.js";

const timestamp = "2026-07-05T00:00:00.000Z";
const context: ApplicationPortContext = Object.freeze({
  requestContext: createRequestContext({
    correlationId: createCorrelationId("event-outbox-runtime-loop-test"),
  }),
  actorRef: "event-outbox-runtime-loop-test",
  dataClassification: "internal",
});

describe("EventOutboxRuntimeLoop", () => {
  it("drains pending outbox records and records safe backlog metrics", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_runtime_outbox_1"));
    eventLog.appendEvent(event("evt_runtime_outbox_2"));
    const publisher = new RecordingPublisher();
    const metrics = new CapturingMetricRecorder();
    const loop = new EventOutboxRuntimeLoop({
      consumer: new EventOutboxConsumer({
        eventLog,
        publisher,
        clock: fixedClock(1_804_000_000_100),
      }),
      eventLog,
      metricRecorder: metrics,
      contextFactory: () => context,
      clock: fixedClock(1_804_000_000_000),
    });

    const result = await loop.runOnce();

    expect(result).toEqual({
      outbox: {
        status: "completed",
        attempted: 2,
        published: 2,
        failed: 0,
      },
      metrics: {
        status: "recorded",
        recorded: 2,
      },
      durationMilliseconds: 0,
    });
    expect(publisher.publishedEventIds()).toEqual(["evt_runtime_outbox_1", "evt_runtime_outbox_2"]);
    expect(eventLog.listOutbox({ status: "pending" })).toMatchObject({
      ok: true,
      value: [],
    });
    expect(metrics.points.map((point) => [point.name, point.value, point.labels])).toEqual([
      ["eventlog.outbox.records", 0, { status: "pending" }],
      ["eventlog.outbox.records", 2, { status: "published" }],
    ]);
    expect(JSON.stringify(result)).not.toContain("evt_runtime_outbox");
  });

  it("keeps failed publishes pending and reports backlog without raw payload leakage", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_runtime_secret"));
    const metrics = new CapturingMetricRecorder();
    const loop = new EventOutboxRuntimeLoop({
      consumer: new EventOutboxConsumer({
        eventLog,
        publisher: new FailingPublisher("raw-provider-payload"),
      }),
      eventLog,
      metricRecorder: metrics,
      contextFactory: () => context,
      clock: fixedClock(1_804_000_000_000),
    });

    const result = await loop.runOnce();

    expect(result.outbox).toEqual({
      status: "completed",
      attempted: 1,
      published: 0,
      failed: 1,
    });
    expect(metrics.points.map((point) => [point.value, point.labels])).toEqual([
      [1, { status: "pending" }],
      [0, { status: "published" }],
    ]);
    expect(JSON.stringify(result)).not.toContain("evt_runtime_secret");
    expect(JSON.stringify(result)).not.toContain("raw-provider-payload");
  });

  it("returns safe metric failures when outbox backlog cannot be queried", async () => {
    const loop = new EventOutboxRuntimeLoop({
      consumer: new FixedConsumer({
        attempted: 0,
        published: [],
        failed: [],
      }),
      eventLog: new FailingOutboxPort("raw-outbox-storage-error"),
      metricRecorder: new CapturingMetricRecorder(),
      contextFactory: () => context,
      clock: fixedClock(1_804_000_000_000),
    });

    const result = await loop.runOnce();

    expect(result.metrics).toEqual({
      status: "failed",
      recorded: 0,
      failureCode: "event_outbox_metric_query_rejected",
    });
    expect(JSON.stringify(result)).not.toContain("raw-outbox-storage-error");
  });

  it("can start and stop the scheduled drain loop", async () => {
    const eventLog = createInMemoryEventLogStore();
    const consumer = new CountingConsumer();
    const loop = new EventOutboxRuntimeLoop({
      consumer,
      eventLog,
      intervalMilliseconds: 50,
      contextFactory: () => context,
      clock: fixedClock(1_804_000_000_000),
    });

    expect(loop.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 50,
    });

    loop.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await loop.stop();

    expect(loop.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 50,
    });
    expect(consumer.calls).toBeGreaterThanOrEqual(1);
  });

  it("reads a safe positive interval from env", () => {
    expect(
      readEventOutboxRuntimeLoopIntervalMilliseconds({
        OMNIWA_EVENT_OUTBOX_LOOP_INTERVAL_MS: "2500",
      } as NodeJS.ProcessEnv),
    ).toBe(2_500);
    expect(() =>
      readEventOutboxRuntimeLoopIntervalMilliseconds({
        OMNIWA_EVENT_OUTBOX_LOOP_INTERVAL_MS: "0",
      } as NodeJS.ProcessEnv),
    ).toThrow("OMNIWA_EVENT_OUTBOX_LOOP_INTERVAL_MS must be a positive integer.");
  });
});

class CapturingMetricRecorder implements MetricRecorder {
  readonly points: MetricPoint[] = [];

  recordMetric(point: MetricPoint): void {
    this.points.push(point);
  }
}

class RecordingPublisher implements EventOutboxPublisher {
  private readonly eventIds: string[] = [];

  publish(record: EventOutboxRecord): ApplicationPortResult<EventOutboxPublisherReceipt> {
    this.eventIds.push(record.eventId);

    return ok(
      Object.freeze({
        eventId: record.eventId,
        accepted: true,
      }),
    );
  }

  publishedEventIds(): readonly string[] {
    return Object.freeze([...this.eventIds]);
  }
}

class FailingPublisher implements EventOutboxPublisher {
  constructor(private readonly rawFailureMessage: string) {}

  publish(): ApplicationPortResult<EventOutboxPublisherReceipt> {
    void this.rawFailureMessage;
    return {
      ok: false,
      error: createApplicationPortFailure({
        category: "unavailable",
        code: "event_outbox_publish_rejected",
        message: "Event outbox publication failed.",
        retryable: true,
        ownerContext: "observability",
      }),
    };
  }
}

class FixedConsumer implements EventOutboxRuntimeLoopConsumer {
  constructor(private readonly result: EventOutboxConsumerRunResult) {}

  drainPending(): Promise<ApplicationPortResult<EventOutboxConsumerRunResult>> {
    return Promise.resolve(ok(this.result));
  }
}

class CountingConsumer implements EventOutboxRuntimeLoopConsumer {
  calls = 0;

  drainPending(): Promise<ApplicationPortResult<EventOutboxConsumerRunResult>> {
    this.calls += 1;
    return Promise.resolve(
      ok({
        attempted: 0,
        published: [],
        failed: [],
      }),
    );
  }
}

class FailingOutboxPort {
  constructor(private readonly rawFailureMessage: string) {}

  listOutbox(): ApplicationPortResult<readonly EventOutboxRecord[]> {
    void this.rawFailureMessage;
    return {
      ok: false,
      error: createApplicationPortFailure({
        category: "unavailable",
        code: "raw_outbox_backend_failed",
        message: "Outbox backend failed.",
        retryable: true,
        ownerContext: "observability",
      }),
    };
  }

  markOutboxPublished(): ApplicationPortResult<never> {
    throw new Error("not used");
  }
}

function fixedClock(epochMilliseconds: number): Clock {
  return {
    now: () => new Date(epochMilliseconds),
    epochMilliseconds: () => epochMilliseconds,
    isoNow: () => new Date(epochMilliseconds).toISOString() as ReturnType<Clock["isoNow"]>,
  };
}

function event(id: string) {
  return {
    id,
    type: "message.accepted.v1",
    timestamp,
    dataClassification: "internal" as const,
    source: "event_outbox_runtime_loop_test",
    resourceRef: "msg_event_outbox_runtime",
    payload: {
      aggregateId: "msg_event_outbox_runtime",
      aggregateType: "Message",
      domainEventName: "MessageAccepted",
      eventIndex: 0,
    },
  };
}
