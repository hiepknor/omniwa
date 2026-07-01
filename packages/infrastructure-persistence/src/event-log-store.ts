import { createHash } from "node:crypto";

import {
  createApplicationPortFailure,
  createPlatformEventRecord,
  createProductFactNotification,
  type ApplicationNotification,
  type ApplicationNotificationName,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type EventLogAppendPort,
  type EventLogPort,
  type EventLogReplayRequest,
  type EventLogReplayResult,
  type EventOutboxPublishResult,
  type EventOutboxQuery,
  type EventOutboxRecord,
  type InternalEventBus,
  type InternalEventBusSubscription,
  type InternalEventHandler,
  type PlatformEventAppendInput,
  type PlatformEventRecord,
  type PublicationReceipt,
} from "@omniwa/application";
import type { DomainEvent } from "@omniwa/domain";
import { err, ok, systemClock, type Clock } from "@omniwa/shared";

import { DurableJsonStateStore } from "./durable-json-state-store.js";

export type EventLogStoreOptions = Readonly<{
  retentionLimit?: number;
}>;

export type DurableJsonEventLogStoreOptions = EventLogStoreOptions;

type EventLogStoreState = Readonly<{
  nextSequence: number;
  events: readonly PlatformEventRecord[];
  outbox: readonly EventOutboxRecord[];
}>;

type RegisteredHandler = Readonly<{
  subscription: InternalEventBusSubscription;
  handler: InternalEventHandler;
}>;

const defaultRetentionLimit = 1_000;
const cursorPrefix = "eventlog:";

export class InMemoryEventLogStore implements EventLogPort {
  protected state: EventLogStoreState;
  private readonly retentionLimit: number;

  constructor(options: EventLogStoreOptions = {}) {
    this.retentionLimit = normalizeRetentionLimit(options.retentionLimit);
    this.state = emptyState();
  }

  appendEvent(input: PlatformEventAppendInput): ApplicationPortResult<PlatformEventRecord> {
    try {
      const existing = this.state.events.find((event) => event.id === input.id);

      if (existing !== undefined) {
        return ok(existing);
      }

      if (this.state.outbox.some((record) => record.eventId === input.id)) {
        return err(
          eventLogFailure("conflict", "event_log_event_already_recorded", undefined, {
            eventId: input.id,
          }),
        );
      }

      const sequence = this.state.nextSequence;
      const cursor = cursorFromSequence(sequence);
      const event = createPlatformEventRecord({
        ...input,
        cursor,
        version: "v1",
        payload: input.payload ?? {},
      });
      const outboxRecord: EventOutboxRecord = Object.freeze({
        outboxId: `outbox:${event.id}`,
        eventId: event.id,
        cursor: event.cursor,
        status: "pending",
        createdAt: event.timestamp,
      });
      const retainedEvents = retainEvents([...this.state.events, event], this.retentionLimit);

      this.state = Object.freeze({
        nextSequence: sequence + 1,
        events: Object.freeze(retainedEvents),
        outbox: Object.freeze([...this.state.outbox, outboxRecord]),
      });
      this.persist();

      return ok(event);
    } catch (error) {
      return err(eventLogFailure("unsafe_payload", "event_log_append_rejected", error));
    }
  }

  replayEvents(request: EventLogReplayRequest): ApplicationPortResult<EventLogReplayResult> {
    try {
      const limit = normalizeReplayLimit(request.limit);
      const events = [...this.state.events];
      const oldestCursor = events[0]?.cursor;
      const latestCursor = events.at(-1)?.cursor;

      if (request.cursor === undefined) {
        return ok(
          freezeReplayResult({
            events: events.slice(0, limit),
            cursorStatus: "no_cursor",
            ...optional("oldestCursor", oldestCursor),
            ...optional("latestCursor", latestCursor),
          }),
        );
      }

      const cursorIndex = events.findIndex((event) => event.cursor === request.cursor);

      if (cursorIndex >= 0) {
        return ok(
          freezeReplayResult({
            events: events.slice(cursorIndex + 1, cursorIndex + 1 + limit),
            cursorStatus: "ok",
            ...optional("oldestCursor", oldestCursor),
            ...optional("latestCursor", latestCursor),
          }),
        );
      }

      return ok(
        freezeReplayResult({
          events: [],
          cursorStatus: isExpiredCursor(request.cursor, oldestCursor) ? "expired" : "not_found",
          ...optional("oldestCursor", oldestCursor),
          ...optional("latestCursor", latestCursor),
        }),
      );
    } catch (error) {
      return err(eventLogFailure("rejected", "event_log_replay_rejected", error));
    }
  }

  listOutbox(query: EventOutboxQuery = {}): ApplicationPortResult<readonly EventOutboxRecord[]> {
    const records =
      query.status === undefined
        ? this.state.outbox
        : this.state.outbox.filter((record) => record.status === query.status);

    return ok(Object.freeze([...records]));
  }

  markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): ApplicationPortResult<EventOutboxPublishResult> {
    const index = this.state.outbox.findIndex((record) => record.eventId === eventId);

    if (index < 0) {
      return err(
        eventLogFailure("rejected", "event_outbox_record_not_found", undefined, {
          eventId,
        }),
      );
    }

    const current = this.state.outbox[index];

    if (current === undefined) {
      return err(eventLogFailure("unknown", "event_outbox_record_missing"));
    }

    const publishedRecord = freezeOutboxRecord({
      ...current,
      status: "published",
      publishedAt,
    });
    const outbox = [...this.state.outbox];
    outbox[index] = publishedRecord;
    this.state = Object.freeze({
      ...this.state,
      outbox: Object.freeze(outbox),
    });
    this.persist();

    return ok({
      eventId: publishedRecord.eventId,
      cursor: publishedRecord.cursor,
      status: "published",
    });
  }

  snapshot(): EventLogStoreState {
    return freezeState(this.state);
  }

  protected persist(): void {
    // In-memory store has no external durability boundary.
  }
}

export class DurableJsonEventLogStore extends InMemoryEventLogStore {
  private readonly store: DurableJsonStateStore<EventLogStoreState>;

  constructor(filePath: string, options: DurableJsonEventLogStoreOptions = {}) {
    const store = new DurableJsonStateStore(filePath, emptyState);
    super(options);
    this.store = store;
    this.state = freezeState(store.read());
  }

  protected override persist(): void {
    this.store.write(this.state);
  }
}

export type EventLogInternalEventBusOptions = Readonly<{
  eventLog: EventLogAppendPort;
  clock?: Clock;
}>;

export class EventLogInternalEventBus implements InternalEventBus {
  private readonly eventLog: EventLogAppendPort;
  private readonly clock: Clock;
  private readonly handlers = new Map<ApplicationNotificationName, RegisteredHandler[]>();

  constructor(options: EventLogInternalEventBusOptions) {
    this.eventLog = options.eventLog;
    this.clock = options.clock ?? systemClock;
  }

  subscribe(
    notificationName: ApplicationNotificationName,
    handlerId: string,
    handler: InternalEventHandler,
  ): InternalEventBusSubscription {
    const normalizedHandlerId = handlerId.trim();

    if (normalizedHandlerId.length === 0) {
      throw new TypeError("Internal event handler id must not be empty.");
    }

    const registeredHandlers = this.handlers.get(notificationName) ?? [];

    if (
      registeredHandlers.some(
        (registered) => registered.subscription.handlerId === normalizedHandlerId,
      )
    ) {
      throw new TypeError(
        `Internal event handler '${normalizedHandlerId}' is already subscribed to '${notificationName}'.`,
      );
    }

    const subscription = Object.freeze({
      notificationName,
      handlerId: normalizedHandlerId,
    });

    this.handlers.set(notificationName, [...registeredHandlers, { subscription, handler }]);

    return subscription;
  }

  unsubscribe(subscription: InternalEventBusSubscription): void {
    const registeredHandlers = this.handlers.get(subscription.notificationName) ?? [];
    const remainingHandlers = registeredHandlers.filter(
      (registered) => registered.subscription.handlerId !== subscription.handlerId,
    );

    if (remainingHandlers.length === 0) {
      this.handlers.delete(subscription.notificationName);
      return;
    }

    this.handlers.set(subscription.notificationName, remainingHandlers);
  }

  listSubscriptions(
    notificationName?: ApplicationNotificationName,
  ): readonly InternalEventBusSubscription[] {
    if (notificationName !== undefined) {
      return Object.freeze(
        (this.handlers.get(notificationName) ?? []).map((registered) => registered.subscription),
      );
    }

    return Object.freeze(
      [...this.handlers.values()].flatMap((registeredHandlers) =>
        registeredHandlers.map((registered) => registered.subscription),
      ),
    );
  }

  async publishDomainFacts(
    events: readonly DomainEvent[],
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<PublicationReceipt>> {
    let lastReceipt: PublicationReceipt | undefined;

    for (const event of events) {
      const notificationResult = await this.publishNotification(
        createProductFactNotification(event),
        context,
      );

      if (!notificationResult.ok) {
        return err(notificationResult.error);
      }

      lastReceipt = notificationResult.value;
    }

    return ok({
      publicationRef: lastReceipt?.publicationRef ?? "eventlog:empty",
      accepted: true,
    });
  }

  async publishNotification(
    notification: ApplicationNotification,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<PublicationReceipt>> {
    const appendResult = this.eventLog.appendEvent(
      eventAppendInputFromNotification(notification, context, this.clock),
    );

    if (!appendResult.ok) {
      return err(appendResult.error);
    }

    const registeredHandlers = [...(this.handlers.get(notification.name) ?? [])];

    for (const registered of registeredHandlers) {
      const handlerResult = await registered.handler(notification, context);

      if (!handlerResult.ok) {
        return err(handlerResult.error);
      }
    }

    return ok({
      publicationRef: appendResult.value.cursor,
      accepted: true,
    });
  }
}

export function createInMemoryEventLogStore(
  options: EventLogStoreOptions = {},
): InMemoryEventLogStore {
  return new InMemoryEventLogStore(options);
}

export function createDurableJsonEventLogStore(
  filePath: string,
  options: DurableJsonEventLogStoreOptions = {},
): DurableJsonEventLogStore {
  return new DurableJsonEventLogStore(filePath, options);
}

function eventAppendInputFromNotification(
  notification: ApplicationNotification,
  context: ApplicationPortContext,
  clock: Clock,
): PlatformEventAppendInput {
  const type = notification.integrationEventName ?? `${notification.name}.v1`;
  const aggregateType = notification.sourceDomainEvent?.aggregateType;
  const aggregateId = notification.sourceDomainEvent?.aggregateId;

  return Object.freeze({
    id: stableEventId(notification),
    type,
    timestamp: new Date(clock.epochMilliseconds()).toISOString(),
    dataClassification: notification.dataClassification,
    source: notification.targetContextRef ?? aggregateType ?? notification.name,
    resourceRef: notification.sourceSignalRef,
    correlationId: context.requestContext.correlationId,
    payload: Object.freeze({
      notificationName: notification.name,
      sourceSignalRef: notification.sourceSignalRef,
      ...(notification.integrationEventName === undefined
        ? {}
        : { integrationEventName: notification.integrationEventName }),
      ...(aggregateType === undefined ? {} : { aggregateType }),
      ...(aggregateId === undefined ? {} : { aggregateId }),
      ...(notification.targetContextRef === undefined
        ? {}
        : { targetContextRef: notification.targetContextRef }),
    }),
  });
}

function stableEventId(notification: ApplicationNotification): string {
  const hash = createHash("sha256")
    .update(notification.name)
    .update("|")
    .update(notification.sourceSignalRef)
    .update("|")
    .update(notification.integrationEventName ?? "")
    .digest("hex")
    .slice(0, 24);

  return `evt:${hash}`;
}

function emptyState(): EventLogStoreState {
  return Object.freeze({
    nextSequence: 1,
    events: Object.freeze([]),
    outbox: Object.freeze([]),
  });
}

function freezeState(state: EventLogStoreState): EventLogStoreState {
  return Object.freeze({
    nextSequence: state.nextSequence,
    events: Object.freeze([...state.events]),
    outbox: Object.freeze(state.outbox.map(freezeOutboxRecord)),
  });
}

function freezeOutboxRecord(record: EventOutboxRecord): EventOutboxRecord {
  return Object.freeze({
    outboxId: record.outboxId,
    eventId: record.eventId,
    cursor: record.cursor,
    status: record.status,
    createdAt: record.createdAt,
    ...optional("publishedAt", record.publishedAt),
  });
}

function retainEvents(
  events: readonly PlatformEventRecord[],
  retentionLimit: number,
): readonly PlatformEventRecord[] {
  return Object.freeze(events.slice(Math.max(0, events.length - retentionLimit)));
}

function normalizeRetentionLimit(value: number | undefined): number {
  if (value === undefined) {
    return defaultRetentionLimit;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("Event log retentionLimit must be a positive integer.");
  }

  return value;
}

function normalizeReplayLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("Event log replay limit must be a positive integer.");
  }

  return value;
}

function cursorFromSequence(sequence: number): string {
  return `${cursorPrefix}${sequence}`;
}

function sequenceFromCursor(cursor: string): number | undefined {
  if (!cursor.startsWith(cursorPrefix)) {
    return undefined;
  }

  const sequence = Number.parseInt(cursor.slice(cursorPrefix.length), 10);

  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
}

function isExpiredCursor(cursor: string, oldestCursor: string | undefined): boolean {
  const cursorSequence = sequenceFromCursor(cursor);
  const oldestSequence = oldestCursor === undefined ? undefined : sequenceFromCursor(oldestCursor);

  return (
    cursorSequence !== undefined && oldestSequence !== undefined && cursorSequence < oldestSequence
  );
}

function freezeReplayResult(result: EventLogReplayResult): EventLogReplayResult {
  return Object.freeze({
    events: Object.freeze([...result.events]),
    cursorStatus: result.cursorStatus,
    ...optional("oldestCursor", result.oldestCursor),
    ...optional("latestCursor", result.latestCursor),
  });
}

function eventLogFailure(
  category: ApplicationPortFailure["category"],
  code: string,
  cause?: unknown,
  safeMetadata: ApplicationPortFailure["safeMetadata"] = {},
): ApplicationPortFailure {
  const causeMetadata =
    cause instanceof Error
      ? {
          causeName: cause.name,
        }
      : {};

  return createApplicationPortFailure({
    category,
    code,
    message: "EventLog operation failed.",
    retryable: category === "unavailable" || category === "timeout",
    ownerContext: "observability",
    failureCategory: "unexpected",
    safeMetadata: {
      ...safeMetadata,
      ...causeMetadata,
    },
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
