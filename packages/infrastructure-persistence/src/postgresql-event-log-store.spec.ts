import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createApplicationPortFailure, type ApplicationPortResult } from "@omniwa/application";
import type { EventDataClassification } from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
} from "@omniwa/shared";

import { EventOutboxConsumer, type EventOutboxPublisher } from "./event-outbox-consumer.js";
import { PostgresqlEventLogStore } from "./postgresql-event-log-store.js";
import {
  createPostgresqlConnectionPool,
  runPostgresqlSqlMigrations,
  type PostgresqlConnection,
} from "./postgresql-repositories.js";

const timestamp = "2026-07-05T00:00:00.000Z";
const postgresqlTestDatabaseUrl = process.env.OMNIWA_POSTGRES_TEST_DATABASE_URL?.trim();

if (postgresqlTestDatabaseUrl === undefined || postgresqlTestDatabaseUrl.length === 0) {
  describe.skip("PostgreSQL EventLog store", () => {
    it("requires OMNIWA_POSTGRES_TEST_DATABASE_URL to run", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("PostgreSQL EventLog store", () => {
    const connection = createPostgresqlConnectionPool(postgresqlTestDatabaseUrl);

    beforeEach(async () => {
      await runPostgresqlSqlMigrations(connection);
      await truncateEventLog(connection);
    });

    afterAll(async () => {
      await connection.end?.();
    });

    it("appends events idempotently and creates one pending outbox record", async () => {
      const eventLog = new PostgresqlEventLogStore(connection);

      const first = await eventLog.appendEvent(event("evt_pg_eventlog_1", "message.accepted.v1"));
      const duplicate = await eventLog.appendEvent(
        event("evt_pg_eventlog_1", "message.accepted.v1"),
      );
      const pending = await eventLog.listOutbox({ status: "pending" });

      expect(first.ok ? first.value : undefined).toMatchObject({
        id: "evt_pg_eventlog_1",
        cursor: "eventlog:1",
        type: "message.accepted.v1",
        timestamp,
      });
      expect(duplicate).toEqual(first);
      expect(pending.ok ? pending.value : undefined).toEqual([
        expect.objectContaining({
          outboxId: "outbox:evt_pg_eventlog_1",
          eventId: "evt_pg_eventlog_1",
          cursor: "eventlog:1",
          status: "pending",
          createdAt: timestamp,
        }),
      ]);
    });

    it("replays events with monotonic cursors across store instances", async () => {
      const firstStore = new PostgresqlEventLogStore(connection);
      await firstStore.appendEvent(event("evt_pg_eventlog_1", "message.accepted.v1"));
      await firstStore.appendEvent(event("evt_pg_eventlog_2", "message.delivered.v1"));

      const restartedStore = new PostgresqlEventLogStore(connection);
      const initialReplay = await restartedStore.replayEvents({ limit: 10 });
      const replayAfterFirst = await restartedStore.replayEvents({
        cursor: "eventlog:1",
        limit: 10,
      });

      expect(initialReplay.ok ? initialReplay.value : undefined).toMatchObject({
        cursorStatus: "no_cursor",
        oldestCursor: "eventlog:1",
        latestCursor: "eventlog:2",
        events: [
          expect.objectContaining({ id: "evt_pg_eventlog_1", cursor: "eventlog:1" }),
          expect.objectContaining({ id: "evt_pg_eventlog_2", cursor: "eventlog:2" }),
        ],
      });
      expect(replayAfterFirst.ok ? replayAfterFirst.value : undefined).toMatchObject({
        cursorStatus: "ok",
        oldestCursor: "eventlog:1",
        latestCursor: "eventlog:2",
        events: [expect.objectContaining({ id: "evt_pg_eventlog_2", cursor: "eventlog:2" })],
      });
    });

    it("reports not_found and expired cursor states deterministically", async () => {
      const eventLog = new PostgresqlEventLogStore(connection);
      await eventLog.appendEvent(event("evt_pg_eventlog_1", "message.accepted.v1"));
      await eventLog.appendEvent(event("evt_pg_eventlog_2", "message.delivered.v1"));

      await expect(eventLog.replayEvents({ cursor: "eventlog:99", limit: 10 })).resolves.toEqual(
        ok({
          events: [],
          cursorStatus: "not_found",
          oldestCursor: "eventlog:1",
          latestCursor: "eventlog:2",
        }),
      );

      await connection.query("DELETE FROM omniwa_event_outbox WHERE event_id = $1", [
        "evt_pg_eventlog_1",
      ]);
      await connection.query("DELETE FROM omniwa_event_log WHERE id = $1", ["evt_pg_eventlog_1"]);

      await expect(eventLog.replayEvents({ cursor: "eventlog:1", limit: 10 })).resolves.toEqual(
        ok({
          events: [],
          cursorStatus: "expired",
          oldestCursor: "eventlog:2",
          latestCursor: "eventlog:2",
        }),
      );
    });

    it("marks outbox records as published and survives store recreation", async () => {
      const firstStore = new PostgresqlEventLogStore(connection);
      await firstStore.appendEvent(event("evt_pg_eventlog_publish", "message.accepted.v1"));

      await expect(
        firstStore.markOutboxPublished("evt_pg_eventlog_publish", "2026-07-05T00:00:01.000Z"),
      ).resolves.toEqual(
        ok({
          eventId: "evt_pg_eventlog_publish",
          cursor: "eventlog:1",
          status: "published",
        }),
      );

      const restartedStore = new PostgresqlEventLogStore(connection);
      const published = await restartedStore.listOutbox({ status: "published" });
      const pending = await restartedStore.listOutbox({ status: "pending" });

      expect(pending.ok ? pending.value : undefined).toEqual([]);
      expect(published.ok ? published.value : undefined).toEqual([
        expect.objectContaining({
          eventId: "evt_pg_eventlog_publish",
          cursor: "eventlog:1",
          status: "published",
          publishedAt: "2026-07-05T00:00:01.000Z",
        }),
      ]);
    });

    it("drains PostgreSQL outbox records through the generic EventOutboxConsumer", async () => {
      const eventLog = new PostgresqlEventLogStore(connection);
      await eventLog.appendEvent(event("evt_pg_eventlog_consumer", "message.accepted.v1"));
      const publisher = new RecordingPublisher();
      const consumer = new EventOutboxConsumer({
        eventLog,
        publisher,
      });

      const result = await consumer.drainPending({
        requestContext: createRequestContext({
          requestId: createRequestId("req_eventlog_consumer"),
          correlationId: createCorrelationId("corr_eventlog_consumer"),
        }),
      });
      const pending = await eventLog.listOutbox({ status: "pending" });

      expect(result.ok ? result.value.published : undefined).toEqual([
        expect.objectContaining({
          eventId: "evt_pg_eventlog_consumer",
          cursor: "eventlog:1",
        }),
      ]);
      expect(result.ok ? result.value.failed : undefined).toEqual([]);
      expect(publisher.publishedEventIds()).toEqual(["evt_pg_eventlog_consumer"]);
      expect(pending.ok ? pending.value : undefined).toEqual([]);
    });

    it("keeps failed outbox publishes pending and returns safe failure summaries", async () => {
      const eventLog = new PostgresqlEventLogStore(connection);
      await eventLog.appendEvent(event("evt_pg_eventlog_failed_publish", "provider.failure.v1"));
      const consumer = new EventOutboxConsumer({
        eventLog,
        publisher: new FailingPublisher("raw-provider-payload"),
      });

      const result = await consumer.drainPending({
        requestContext: createRequestContext({
          requestId: createRequestId("req_eventlog_failed_consumer"),
          correlationId: createCorrelationId("corr_eventlog_failed_consumer"),
        }),
      });
      const pending = await eventLog.listOutbox({ status: "pending" });
      const serialized = JSON.stringify(result);

      expect(result.ok ? result.value : undefined).toEqual({
        attempted: 1,
        published: [],
        failed: [
          {
            eventId: "evt_pg_eventlog_failed_publish",
            cursor: "eventlog:1",
            code: "event_outbox_publish_rejected",
            retryable: true,
          },
        ],
      });
      expect(pending.ok ? pending.value.map((record) => record.eventId) : []).toEqual([
        "evt_pg_eventlog_failed_publish",
      ]);
      expect(serialized).not.toContain("raw-provider-payload");
    });

    it("rejects unsafe nested payloads without leaking raw values", async () => {
      const eventLog = new PostgresqlEventLogStore(connection);

      const result = await eventLog.appendEvent({
        ...event("evt_pg_eventlog_unsafe", "provider.failure.v1"),
        payload: {
          safeRef: "provider_signal_ref",
          unsafe: {
            rawProviderPayload: "raw-secret-provider-payload",
          },
        } as never,
      });
      const serialized = JSON.stringify(result);

      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.error.code).toBe("event_log_append_rejected");
      expect(serialized).not.toContain("raw-secret-provider-payload");
    });
  });
}

class RecordingPublisher implements EventOutboxPublisher {
  private readonly records: string[] = [];

  publish(record: { eventId: string }): ApplicationPortResult<{ eventId: string; accepted: true }> {
    this.records.push(record.eventId);
    return ok({
      eventId: record.eventId,
      accepted: true,
    });
  }

  publishedEventIds(): readonly string[] {
    return Object.freeze([...this.records]);
  }
}

class FailingPublisher implements EventOutboxPublisher {
  constructor(private readonly rawFailureMessage: string) {}

  publish(record: { eventId: string }): ApplicationPortResult<never> {
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

async function truncateEventLog(connection: PostgresqlConnection): Promise<void> {
  await connection.query("TRUNCATE TABLE omniwa_event_outbox, omniwa_event_log RESTART IDENTITY");
}

function event(id: string, type: string, dataClassification: EventDataClassification = "internal") {
  return {
    id,
    type,
    timestamp,
    dataClassification,
    source: "postgresql_event_log_test",
    resourceRef: "msg_pg_eventlog",
    correlationId: "corr_pg_eventlog",
    payload: {
      aggregateId: "msg_pg_eventlog",
      aggregateType: "Message",
      integrationEventName: type,
    },
  };
}
