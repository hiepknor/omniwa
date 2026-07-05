import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type EventOutboxPort,
  type EventOutboxRecord,
} from "@omniwa/application";
import { err, ok, systemClock, type Clock } from "@omniwa/shared";

export type EventOutboxPublisherReceipt = Readonly<{
  eventId: string;
  accepted: true;
  publishedAt?: string;
}>;

export interface EventOutboxPublisher {
  publish(
    record: EventOutboxRecord,
    context: ApplicationPortContext,
  ):
    | ApplicationPortResult<EventOutboxPublisherReceipt>
    | Promise<ApplicationPortResult<EventOutboxPublisherReceipt>>;
}

export type EventOutboxConsumerOptions = Readonly<{
  eventLog: EventOutboxPort;
  publisher: EventOutboxPublisher;
  clock?: Clock;
  batchSize?: number;
}>;

export type EventOutboxConsumerPublishedRecord = Readonly<{
  eventId: string;
  cursor: string;
  publishedAt: string;
}>;

export type EventOutboxConsumerFailedRecord = Readonly<{
  eventId: string;
  cursor: string;
  code: string;
  retryable: boolean;
}>;

export type EventOutboxConsumerRunResult = Readonly<{
  attempted: number;
  published: readonly EventOutboxConsumerPublishedRecord[];
  failed: readonly EventOutboxConsumerFailedRecord[];
}>;

const defaultBatchSize = 100;

export class EventOutboxConsumer {
  private readonly eventLog: EventOutboxPort;
  private readonly publisher: EventOutboxPublisher;
  private readonly clock: Clock;
  private readonly batchSize: number;

  constructor(options: EventOutboxConsumerOptions) {
    this.eventLog = options.eventLog;
    this.publisher = options.publisher;
    this.clock = options.clock ?? systemClock;
    this.batchSize = normalizeBatchSize(options.batchSize);
  }

  async drainPending(
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<EventOutboxConsumerRunResult>> {
    const pending = this.eventLog.listOutbox({ status: "pending" });

    if (!pending.ok) {
      return err(pending.error);
    }

    const batch = pending.value.slice(0, this.batchSize);
    const published: EventOutboxConsumerPublishedRecord[] = [];
    const failed: EventOutboxConsumerFailedRecord[] = [];

    for (const record of batch) {
      const publishResult = await this.publishRecord(record, context);

      if (!publishResult.ok) {
        failed.push(failedRecord(record, publishResult.error));
        continue;
      }

      const publishedAt = publishResult.value.publishedAt ?? this.clock.isoNow();
      const markResult = this.eventLog.markOutboxPublished(record.eventId, publishedAt);

      if (!markResult.ok) {
        failed.push(failedRecord(record, markResult.error));
        continue;
      }

      published.push(
        Object.freeze({
          eventId: markResult.value.eventId,
          cursor: markResult.value.cursor,
          publishedAt,
        }),
      );
    }

    return ok(
      Object.freeze({
        attempted: batch.length,
        published: Object.freeze(published),
        failed: Object.freeze(failed),
      }),
    );
  }

  private async publishRecord(
    record: EventOutboxRecord,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<EventOutboxPublisherReceipt>> {
    try {
      return await this.publisher.publish(record, context);
    } catch (error) {
      return err(
        createApplicationPortFailure({
          category: "unknown",
          code: "event_outbox_publish_threw",
          message: "Event outbox publisher failed unexpectedly.",
          retryable: true,
          ownerContext: "observability",
          safeMetadata:
            error instanceof Error
              ? {
                  eventId: record.eventId,
                  causeName: error.name,
                }
              : {
                  eventId: record.eventId,
                },
        }),
      );
    }
  }
}

export function createNoopEventOutboxPublisher(): EventOutboxPublisher {
  return Object.freeze({
    publish(record: EventOutboxRecord): ApplicationPortResult<EventOutboxPublisherReceipt> {
      return ok(
        Object.freeze({
          eventId: record.eventId,
          accepted: true,
        }),
      );
    },
  });
}

function failedRecord(
  record: EventOutboxRecord,
  failure: ApplicationPortFailure,
): EventOutboxConsumerFailedRecord {
  return Object.freeze({
    eventId: record.eventId,
    cursor: record.cursor,
    code: failure.code,
    retryable: failure.retryable,
  });
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return defaultBatchSize;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("EventOutboxConsumer batchSize must be a positive integer.");
  }

  return value;
}
