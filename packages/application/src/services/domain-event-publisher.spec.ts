import {
  acceptMessage,
  createGuardrailDecisionId,
  createInstanceId,
  createMessageId,
  createOutboundMessageIntent,
  type DomainEvent,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import type { ApplicationPortContext, ApplicationPortResult } from "../ports/application-port.js";
import {
  createPlatformEventRecord,
  type EventLogCursorStatus,
  type EventLogPort,
  type EventLogReplayRequest,
  type EventLogReplayResult,
  type EventOutboxPublishResult,
  type EventOutboxQuery,
  type EventOutboxRecord,
  type PlatformEventAppendInput,
  type PlatformEventRecord,
} from "../ports/event-log.js";
import { createDomainEventPublisher } from "./domain-event-publisher.js";

const requestContext = createRequestContext({
  requestId: createRequestId("domain-event-publisher-request"),
  correlationId: createCorrelationId("domain-event-publisher-correlation"),
});
const applicationContext: ApplicationPortContext = Object.freeze({
  requestContext,
  actorRef: "api_key:test",
});

describe("domain event publisher", () => {
  it("publishes only events after baseEventCount", async () => {
    const eventLog = new FakeEventLogPort();
    const publisher = createDomainEventPublisher({
      eventLog,
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });
    const created = createOutboundMessageIntent({
      id: createMessageId("msg_event_publish_1"),
      instanceId: createInstanceId("inst_event_publish_1"),
      type: "text",
    });
    const baseEventCount = created.domainEvents.length;
    const accepted = acceptMessage(created, createGuardrailDecisionId("guardrail_event_publish_1"));

    const result = await publisher.publishNewEvents({
      aggregateEvents: accepted.domainEvents,
      baseEventCount,
      executionRef: "cmd_send_text_1",
      context: applicationContext,
    });

    expect(result.ok).toBe(true);
    expect(eventLog.records()).toHaveLength(1);
    expect(eventLog.records()[0]).toMatchObject({
      type: "message.accepted.v1",
      source: "domain:Message",
      resourceRef: "msg_event_publish_1",
      correlationId: "domain-event-publisher-correlation",
      payload: {
        aggregateId: "msg_event_publish_1",
        aggregateType: "Message",
        domainEventName: "MessageAccepted",
        eventIndex: 0,
      },
    });
  });

  it("does not append duplicate platform records for the same new domain events", async () => {
    const eventLog = new FakeEventLogPort();
    const publisher = createDomainEventPublisher({
      eventLog,
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });
    const message = acceptMessage(
      createOutboundMessageIntent({
        id: createMessageId("msg_event_publish_2"),
        instanceId: createInstanceId("inst_event_publish_2"),
        type: "text",
      }),
      createGuardrailDecisionId("guardrail_event_publish_2"),
    );
    const input = {
      aggregateEvents: message.domainEvents,
      baseEventCount: 0,
      executionRef: "cmd_send_text_2",
      context: applicationContext,
    };

    await publisher.publishNewEvents(input);
    await publisher.publishNewEvents(input);

    expect(eventLog.records()).toHaveLength(1);
    expect(eventLog.appendAttempts).toBe(2);
  });

  it("does not expose raw text or JID in deterministic platform event ids", async () => {
    const eventLog = new FakeEventLogPort();
    const publisher = createDomainEventPublisher({
      eventLog,
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });
    const rawText = "secret text body";
    const rawJid = "84999999999@s.whatsapp.net";
    const event: DomainEvent = Object.freeze({
      aggregateType: "Message",
      aggregateId: "msg_event_publish_3",
      name: "MessageAccepted",
    });

    await publisher.publishNewEvents({
      aggregateEvents: [event],
      baseEventCount: 0,
      executionRef: `cmd ${rawJid} ${rawText}`,
      context: applicationContext,
    });

    const serialized = JSON.stringify(eventLog.records());
    expect(serialized).not.toContain(rawText);
    expect(serialized).not.toContain(rawJid);
  });
});

class FakeEventLogPort implements EventLogPort {
  appendAttempts = 0;
  private readonly events = new Map<string, PlatformEventRecord>();

  appendEvent(input: PlatformEventAppendInput): ApplicationPortResult<PlatformEventRecord> {
    this.appendAttempts += 1;
    const existing = this.events.get(input.id);

    if (existing !== undefined) {
      return ok(existing);
    }

    const event = createPlatformEventRecord({
      ...input,
      cursor: `eventlog:${this.events.size}`,
      version: "v1",
      payload: input.payload ?? {},
    });
    this.events.set(event.id, event);

    return ok(event);
  }

  replayEvents(request: EventLogReplayRequest): ApplicationPortResult<EventLogReplayResult> {
    const events = this.records().slice(0, request.limit);
    const cursorStatus: EventLogCursorStatus = request.cursor === undefined ? "no_cursor" : "ok";
    const oldestCursor = events[0]?.cursor;
    const latestCursor = events.at(-1)?.cursor;

    return ok({
      events,
      cursorStatus,
      ...(oldestCursor === undefined ? {} : { oldestCursor }),
      ...(latestCursor === undefined ? {} : { latestCursor }),
    });
  }

  listOutbox(_query?: EventOutboxQuery): ApplicationPortResult<readonly EventOutboxRecord[]> {
    return ok([]);
  }

  markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): ApplicationPortResult<EventOutboxPublishResult> {
    void publishedAt;

    return ok({
      eventId,
      cursor: this.events.get(eventId)?.cursor ?? "eventlog:missing",
      status: "published",
    });
  }

  records(): readonly PlatformEventRecord[] {
    return Object.freeze([...this.events.values()]);
  }
}
