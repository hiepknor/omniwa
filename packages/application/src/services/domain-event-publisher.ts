import { getDomainEventContract, type DomainEvent } from "@omniwa/domain";
import { ok } from "@omniwa/shared";

import type { ApplicationPortContext, ApplicationPortResult } from "../ports/application-port.js";
import type { EventLogPort, PlatformEventRecord } from "../ports/event-log.js";

export type DomainEventPublicationRecord = Readonly<{
  domainEvent: DomainEvent;
  platformEvent: PlatformEventRecord;
}>;

export type DomainEventPublicationReceipt = Readonly<{
  publishedEvents: readonly DomainEventPublicationRecord[];
}>;

export type DomainEventPublisherInput = Readonly<{
  aggregateEvents: readonly DomainEvent[];
  baseEventCount: number;
  executionRef: string;
  context: ApplicationPortContext;
}>;

export type DomainEventPublisher = Readonly<{
  publishNewEvents(
    input: DomainEventPublisherInput,
  ): Promise<ApplicationPortResult<DomainEventPublicationReceipt>>;
}>;

export type DomainEventPublisherOptions = Readonly<{
  eventLog: EventLogPort;
  nowIso: () => string;
}>;

export function createDomainEventPublisher(
  options: DomainEventPublisherOptions,
): DomainEventPublisher {
  return new DefaultDomainEventPublisher(options);
}

export class DefaultDomainEventPublisher implements DomainEventPublisher {
  private readonly eventLog: EventLogPort;
  private readonly nowIso: () => string;

  constructor(options: DomainEventPublisherOptions) {
    this.eventLog = options.eventLog;
    this.nowIso = options.nowIso;
  }

  async publishNewEvents(
    input: DomainEventPublisherInput,
  ): Promise<ApplicationPortResult<DomainEventPublicationReceipt>> {
    const startIndex = clampBaseEventCount(input.baseEventCount, input.aggregateEvents.length);
    const newEvents = input.aggregateEvents.slice(startIndex);
    const publishedEvents: DomainEventPublicationRecord[] = [];

    for (const [offset, domainEvent] of newEvents.entries()) {
      const eventIndex = startIndex + offset;
      const contract = getDomainEventContract(domainEvent.name);
      const appendResult = this.eventLog.appendEvent({
        id: createDeterministicEventId(input.executionRef, domainEvent, eventIndex),
        type: contract.integrationEventName ?? `${contract.signalName}.v1`,
        timestamp: this.nowIso(),
        dataClassification: contract.dataClassification,
        source: `domain:${domainEvent.aggregateType}`,
        resourceRef: domainEvent.aggregateId,
        correlationId: String(input.context.requestContext.correlationId),
        payload: {
          aggregateId: domainEvent.aggregateId,
          aggregateType: domainEvent.aggregateType,
          domainEventName: domainEvent.name,
          eventIndex,
        },
      });

      if (!appendResult.ok) {
        return appendResult;
      }

      publishedEvents.push(
        Object.freeze({
          domainEvent,
          platformEvent: appendResult.value,
        }),
      );
    }

    return ok(
      Object.freeze({
        publishedEvents: Object.freeze(publishedEvents),
      }),
    );
  }
}

function clampBaseEventCount(baseEventCount: number, eventCount: number): number {
  if (!Number.isSafeInteger(baseEventCount) || baseEventCount < 0) {
    return 0;
  }

  return Math.min(baseEventCount, eventCount);
}

function createDeterministicEventId(
  executionRef: string,
  domainEvent: DomainEvent,
  eventIndex: number,
): string {
  return [
    "domain_event",
    stableToken(executionRef),
    domainEvent.aggregateType,
    stableToken(domainEvent.aggregateId),
    domainEvent.name,
    String(eventIndex),
  ].join(":");
}

function stableToken(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
