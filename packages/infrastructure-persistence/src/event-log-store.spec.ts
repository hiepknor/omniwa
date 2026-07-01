import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDomainEvent,
  type EventDataClassification,
  type IntegrationEventName,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  ok,
  toIsoTimestamp,
  type Clock,
} from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  EventLogInternalEventBus,
  createDurableJsonEventLogStore,
  createInMemoryEventLogStore,
} from "./event-log-store.js";

const temporaryDirectories: string[] = [];
const timestamp = "2026-06-30T00:00:00.000Z";
const context = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("event-log-correlation"),
  }),
};
const fixedClock: Clock = {
  epochMilliseconds: () => Date.parse(timestamp),
  now: () => new Date(timestamp),
  isoNow: () => toIsoTimestamp(new Date(timestamp)),
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("event log store", () => {
  it("persists events and outbox state across durable JSON store restarts", () => {
    const filePath = join(createTemporaryDirectory(), "event-log.json");
    const firstStore = createDurableJsonEventLogStore(filePath);

    const first = firstStore.appendEvent(event("evt_1", "message.accepted.v1"));
    const second = firstStore.appendEvent(event("evt_2", "worker.job.completed.v1"));

    expect(first.ok ? first.value.cursor : undefined).toBe("eventlog:1");
    expect(second.ok ? second.value.cursor : undefined).toBe("eventlog:2");
    expect(firstStore.markOutboxPublished("evt_1", "2026-06-30T00:00:01.000Z").ok).toBe(true);

    const restartedStore = createDurableJsonEventLogStore(filePath);
    const replay = restartedStore.replayEvents({ cursor: "eventlog:1", limit: 10 });
    const pendingOutbox = restartedStore.listOutbox({ status: "pending" });
    const publishedOutbox = restartedStore.listOutbox({ status: "published" });

    expect(replay.ok ? replay.value : undefined).toMatchObject({
      cursorStatus: "ok",
      events: [
        expect.objectContaining({
          id: "evt_2",
          cursor: "eventlog:2",
        }),
      ],
    });
    expect(pendingOutbox.ok ? pendingOutbox.value.map((record) => record.eventId) : []).toEqual([
      "evt_2",
    ]);
    expect(publishedOutbox.ok ? publishedOutbox.value : undefined).toEqual([
      expect.objectContaining({
        eventId: "evt_1",
        status: "published",
        publishedAt: "2026-06-30T00:00:01.000Z",
      }),
    ]);
  });

  it("keeps event IDs idempotent without duplicating outbox records", () => {
    const store = createInMemoryEventLogStore();

    const first = store.appendEvent(event("evt_idempotent", "message.accepted.v1"));
    const duplicate = store.appendEvent(event("evt_idempotent", "message.accepted.v1"));
    const outbox = store.listOutbox();

    expect(duplicate.ok ? duplicate.value : undefined).toEqual(first.ok ? first.value : undefined);
    expect(outbox.ok ? outbox.value : []).toHaveLength(1);
  });

  it("returns deterministic expired cursor status after retention trimming", () => {
    const store = createInMemoryEventLogStore({ retentionLimit: 2 });

    store.appendEvent(event("evt_1", "message.accepted.v1"));
    store.appendEvent(event("evt_2", "message.delivered.v1"));
    store.appendEvent(event("evt_3", "message.read.v1"));

    const expired = store.replayEvents({ cursor: "eventlog:1", limit: 10 });
    const retained = store.replayEvents({ cursor: "eventlog:2", limit: 10 });
    const duplicateExpiredEvent = store.appendEvent(event("evt_1", "message.accepted.v1"));

    expect(expired.ok ? expired.value : undefined).toMatchObject({
      cursorStatus: "expired",
      events: [],
      oldestCursor: "eventlog:2",
      latestCursor: "eventlog:3",
    });
    expect(retained.ok ? retained.value.events.map((entry) => entry.cursor) : []).toEqual([
      "eventlog:3",
    ]);
    expect(duplicateExpiredEvent.ok).toBe(false);
    expect(duplicateExpiredEvent.ok ? undefined : duplicateExpiredEvent.error.code).toBe(
      "event_log_event_already_recorded",
    );
  });

  it("persists application notifications through EventLogInternalEventBus before handlers run", async () => {
    const store = createInMemoryEventLogStore();
    const bus = new EventLogInternalEventBus({
      eventLog: store,
      clock: fixedClock,
    });
    const handled: string[] = [];
    bus.subscribe("product_fact_published", "test-handler", (notification) => {
      handled.push(notification.sourceSignalRef);
      return ok(undefined);
    });

    const result = await bus.publishDomainFacts(
      [
        createDomainEvent({
          aggregateType: "Message",
          aggregateId: "msg_1",
          name: "MessageAccepted",
        }),
      ],
      context,
    );
    const replay = store.replayEvents({ limit: 10 });

    expect(result.ok ? result.value : undefined).toMatchObject({
      accepted: true,
      publicationRef: "eventlog:1",
    });
    expect(handled).toEqual(["Message:msg_1:MessageAccepted"]);
    expect(replay.ok ? replay.value.events : undefined).toEqual([
      expect.objectContaining({
        type: "message.accepted.v1",
        dataClassification: "internal",
        resourceRef: "Message:msg_1:MessageAccepted",
        correlationId: "event-log-correlation",
        payload: expect.objectContaining({
          aggregateId: "msg_1",
          aggregateType: "Message",
          integrationEventName: "message.accepted.v1",
          notificationName: "product_fact_published",
        }),
      }),
    ]);
  });
});

function event(
  id: string,
  type: IntegrationEventName | "worker.job.completed.v1",
  dataClassification: EventDataClassification = "internal",
) {
  return {
    id,
    type,
    timestamp,
    dataClassification,
    source: "messaging",
    resourceRef: "msg_1",
    correlationId: "event-log-correlation",
    payload: {
      messageId: "msg_1",
      status: "accepted",
    },
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-event-log-"));
  temporaryDirectories.push(directory);

  return directory;
}
