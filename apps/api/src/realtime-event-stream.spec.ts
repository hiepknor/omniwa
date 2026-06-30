import { describe, expect, it } from "vitest";

import {
  createRealtimeEventEnvelope,
  createStaticRealtimeEventSource,
  encodeServerSentEvents,
} from "./realtime-event-stream.js";

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
