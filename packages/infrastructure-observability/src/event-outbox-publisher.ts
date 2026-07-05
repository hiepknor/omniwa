import type {
  ApplicationPortContext,
  ApplicationPortResult,
  EventOutboxRecord,
} from "@omniwa/application";
import { ok, systemClock, type Clock } from "@omniwa/shared";

import type { StructuredLogLineSink } from "./structured-log-backend.js";

export type EventOutboxPublisherReceipt = Readonly<{
  eventId: string;
  accepted: true;
  publishedAt?: string;
}>;

export type JsonLineEventOutboxPublisherOptions = Readonly<{
  sink: StructuredLogLineSink;
  clock?: Pick<Clock, "isoNow">;
}>;

export class JsonLineEventOutboxPublisher {
  private readonly sink: StructuredLogLineSink;
  private readonly clock: Pick<Clock, "isoNow">;

  constructor(options: JsonLineEventOutboxPublisherOptions) {
    this.sink = options.sink;
    this.clock = options.clock ?? systemClock;
  }

  publish(
    record: EventOutboxRecord,
    context: ApplicationPortContext,
  ): ApplicationPortResult<EventOutboxPublisherReceipt> {
    const publishedAt = this.clock.isoNow();

    this.sink.writeLine(
      `${JSON.stringify(toPublicEventOutboxPublicationRecord(record, context, publishedAt))}\n`,
    );

    return ok(
      Object.freeze({
        eventId: record.eventId,
        accepted: true,
        publishedAt,
      }),
    );
  }
}

export function toPublicEventOutboxPublicationRecord(
  record: EventOutboxRecord,
  context: ApplicationPortContext,
  publishedAt: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    kind: "event_outbox_publication",
    eventId: record.eventId,
    outboxId: record.outboxId,
    cursor: record.cursor,
    status: "published",
    createdAt: record.createdAt,
    publishedAt,
    actorRef: context.actorRef,
    correlationId: context.requestContext.correlationId,
    requestId: context.requestContext.requestId,
  });
}
