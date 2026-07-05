import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EventDataClassification, IntegrationEventName } from "@omniwa/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createAsyncEventLogPortFromSync } from "./async-event-log-port-adapter.js";
import { createDurableJsonEventLogStore, createInMemoryEventLogStore } from "./event-log-store.js";

const timestamp = "2026-07-05T00:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("async EventLog compatibility adapter", () => {
  it("wraps sync append and replay semantics behind the async port", async () => {
    const eventLog = createAsyncEventLogPortFromSync(createInMemoryEventLogStore());

    const append = await eventLog.appendEvent(event("evt_async_1", "message.accepted.v1"));
    const replay = await eventLog.replayEvents({ limit: 10 });

    expect(append.ok ? append.value : undefined).toMatchObject({
      id: "evt_async_1",
      cursor: "eventlog:1",
    });
    expect(replay.ok ? replay.value : undefined).toMatchObject({
      cursorStatus: "no_cursor",
      latestCursor: "eventlog:1",
      events: [
        expect.objectContaining({
          id: "evt_async_1",
          type: "message.accepted.v1",
        }),
      ],
    });
  });

  it("preserves idempotent append and outbox publication semantics", async () => {
    const eventLog = createAsyncEventLogPortFromSync(createInMemoryEventLogStore());

    const first = await eventLog.appendEvent(event("evt_async_idempotent", "message.accepted.v1"));
    const duplicate = await eventLog.appendEvent(
      event("evt_async_idempotent", "message.accepted.v1"),
    );
    const pending = await eventLog.listOutbox({ status: "pending" });
    const markPublished = await eventLog.markOutboxPublished(
      "evt_async_idempotent",
      "2026-07-05T00:00:01.000Z",
    );
    const published = await eventLog.listOutbox({ status: "published" });

    expect(duplicate).toEqual(first);
    expect(pending.ok ? pending.value : undefined).toEqual([
      expect.objectContaining({
        eventId: "evt_async_idempotent",
        status: "pending",
      }),
    ]);
    expect(markPublished.ok ? markPublished.value : undefined).toEqual({
      eventId: "evt_async_idempotent",
      cursor: "eventlog:1",
      status: "published",
    });
    expect(published.ok ? published.value : undefined).toEqual([
      expect.objectContaining({
        eventId: "evt_async_idempotent",
        status: "published",
        publishedAt: "2026-07-05T00:00:01.000Z",
      }),
    ]);
  });

  it("keeps durable JSON EventLog state usable through the async port across restarts", async () => {
    const filePath = join(createTemporaryDirectory(), "event-log.json");
    const firstEventLog = createAsyncEventLogPortFromSync(createDurableJsonEventLogStore(filePath));

    await firstEventLog.appendEvent(event("evt_async_durable_1", "message.accepted.v1"));
    await firstEventLog.appendEvent(event("evt_async_durable_2", "message.delivered.v1"));
    await firstEventLog.markOutboxPublished("evt_async_durable_1", "2026-07-05T00:00:02.000Z");

    const restartedEventLog = createAsyncEventLogPortFromSync(
      createDurableJsonEventLogStore(filePath),
    );
    const replay = await restartedEventLog.replayEvents({ cursor: "eventlog:1", limit: 10 });
    const pending = await restartedEventLog.listOutbox({ status: "pending" });
    const published = await restartedEventLog.listOutbox({ status: "published" });

    expect(replay.ok ? replay.value.events : undefined).toEqual([
      expect.objectContaining({
        id: "evt_async_durable_2",
        cursor: "eventlog:2",
      }),
    ]);
    expect(pending.ok ? pending.value.map((record) => record.eventId) : []).toEqual([
      "evt_async_durable_2",
    ]);
    expect(published.ok ? published.value.map((record) => record.eventId) : []).toEqual([
      "evt_async_durable_1",
    ]);
  });
});

function event(
  id: string,
  type: IntegrationEventName,
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
      aggregateId: "msg_1",
      aggregateType: "Message",
      integrationEventName: type,
    },
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-async-event-log-"));
  temporaryDirectories.push(directory);
  return directory;
}
