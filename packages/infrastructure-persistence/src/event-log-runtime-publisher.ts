import { createHash } from "node:crypto";

import {
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type EventLogAppendPort,
  type PlatformEventPayload,
  type PlatformEventRecord,
  type TranslatedProviderSignal,
} from "@omniwa/application";
import { systemClock, type Clock } from "@omniwa/shared";

export type EventLogProviderSignal = TranslatedProviderSignal &
  Readonly<{
    operation?: string;
    runtimeState?: string;
  }>;

export type EventLogProviderSignalPublisherOptions = Readonly<{
  eventLog: EventLogAppendPort;
  clock?: Clock;
}>;

export type EventLogProviderSignalSinkOptions = EventLogProviderSignalPublisherOptions &
  Readonly<{
    contextFactory: () => ApplicationPortContext;
  }>;

export class EventLogProviderSignalPublisher {
  private readonly eventLog: EventLogAppendPort;
  private readonly clock: Clock;

  constructor(options: EventLogProviderSignalPublisherOptions) {
    this.eventLog = options.eventLog;
    this.clock = options.clock ?? systemClock;
  }

  publishSignal(
    signal: EventLogProviderSignal,
    context: ApplicationPortContext,
  ): ApplicationPortResult<PlatformEventRecord> {
    return this.eventLog.appendEvent({
      id: stableProviderSignalEventId(signal),
      type: providerSignalEventType(signal),
      timestamp: this.clock.isoNow(),
      dataClassification: signal.dataClassification,
      source: "provider_runtime",
      resourceRef: signal.targetRef,
      correlationId: context.requestContext.correlationId,
      payload: providerSignalPayload(signal),
    });
  }
}

export class EventLogProviderSignalSink {
  private readonly publisher: EventLogProviderSignalPublisher;
  private readonly contextFactory: () => ApplicationPortContext;
  private readonly failures: ApplicationPortFailure[] = [];

  constructor(options: EventLogProviderSignalSinkOptions) {
    this.publisher = new EventLogProviderSignalPublisher(options);
    this.contextFactory = options.contextFactory;
  }

  recordSignal(signal: EventLogProviderSignal): void {
    const result = this.publisher.publishSignal(signal, this.contextFactory());

    if (!result.ok) {
      this.failures.push(result.error);
    }
  }

  snapshotFailures(): readonly ApplicationPortFailure[] {
    return Object.freeze([...this.failures]);
  }
}

function stableProviderSignalEventId(signal: EventLogProviderSignal): string {
  const hash = createHash("sha256")
    .update(signal.signalRef)
    .update("|")
    .update(signal.occurrenceRef)
    .update("|")
    .update(signal.kind)
    .update("|")
    .update(signal.operation ?? "")
    .update("|")
    .update(signal.runtimeState ?? "")
    .digest("hex")
    .slice(0, 24);

  return `evt:provider:${hash}`;
}

function providerSignalEventType(signal: EventLogProviderSignal): string {
  switch (signal.kind) {
    case "connection":
      return "provider.connection.v1";
    case "auth":
      return "provider.auth.v1";
    case "message_status":
      return "provider.message_status.v1";
    case "inbound_message":
      return "provider.inbound_message.v1";
    case "failure":
      return "provider.failure.v1";
  }
}

function providerSignalPayload(signal: EventLogProviderSignal): PlatformEventPayload {
  return Object.freeze({
    providerId: String(signal.providerId),
    signalKind: signal.kind,
    targetRef: signal.targetRef,
    occurrenceRef: signal.occurrenceRef,
    ...optional("operation", signal.operation),
    ...optional("runtimeState", signal.runtimeState),
    ...optional("failureCategory", signal.failureCategory?.toString()),
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
