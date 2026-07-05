import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type EventOutboxRecord,
} from "@omniwa/application";
import {
  createCorrelationId,
  createRequestContext,
  err,
  ok,
  toIsoTimestamp,
  type Clock,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  EventOutboxConsumer,
  createNoopEventOutboxPublisher,
  type EventOutboxPublisher,
} from "./event-outbox-consumer.js";
import { createInMemoryEventLogStore } from "./event-log-store.js";

const timestamp = "2026-07-05T00:00:00.000Z";
const context: ApplicationPortContext = Object.freeze({
  requestContext: createRequestContext({
    correlationId: createCorrelationId("event-outbox-consumer-test"),
  }),
  actorRef: "event-outbox-consumer-test",
});
const fixedClock: Clock = {
  epochMilliseconds: () => Date.parse(timestamp),
  now: () => new Date(timestamp),
  isoNow: () => toIsoTimestamp(new Date(timestamp)),
};

describe("EventOutboxConsumer", () => {
  it("publishes pending outbox records and marks them published", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_outbox_1", "message.accepted.v1"));
    const publisher = new RecordingPublisher();
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher,
      clock: fixedClock,
    });

    const result = await consumer.drainPending(context);
    const pending = eventLog.listOutbox({ status: "pending" });
    const published = eventLog.listOutbox({ status: "published" });

    expect(result.ok ? result.value : undefined).toEqual({
      attempted: 1,
      published: [
        {
          eventId: "evt_outbox_1",
          cursor: "eventlog:1",
          publishedAt: timestamp,
        },
      ],
      failed: [],
    });
    expect(publisher.publishedEventIds()).toEqual(["evt_outbox_1"]);
    expect(pending.ok ? pending.value : []).toEqual([]);
    expect(published.ok ? published.value : undefined).toEqual([
      expect.objectContaining({
        eventId: "evt_outbox_1",
        status: "published",
        publishedAt: timestamp,
      }),
    ]);
  });

  it("does not publish already published records on a second drain", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_outbox_1", "message.accepted.v1"));
    const publisher = new RecordingPublisher();
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher,
      clock: fixedClock,
    });

    await consumer.drainPending(context);
    const second = await consumer.drainPending(context);

    expect(second.ok ? second.value : undefined).toEqual({
      attempted: 0,
      published: [],
      failed: [],
    });
    expect(publisher.publishedEventIds()).toEqual(["evt_outbox_1"]);
  });

  it("keeps failed records pending and returns only safe failure data", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent({
      ...event("evt_outbox_secret", "provider.failure.v1"),
      payload: {
        safeRef: "provider_signal_ref",
      },
    });
    const publisher = new FailingPublisher("raw-secret-provider-payload");
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher,
      clock: fixedClock,
    });

    const result = await consumer.drainPending(context);
    const pending = eventLog.listOutbox({ status: "pending" });
    const serialized = JSON.stringify(result);

    expect(result.ok ? result.value : undefined).toEqual({
      attempted: 1,
      published: [],
      failed: [
        {
          eventId: "evt_outbox_secret",
          cursor: "eventlog:1",
          code: "event_outbox_publish_rejected",
          retryable: true,
        },
      ],
    });
    expect(pending.ok ? pending.value.map((record) => record.eventId) : []).toEqual([
      "evt_outbox_secret",
    ]);
    expect(serialized).not.toContain("raw-secret-provider-payload");
  });

  it("records thrown publisher failures safely without leaking error messages", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_outbox_throw", "provider.failure.v1"));
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher: {
        publish(): ApplicationPortResult<never> {
          throw new Error("raw provider payload in exception");
        },
      },
      clock: fixedClock,
    });

    const result = await consumer.drainPending(context);
    const serialized = JSON.stringify(result);

    expect(result.ok ? result.value.failed : undefined).toEqual([
      {
        eventId: "evt_outbox_throw",
        cursor: "eventlog:1",
        code: "event_outbox_publish_threw",
        retryable: true,
      },
    ]);
    expect(serialized).not.toContain("raw provider payload");
  });

  it("limits each drain to the configured batch size", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_outbox_1", "message.accepted.v1"));
    eventLog.appendEvent(event("evt_outbox_2", "message.delivered.v1"));
    const publisher = new RecordingPublisher();
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher,
      clock: fixedClock,
      batchSize: 1,
    });

    const first = await consumer.drainPending(context);
    const second = await consumer.drainPending(context);

    expect(first.ok ? first.value.published.map((record) => record.eventId) : []).toEqual([
      "evt_outbox_1",
    ]);
    expect(second.ok ? second.value.published.map((record) => record.eventId) : []).toEqual([
      "evt_outbox_2",
    ]);
    expect(publisher.publishedEventIds()).toEqual(["evt_outbox_1", "evt_outbox_2"]);
  });

  it("provides a no-op publisher for local acknowledgement loops", async () => {
    const eventLog = createInMemoryEventLogStore();
    eventLog.appendEvent(event("evt_outbox_noop", "message.accepted.v1"));
    const consumer = new EventOutboxConsumer({
      eventLog,
      publisher: createNoopEventOutboxPublisher(),
      clock: fixedClock,
    });

    const result = await consumer.drainPending(context);

    expect(result.ok ? result.value.published.map((record) => record.eventId) : []).toEqual([
      "evt_outbox_noop",
    ]);
  });
});

class RecordingPublisher implements EventOutboxPublisher {
  private readonly records: EventOutboxRecord[] = [];

  publish(record: EventOutboxRecord): ApplicationPortResult<{ eventId: string; accepted: true }> {
    this.records.push(record);
    return ok({
      eventId: record.eventId,
      accepted: true,
    });
  }

  publishedEventIds(): readonly string[] {
    return Object.freeze(this.records.map((record) => record.eventId));
  }
}

class FailingPublisher implements EventOutboxPublisher {
  constructor(private readonly rawFailureMessage: string) {}

  publish(record: EventOutboxRecord): ApplicationPortResult<never> {
    void this.rawFailureMessage;
    return err(
      createApplicationPortFailure({
        category: "unavailable",
        code: "event_outbox_publish_rejected",
        message: "Event outbox publication failed.",
        retryable: true,
        ownerContext: "observability",
        safeMetadata: {
          eventId: record.eventId,
        },
      }),
    );
  }
}

function event(id: string, type: string) {
  return {
    id,
    type,
    timestamp,
    dataClassification: "internal" as const,
    source: "event_outbox_consumer_test",
    resourceRef: "resource_ref",
    correlationId: "event-outbox-consumer-test",
    payload: {
      safeRef: id,
    },
  };
}
