import type { ApplicationPortContext, EventOutboxRecord } from "@omniwa/application";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  type Clock,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  JsonLineEventOutboxPublisher,
  toPublicEventOutboxPublicationRecord,
} from "./event-outbox-publisher.js";

const context: ApplicationPortContext = Object.freeze({
  requestContext: createRequestContext({
    correlationId: createCorrelationId("event-outbox-publisher-test"),
    requestId: createRequestId("event-outbox-publisher-request"),
  }),
  actorRef: "runtime:event-outbox",
  dataClassification: "internal",
});

describe("JsonLineEventOutboxPublisher", () => {
  it("writes safe event outbox publication records and returns an accepted receipt", () => {
    const sink = new CapturingSink();
    const publisher = new JsonLineEventOutboxPublisher({
      sink,
      clock: fixedClock("2026-07-05T00:00:00.000Z"),
    });

    const result = publisher.publish(eventOutboxRecord("evt_outbox_publisher_1"), context);

    expect(result).toEqual({
      ok: true,
      value: {
        eventId: "evt_outbox_publisher_1",
        accepted: true,
        publishedAt: "2026-07-05T00:00:00.000Z",
      },
    });
    expect(sink.lines).toHaveLength(1);
    expect(JSON.parse(sink.lines[0] ?? "")).toEqual({
      kind: "event_outbox_publication",
      eventId: "evt_outbox_publisher_1",
      outboxId: "outbox:evt_outbox_publisher_1",
      cursor: "eventlog:1",
      status: "published",
      createdAt: "2026-07-05T00:00:00.000Z",
      publishedAt: "2026-07-05T00:00:00.000Z",
      actorRef: "runtime:event-outbox",
      correlationId: "event-outbox-publisher-test",
      requestId: "event-outbox-publisher-request",
    });
  });

  it("does not serialize raw provider payload fields", () => {
    const serialized = JSON.stringify(
      toPublicEventOutboxPublicationRecord(
        eventOutboxRecord("evt_safe_publication"),
        context,
        "2026-07-05T00:00:00.000Z",
      ),
    );

    expect(serialized).not.toContain("raw-provider-payload");
    expect(serialized).not.toContain("raw-qr");
    expect(serialized).not.toContain("raw-jid");
    expect(serialized).not.toContain("raw-text");
  });
});

class CapturingSink {
  readonly lines: string[] = [];

  writeLine(line: string): void {
    this.lines.push(line);
  }
}

function fixedClock(iso: string): Pick<Clock, "isoNow"> {
  return {
    isoNow: () => iso as ReturnType<Clock["isoNow"]>,
  };
}

function eventOutboxRecord(eventId: string): EventOutboxRecord {
  return Object.freeze({
    outboxId: `outbox:${eventId}`,
    eventId,
    cursor: "eventlog:1",
    status: "pending",
    createdAt: "2026-07-05T00:00:00.000Z",
  });
}
