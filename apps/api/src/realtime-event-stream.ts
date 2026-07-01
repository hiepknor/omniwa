import type {
  EventLogCursorStatus,
  EventLogReplayPort,
  PlatformEventRecord,
} from "@omniwa/application";

export type RealtimeEventDataClassification = "public" | "internal" | "confidential";

export type SafeRealtimePayloadValue = string | number | boolean | null;

export type RealtimeEventPayload = Readonly<Record<string, SafeRealtimePayloadValue>>;

export type RealtimeEventEnvelope = Readonly<{
  id: string;
  cursor: string;
  type: string;
  version: "v1";
  timestamp: string;
  dataClassification: RealtimeEventDataClassification;
  source: string;
  payload: RealtimeEventPayload;
  resourceRef?: string;
  correlationId?: string;
}>;

export type RealtimeEventEnvelopeInput = Readonly<{
  id: string;
  cursor: string;
  type: string;
  timestamp: string;
  dataClassification: RealtimeEventDataClassification;
  source: string;
  payload?: RealtimeEventPayload;
  resourceRef?: string;
  correlationId?: string;
}>;

export type RealtimeReplayRequest = Readonly<{
  cursor?: string;
  limit: number;
}>;

export type RealtimeCursorInspection = Readonly<{
  status: EventLogCursorStatus;
  oldestCursor?: string;
  latestCursor?: string;
}>;

export type RealtimeEventSource = Readonly<{
  replay(request: RealtimeReplayRequest): readonly RealtimeEventEnvelope[];
  inspectCursor?(request: RealtimeReplayRequest): RealtimeCursorInspection;
}>;

export type SseEncodingInput = Readonly<{
  events: readonly RealtimeEventEnvelope[];
  requestId: string;
  correlationId: string;
  timestamp: string;
}>;

const safeTokenPattern = /^[A-Za-z0-9_.:-]+$/u;

export function createRealtimeEventEnvelope(
  input: RealtimeEventEnvelopeInput,
): RealtimeEventEnvelope {
  assertSafeToken(input.id, "Realtime event id");
  assertSafeToken(input.cursor, "Realtime event cursor");

  if (input.type.trim().length === 0) {
    throw new TypeError("Realtime event type must be non-empty.");
  }

  if (input.source.trim().length === 0) {
    throw new TypeError("Realtime event source must be non-empty.");
  }

  const payload = input.payload ?? {};

  for (const [key, value] of Object.entries(payload)) {
    assertSafeToken(key, "Realtime event payload key");

    if (!isSafePayloadValue(value)) {
      throw new TypeError("Realtime event payload values must be safe scalars.");
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
    ...(input.resourceRef === undefined ? {} : { resourceRef: input.resourceRef }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
}

export function createEmptyRealtimeEventSource(): RealtimeEventSource {
  return createStaticRealtimeEventSource([]);
}

export function createStaticRealtimeEventSource(
  events: readonly RealtimeEventEnvelope[],
): RealtimeEventSource {
  const retainedEvents = Object.freeze([...events]);

  return Object.freeze({
    replay: (request) => {
      const inspection = inspectStaticCursor(retainedEvents, request);

      if (inspection.status === "not_found" || inspection.status === "expired") {
        return Object.freeze([]);
      }

      const startIndex =
        request.cursor === undefined
          ? 0
          : retainedEvents.findIndex((event) => event.cursor === request.cursor) + 1;

      return Object.freeze(retainedEvents.slice(startIndex, startIndex + request.limit));
    },
    inspectCursor: (request) => inspectStaticCursor(retainedEvents, request),
  });
}

export function createEventLogRealtimeEventSource(
  eventLog: EventLogReplayPort,
): RealtimeEventSource {
  return Object.freeze({
    replay: (request) => {
      const result = eventLog.replayEvents(request);

      if (!result.ok) {
        return Object.freeze([]);
      }

      return Object.freeze(result.value.events.map(eventLogRecordToRealtimeEnvelope));
    },
    inspectCursor: (request) => {
      const result = eventLog.replayEvents(request);

      if (!result.ok) {
        return Object.freeze({
          status: "not_found",
        });
      }

      return Object.freeze({
        status: result.value.cursorStatus,
        ...(result.value.oldestCursor === undefined
          ? {}
          : { oldestCursor: result.value.oldestCursor }),
        ...(result.value.latestCursor === undefined
          ? {}
          : { latestCursor: result.value.latestCursor }),
      });
    },
  });
}

export function encodeServerSentEvents(input: SseEncodingInput): string {
  const lines = [
    `: omniwa-stream requestId=${input.requestId} correlationId=${input.correlationId} timestamp=${input.timestamp}`,
    "",
  ];

  for (const event of input.events) {
    lines.push(`id: ${event.cursor}`);
    lines.push(`event: ${event.type}`);
    lines.push(`data: ${JSON.stringify(event)}`);
    lines.push("");
  }

  lines.push(": heartbeat");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function assertSafeToken(value: string, label: string): void {
  if (!safeTokenPattern.test(value)) {
    throw new TypeError(`${label} must contain only safe token characters.`);
  }
}

function isSafePayloadValue(value: unknown): value is SafeRealtimePayloadValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function inspectStaticCursor(
  events: readonly RealtimeEventEnvelope[],
  request: RealtimeReplayRequest,
): RealtimeCursorInspection {
  const oldestCursor = events[0]?.cursor;
  const latestCursor = events.at(-1)?.cursor;

  if (request.cursor === undefined) {
    return Object.freeze({
      status: "no_cursor",
      ...(oldestCursor === undefined ? {} : { oldestCursor }),
      ...(latestCursor === undefined ? {} : { latestCursor }),
    });
  }

  if (events.some((event) => event.cursor === request.cursor)) {
    return Object.freeze({
      status: "ok",
      ...(oldestCursor === undefined ? {} : { oldestCursor }),
      ...(latestCursor === undefined ? {} : { latestCursor }),
    });
  }

  return Object.freeze({
    status: "not_found",
    ...(oldestCursor === undefined ? {} : { oldestCursor }),
    ...(latestCursor === undefined ? {} : { latestCursor }),
  });
}

function eventLogRecordToRealtimeEnvelope(record: PlatformEventRecord): RealtimeEventEnvelope {
  return createRealtimeEventEnvelope({
    id: record.id,
    cursor: record.cursor,
    type: record.type,
    timestamp: record.timestamp,
    dataClassification: record.dataClassification,
    source: record.source,
    payload: record.payload,
    ...(record.resourceRef === undefined ? {} : { resourceRef: record.resourceRef }),
    ...(record.correlationId === undefined ? {} : { correlationId: record.correlationId }),
  });
}
