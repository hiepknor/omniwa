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

export type RealtimeEventSource = Readonly<{
  replay(request: RealtimeReplayRequest): readonly RealtimeEventEnvelope[];
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
      const startIndex =
        request.cursor === undefined
          ? 0
          : retainedEvents.findIndex((event) => event.cursor === request.cursor) + 1;

      if (startIndex <= 0 && request.cursor !== undefined) {
        return Object.freeze([]);
      }

      return Object.freeze(retainedEvents.slice(startIndex, startIndex + request.limit));
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
