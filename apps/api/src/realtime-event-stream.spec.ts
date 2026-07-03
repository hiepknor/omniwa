import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createDurableJsonEventLogStore,
  createInMemoryEventLogStore,
} from "@omniwa/infrastructure-persistence";

import {
  createEventLogRealtimeEventSource,
  createRealtimeEventEnvelope,
  createStaticRealtimeEventSource,
  encodeServerSentEvents,
} from "./realtime-event-stream.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("realtime event stream", () => {
  it("replays retained events after the provided cursor", () => {
    const source = createStaticRealtimeEventSource([
      event("evt_1", "cursor_1"),
      event("evt_2", "cursor_2"),
      event("evt_3", "cursor_3"),
    ]);

    expect(source.replay({ cursor: "cursor_1", limit: 10 }).map((entry) => entry.cursor)).toEqual([
      "cursor_2",
      "cursor_3",
    ]);
  });

  it("does not replay expired or unknown cursors", () => {
    const source = createStaticRealtimeEventSource([event("evt_1", "cursor_1")]);

    expect(source.replay({ cursor: "expired_cursor", limit: 10 })).toEqual([]);
    expect(source.inspectCursor?.({ cursor: "expired_cursor", limit: 10 })).toMatchObject({
      status: "not_found",
    });
  });

  it("replays durable event log records and exposes retention-aware cursor inspection", () => {
    const eventLog = createInMemoryEventLogStore({ retentionLimit: 2 });
    eventLog.appendEvent(eventLogInput("evt_1", "message.accepted.v1"));
    eventLog.appendEvent(eventLogInput("evt_2", "message.delivered.v1"));
    eventLog.appendEvent(eventLogInput("evt_3", "message.read.v1"));

    const source = createEventLogRealtimeEventSource(eventLog);

    expect(source.replay({ cursor: "eventlog:2", limit: 10 }).map((entry) => entry.cursor)).toEqual(
      ["eventlog:3"],
    );
    expect(source.inspectCursor?.({ cursor: "eventlog:1", limit: 10 })).toMatchObject({
      status: "expired",
      oldestCursor: "eventlog:2",
      latestCursor: "eventlog:3",
    });
  });

  it("resumes SSE replay from a durable EventLog after store restart", () => {
    const filePath = join(createTemporaryDirectory(), "event-log.json");
    const firstStore = createDurableJsonEventLogStore(filePath);
    firstStore.appendEvent(eventLogInput("evt_1", "message.accepted.v1"));
    firstStore.appendEvent(eventLogInput("evt_2", "message.delivered.v1"));

    const restartedStore = createDurableJsonEventLogStore(filePath);
    const source = createEventLogRealtimeEventSource(restartedStore);
    const replay = source.replay({ cursor: "eventlog:1", limit: 10 });

    expect(replay).toEqual([
      expect.objectContaining({
        id: "evt_2",
        cursor: "eventlog:2",
        type: "message.delivered.v1",
      }),
    ]);
    expect(source.inspectCursor?.({ cursor: "eventlog:1", limit: 10 })).toMatchObject({
      status: "ok",
      oldestCursor: "eventlog:1",
      latestCursor: "eventlog:2",
    });
  });

  it("encodes safe SSE envelopes", () => {
    const encoded = encodeServerSentEvents({
      events: [event("evt_1", "cursor_1")],
      requestId: "req_1",
      correlationId: "corr_1",
      timestamp: "2026-06-30T00:00:00.000Z",
    });

    expect(encoded).toContain(": omniwa-stream requestId=req_1");
    expect(encoded).toContain("id: cursor_1");
    expect(encoded).toContain("event: message.accepted.v1");
    expect(encoded).toContain(": heartbeat");
  });

  it("streams QR lifecycle events from EventLog without leaking raw QR payloads", () => {
    const rawQr = "raw-qr-secret-token";
    const eventLog = createInMemoryEventLogStore({ retentionLimit: 10 });
    eventLog.appendEvent({
      id: "provider_signal:qr",
      type: "provider.auth.v1",
      timestamp: "2026-06-30T00:00:00.000Z",
      dataClassification: "confidential",
      source: "provider_runtime",
      resourceRef: "session_1",
      payload: {
        providerId: "provider.baileys",
        signalRef: "provider.baileys.qr_required",
        signalKind: "auth",
        targetRef: "session_1",
        occurrenceRef: "provider.baileys.session_1.qr_required.qr_challenge_0123456789abcdef",
        dataClassification: "confidential",
        challengeRef: "qr_challenge_0123456789abcdef",
        expiresAtEpochMilliseconds: 1_804_000_060_000,
        refreshPolicy: "replace_active",
      },
    });

    const source = createEventLogRealtimeEventSource(eventLog);
    const encoded = encodeServerSentEvents({
      events: source.replay({ limit: 10 }),
      requestId: "req_qr",
      correlationId: "corr_qr",
      timestamp: "2026-06-30T00:00:01.000Z",
    });

    expect(encoded).toContain("event: provider.auth.v1");
    expect(encoded).toContain("qr_challenge_0123456789abcdef");
    expect(encoded).toContain("replace_active");
    expect(encoded).not.toContain(rawQr);
  });

  it("streams provider inbound and status events without leaking raw provider payloads", () => {
    const rawJid = "12025550123@s.whatsapp.net";
    const rawText = "private inbound body";
    const rawProviderMessageId = "BAILEYS_RAW_PROVIDER_MESSAGE_ID";
    const eventLog = createInMemoryEventLogStore({ retentionLimit: 10 });

    eventLog.appendEvent({
      id: "provider_signal:inbound",
      type: "provider.inbound_message.v1",
      timestamp: "2026-06-30T00:00:00.000Z",
      dataClassification: "confidential",
      source: "provider_runtime",
      resourceRef: "session_1",
      payload: {
        providerId: "provider.baileys",
        signalRef: "provider.baileys.inbound_message",
        signalKind: "inbound_message",
        targetRef: "session_1",
        occurrenceRef: "provider.baileys.session_1.inbound.provider_msg_0123456789abcdef",
        dataClassification: "confidential",
        providerMessageRef: "provider_msg_0123456789abcdef",
        conversationRef: "conversation_fedcba9876543210",
        occurredAt: "2026-06-30T00:00:00.000Z",
        contentKind: "text",
        conversationKind: "private",
      },
    });
    eventLog.appendEvent({
      id: "provider_signal:status",
      type: "provider.message_status.v1",
      timestamp: "2026-06-30T00:00:01.000Z",
      dataClassification: "confidential",
      source: "provider_runtime",
      resourceRef: "session_1",
      payload: {
        providerId: "provider.baileys",
        signalRef: "provider.baileys.message_delivered",
        signalKind: "message_status",
        targetRef: "session_1",
        occurrenceRef:
          "provider.baileys.session_1.message_status.provider_msg_0123456789abcdef.delivered",
        dataClassification: "confidential",
        providerMessageRef: "provider_msg_0123456789abcdef",
        status: "delivered",
        occurredAt: "2026-06-30T00:00:01.000Z",
      },
    });

    const source = createEventLogRealtimeEventSource(eventLog);
    const encoded = encodeServerSentEvents({
      events: source.replay({ limit: 10 }),
      requestId: "req_provider_events",
      correlationId: "corr_provider_events",
      timestamp: "2026-06-30T00:00:02.000Z",
    });

    expect(encoded).toContain("event: provider.inbound_message.v1");
    expect(encoded).toContain("event: provider.message_status.v1");
    expect(encoded).toContain("provider_msg_0123456789abcdef");
    expect(encoded).toContain("conversation_fedcba9876543210");
    expect(encoded).toContain("delivered");
    expect(encoded).not.toContain(rawJid);
    expect(encoded).not.toContain(rawText);
    expect(encoded).not.toContain(rawProviderMessageId);
  });

  it("rejects unsafe nested payloads", () => {
    expect(() =>
      createRealtimeEventEnvelope({
        id: "evt_1",
        cursor: "cursor_1",
        type: "message.accepted.v1",
        timestamp: "2026-06-30T00:00:00.000Z",
        dataClassification: "internal",
        source: "messaging",
        payload: {
          unsafe: { nested: true } as never,
        },
      }),
    ).toThrow(/safe scalars/u);
  });
});

function event(id: string, cursor: string) {
  return createRealtimeEventEnvelope({
    id,
    cursor,
    type: "message.accepted.v1",
    timestamp: "2026-06-30T00:00:00.000Z",
    dataClassification: "internal",
    source: "messaging",
    resourceRef: "msg_1",
    payload: {
      messageId: "msg_1",
      status: "accepted",
    },
  });
}

function eventLogInput(id: string, type: string) {
  return {
    id,
    type,
    timestamp: "2026-06-30T00:00:00.000Z",
    dataClassification: "internal" as const,
    source: "messaging",
    resourceRef: "msg_1",
    payload: {
      messageId: "msg_1",
      status: "accepted",
    },
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-realtime-event-log-"));
  temporaryDirectories.push(directory);

  return directory;
}
