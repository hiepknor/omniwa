import {
  createApplicationPortFailure,
  createPlatformEventAppendInput,
  createPlatformEventRecord,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type AsyncEventLogPort,
  type EventLogReplayRequest,
  type EventLogReplayResult,
  type EventOutboxPublishResult,
  type EventOutboxQuery,
  type EventOutboxRecord,
  type PlatformEventAppendInput,
  type PlatformEventRecord,
} from "@omniwa/application";
import type { EventDataClassification } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";
import type { QueryResultRow } from "pg";

import type { PostgresqlQueryExecutor } from "./postgresql-aggregate-repository.js";
import type {
  PostgresqlConnection,
  PostgresqlTransactionClient,
} from "./postgresql-repositories.js";

export type PostgresqlEventLogStoreOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

type EventLogRow = QueryResultRow & {
  sequence_number: string | number;
  id: string;
  event_type: string;
  event_version: string;
  event_timestamp: Date | string;
  data_classification: EventDataClassification;
  source: string;
  resource_ref: string | null;
  correlation_id: string | null;
  payload: unknown;
};

type EventOutboxRow = QueryResultRow & {
  outbox_id: string;
  event_id: string;
  cursor: string;
  status: "pending" | "published";
  created_at: Date | string;
  published_at: Date | string | null;
};

type EventLogBoundsRow = QueryResultRow & {
  oldest_sequence: string | null;
  latest_sequence: string | null;
};

const cursorPrefix = "eventlog:";

export class PostgresqlEventLogStore implements AsyncEventLogPort {
  private readonly connection: PostgresqlConnection;
  private readonly migrationBarrier: (() => Promise<void>) | undefined;

  constructor(connection: PostgresqlConnection, options: PostgresqlEventLogStoreOptions = {}) {
    this.connection = connection;
    this.migrationBarrier = options.migrationBarrier;
  }

  async appendEvent(
    input: PlatformEventAppendInput,
  ): Promise<ApplicationPortResult<PlatformEventRecord>> {
    let client: PostgresqlTransactionClient | undefined;

    try {
      await this.ensureReady();
      client = await this.connection.connect();

      const safeInput = createPlatformEventAppendInput(input);
      await client.query("BEGIN");

      try {
        const inserted = await client.query<EventLogRow>(
          `INSERT INTO omniwa_event_log (
            id,
            event_type,
            event_version,
            event_timestamp,
            data_classification,
            source,
            resource_ref,
            correlation_id,
            payload
          ) VALUES ($1, $2, 'v1', $3::timestamptz, $4, $5, $6, $7, $8::jsonb)
          ON CONFLICT (id) DO NOTHING
          RETURNING
            sequence_number::text,
            id,
            event_type,
            event_version,
            event_timestamp,
            data_classification,
            source,
            resource_ref,
            correlation_id,
            payload`,
          [
            safeInput.id,
            safeInput.type,
            safeInput.timestamp,
            safeInput.dataClassification,
            safeInput.source,
            safeInput.resourceRef ?? null,
            safeInput.correlationId ?? null,
            JSON.stringify(safeInput.payload ?? {}),
          ],
        );
        const row = inserted.rows[0] ?? (await this.findEventRowById(safeInput.id, client));

        if (row === undefined) {
          throw new Error("PostgreSQL EventLog append did not return or find the event.");
        }

        const event = eventRecordFromRow(row);

        if (inserted.rows[0] !== undefined) {
          await client.query(
            `INSERT INTO omniwa_event_outbox (
              outbox_id,
              event_id,
              cursor,
              status,
              created_at
            ) VALUES ($1, $2, $3, 'pending', $4::timestamptz)
            ON CONFLICT (event_id) DO NOTHING`,
            [`outbox:${event.id}`, event.id, event.cursor, event.timestamp],
          );
        }

        await client.query("COMMIT");

        return ok(event);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } catch (error) {
      return err(eventLogFailure("unsafe_payload", "event_log_append_rejected", error));
    } finally {
      client?.release();
    }
  }

  async replayEvents(
    request: EventLogReplayRequest,
  ): Promise<ApplicationPortResult<EventLogReplayResult>> {
    try {
      await this.ensureReady();

      const limit = normalizeReplayLimit(request.limit);
      const bounds = await this.loadBounds();

      if (request.cursor === undefined) {
        const events = await this.findEventsAfterSequence(undefined, limit);

        return ok(replayResult(events, "no_cursor", bounds));
      }

      const sequence = sequenceFromCursor(request.cursor);

      if (sequence === undefined) {
        return ok(replayResult([], "not_found", bounds));
      }

      const cursorExists = await this.cursorSequenceExists(sequence);

      if (cursorExists) {
        const events = await this.findEventsAfterSequence(sequence, limit);

        return ok(replayResult(events, "ok", bounds));
      }

      if (bounds.oldestSequence !== undefined && sequence < bounds.oldestSequence) {
        return ok(replayResult([], "expired", bounds));
      }

      return ok(replayResult([], "not_found", bounds));
    } catch (error) {
      return err(eventLogFailure("rejected", "event_log_replay_rejected", error));
    }
  }

  async listOutbox(
    query: EventOutboxQuery = {},
  ): Promise<ApplicationPortResult<readonly EventOutboxRecord[]>> {
    try {
      await this.ensureReady();

      const result =
        query.status === undefined
          ? await this.connection.query<EventOutboxRow>(
              `SELECT outbox_id, event_id, cursor, status, created_at, published_at
              FROM omniwa_event_outbox
              ORDER BY created_at ASC, outbox_id ASC`,
            )
          : await this.connection.query<EventOutboxRow>(
              `SELECT outbox_id, event_id, cursor, status, created_at, published_at
              FROM omniwa_event_outbox
              WHERE status = $1
              ORDER BY created_at ASC, outbox_id ASC`,
              [query.status],
            );

      return ok(Object.freeze(result.rows.map(outboxRecordFromRow)));
    } catch (error) {
      return err(eventLogFailure("rejected", "event_outbox_list_rejected", error));
    }
  }

  async markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): Promise<ApplicationPortResult<EventOutboxPublishResult>> {
    try {
      await this.ensureReady();

      const result = await this.connection.query<{ event_id: string; cursor: string }>(
        `UPDATE omniwa_event_outbox
        SET status = 'published', published_at = $2::timestamptz
        WHERE event_id = $1
        RETURNING event_id, cursor`,
        [eventId, publishedAt],
      );
      const row = result.rows[0];

      if (row === undefined) {
        return err(
          eventLogFailure("rejected", "event_outbox_record_not_found", undefined, {
            eventId,
          }),
        );
      }

      return ok({
        eventId: row.event_id,
        cursor: row.cursor,
        status: "published",
      });
    } catch (error) {
      return err(eventLogFailure("rejected", "event_outbox_mark_rejected", error));
    }
  }

  private async ensureReady(): Promise<void> {
    await this.migrationBarrier?.();
  }

  private async findEventRowById(
    eventId: string,
    connection: PostgresqlQueryExecutor = this.connection,
  ): Promise<EventLogRow | undefined> {
    const result = await connection.query<EventLogRow>(
      `SELECT
        sequence_number::text,
        id,
        event_type,
        event_version,
        event_timestamp,
        data_classification,
        source,
        resource_ref,
        correlation_id,
        payload
      FROM omniwa_event_log
      WHERE id = $1`,
      [eventId],
    );

    return result.rows[0];
  }

  private async findEventsAfterSequence(
    sequence: bigint | undefined,
    limit: number,
  ): Promise<readonly PlatformEventRecord[]> {
    const result =
      sequence === undefined
        ? await this.connection.query<EventLogRow>(
            `SELECT
              sequence_number::text,
              id,
              event_type,
              event_version,
              event_timestamp,
              data_classification,
              source,
              resource_ref,
              correlation_id,
              payload
            FROM omniwa_event_log
            ORDER BY sequence_number ASC
            LIMIT $1`,
            [limit],
          )
        : await this.connection.query<EventLogRow>(
            `SELECT
              sequence_number::text,
              id,
              event_type,
              event_version,
              event_timestamp,
              data_classification,
              source,
              resource_ref,
              correlation_id,
              payload
            FROM omniwa_event_log
            WHERE sequence_number > $1::bigint
            ORDER BY sequence_number ASC
            LIMIT $2`,
            [sequence.toString(), limit],
          );

    return Object.freeze(result.rows.map(eventRecordFromRow));
  }

  private async cursorSequenceExists(sequence: bigint): Promise<boolean> {
    const result = await this.connection.query(
      "SELECT 1 FROM omniwa_event_log WHERE sequence_number = $1::bigint",
      [sequence.toString()],
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  private async loadBounds(): Promise<
    Readonly<{ oldestSequence?: bigint; latestSequence?: bigint }>
  > {
    const result = await this.connection.query<EventLogBoundsRow>(
      "SELECT min(sequence_number)::text AS oldest_sequence, max(sequence_number)::text AS latest_sequence FROM omniwa_event_log",
    );
    const row = result.rows[0];

    return Object.freeze({
      ...optional("oldestSequence", parseOptionalSequence(row?.oldest_sequence)),
      ...optional("latestSequence", parseOptionalSequence(row?.latest_sequence)),
    });
  }
}

function eventRecordFromRow(row: EventLogRow): PlatformEventRecord {
  return createPlatformEventRecord({
    id: row.id,
    cursor: cursorFromSequence(row.sequence_number),
    type: row.event_type,
    version: "v1",
    timestamp: isoFromDatabaseTimestamp(row.event_timestamp),
    dataClassification: row.data_classification,
    source: row.source,
    payload: safePayload(row.payload),
    ...optional("resourceRef", row.resource_ref ?? undefined),
    ...optional("correlationId", row.correlation_id ?? undefined),
  });
}

function outboxRecordFromRow(row: EventOutboxRow): EventOutboxRecord {
  return Object.freeze({
    outboxId: row.outbox_id,
    eventId: row.event_id,
    cursor: row.cursor,
    status: row.status,
    createdAt: isoFromDatabaseTimestamp(row.created_at),
    ...optional(
      "publishedAt",
      row.published_at === null ? undefined : isoFromDatabaseTimestamp(row.published_at),
    ),
  });
}

function replayResult(
  events: readonly PlatformEventRecord[],
  cursorStatus: EventLogReplayResult["cursorStatus"],
  bounds: Readonly<{ oldestSequence?: bigint; latestSequence?: bigint }>,
): EventLogReplayResult {
  return Object.freeze({
    events: Object.freeze([...events]),
    cursorStatus,
    ...optional(
      "oldestCursor",
      bounds.oldestSequence === undefined ? undefined : cursorFromSequence(bounds.oldestSequence),
    ),
    ...optional(
      "latestCursor",
      bounds.latestSequence === undefined ? undefined : cursorFromSequence(bounds.latestSequence),
    ),
  });
}

function safePayload(value: unknown): PlatformEventRecord["payload"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Object.freeze({});
  }

  return Object.freeze({ ...(value as PlatformEventRecord["payload"]) });
}

function cursorFromSequence(sequence: string | number | bigint): string {
  return `${cursorPrefix}${String(sequence)}`;
}

function sequenceFromCursor(cursor: string): bigint | undefined {
  if (!cursor.startsWith(cursorPrefix)) {
    return undefined;
  }

  try {
    const sequence = BigInt(cursor.slice(cursorPrefix.length));

    return sequence > 0n ? sequence : undefined;
  } catch {
    return undefined;
  }
}

function parseOptionalSequence(value: string | null | undefined): bigint | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return BigInt(value);
}

function normalizeReplayLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("EventLog replay limit must be a positive integer.");
  }

  return Math.min(value, 1_000);
}

function isoFromDatabaseTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function eventLogFailure(
  category: ApplicationPortFailure["category"],
  code: string,
  error?: unknown,
  safeMetadata: ApplicationPortFailure["safeMetadata"] = {},
): ApplicationPortFailure {
  return createApplicationPortFailure({
    category,
    code,
    message: "EventLog persistence operation failed.",
    retryable: category === "unavailable" || category === "unknown",
    ownerContext: "observability",
    safeMetadata: Object.freeze({
      ...safeMetadata,
      ...(error instanceof Error ? { causeName: error.name } : {}),
    }),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
