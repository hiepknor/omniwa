import type { EventDataClassification } from "@omniwa/domain";

import type { ApplicationPortResult } from "./application-port.js";

export type SafePlatformEventPayloadValue = string | number | boolean | null;

export type PlatformEventPayload = Readonly<Record<string, SafePlatformEventPayloadValue>>;

export type PlatformEventRecord = Readonly<{
  id: string;
  cursor: string;
  type: string;
  version: "v1";
  timestamp: string;
  dataClassification: EventDataClassification;
  source: string;
  payload: PlatformEventPayload;
  resourceRef?: string;
  correlationId?: string;
}>;

export type PlatformEventAppendInput = Omit<PlatformEventRecord, "cursor" | "payload" | "version"> &
  Readonly<{
    payload?: PlatformEventPayload;
  }>;

export const eventLogCursorStatuses = ["no_cursor", "ok", "not_found", "expired"] as const;

export type EventLogCursorStatus = (typeof eventLogCursorStatuses)[number];

export type EventLogReplayRequest = Readonly<{
  cursor?: string;
  limit: number;
}>;

export type EventLogReplayResult = Readonly<{
  events: readonly PlatformEventRecord[];
  cursorStatus: EventLogCursorStatus;
  oldestCursor?: string;
  latestCursor?: string;
}>;

export const eventOutboxStatuses = ["pending", "published"] as const;

export type EventOutboxStatus = (typeof eventOutboxStatuses)[number];

export type EventOutboxRecord = Readonly<{
  outboxId: string;
  eventId: string;
  cursor: string;
  status: EventOutboxStatus;
  createdAt: string;
  publishedAt?: string;
}>;

export type EventOutboxQuery = Readonly<{
  status?: EventOutboxStatus;
}>;

export type EventOutboxPublishResult = Readonly<{
  eventId: string;
  cursor: string;
  status: "published";
}>;

export interface EventLogAppendPort {
  appendEvent(input: PlatformEventAppendInput): ApplicationPortResult<PlatformEventRecord>;
}

export interface EventLogReplayPort {
  replayEvents(request: EventLogReplayRequest): ApplicationPortResult<EventLogReplayResult>;
}

export interface EventOutboxPort {
  listOutbox(query?: EventOutboxQuery): ApplicationPortResult<readonly EventOutboxRecord[]>;
  markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): ApplicationPortResult<EventOutboxPublishResult>;
}

export interface EventLogPort extends EventLogAppendPort, EventLogReplayPort, EventOutboxPort {}

const safeTokenPattern = /^[A-Za-z0-9_.:-]+$/u;

export function createPlatformEventRecord(input: PlatformEventRecord): PlatformEventRecord {
  assertSafeToken(input.id, "Platform event id");
  assertSafeToken(input.cursor, "Platform event cursor");
  assertSafeEventType(input.type);
  assertSafeToken(input.source, "Platform event source");

  if (!Number.isFinite(Date.parse(input.timestamp))) {
    throw new TypeError("Platform event timestamp must be ISO-8601 compatible.");
  }

  const payload = input.payload;

  for (const [key, value] of Object.entries(payload)) {
    assertSafeToken(key, "Platform event payload key");

    if (!isSafePlatformPayloadValue(value)) {
      throw new TypeError("Platform event payload values must be safe scalars.");
    }
  }

  return Object.freeze({
    id: input.id,
    cursor: input.cursor,
    type: input.type,
    version: "v1",
    timestamp: input.timestamp,
    dataClassification: input.dataClassification,
    source: input.source,
    payload: Object.freeze({ ...payload }),
    ...optional("resourceRef", input.resourceRef),
    ...optional("correlationId", input.correlationId),
  });
}

export function createPlatformEventAppendInput(
  input: PlatformEventAppendInput,
): PlatformEventAppendInput {
  const syntheticRecord = createPlatformEventRecord({
    ...input,
    cursor: "eventlog:0",
    version: "v1",
    payload: input.payload ?? {},
  });

  return Object.freeze({
    id: syntheticRecord.id,
    type: syntheticRecord.type,
    timestamp: syntheticRecord.timestamp,
    dataClassification: syntheticRecord.dataClassification,
    source: syntheticRecord.source,
    payload: syntheticRecord.payload,
    ...optional("resourceRef", syntheticRecord.resourceRef),
    ...optional("correlationId", syntheticRecord.correlationId),
  });
}

function assertSafeToken(value: string, label: string): void {
  if (!safeTokenPattern.test(value)) {
    throw new TypeError(`${label} must contain only safe token characters.`);
  }
}

function assertSafeEventType(value: string): void {
  if (value.trim().length === 0 || !safeTokenPattern.test(value)) {
    throw new TypeError("Platform event type must be a safe non-empty token.");
  }
}

function isSafePlatformPayloadValue(value: unknown): value is SafePlatformEventPayloadValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
