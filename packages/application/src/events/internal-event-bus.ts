import { getDomainEventContract, type DomainEvent } from "@omniwa/domain";
import { err } from "@omniwa/shared";

import type { ApplicationPortContext, ApplicationPortResult } from "../ports/application-port.js";
import { createApplicationPortFailure } from "../ports/application-port.js";
import type {
  ApplicationNotification,
  ApplicationNotificationName,
  EventBusPort,
} from "../ports/event-bus.js";

export type InternalEventHandler = (
  notification: ApplicationNotification,
  context: ApplicationPortContext,
) => ApplicationPortResult<void> | Promise<ApplicationPortResult<void>>;

export type InternalEventBusSubscription = Readonly<{
  notificationName: ApplicationNotificationName;
  handlerId: string;
}>;

export interface InternalEventBus extends EventBusPort {
  subscribe(
    notificationName: ApplicationNotificationName,
    handlerId: string,
    handler: InternalEventHandler,
  ): InternalEventBusSubscription;

  unsubscribe(subscription: InternalEventBusSubscription): void;

  listSubscriptions(
    notificationName?: ApplicationNotificationName,
  ): readonly InternalEventBusSubscription[];
}

export function createInternalEventHandlerFailure(
  handlerId: string,
  notificationName: ApplicationNotificationName,
): ApplicationPortResult<never> {
  return err(
    createApplicationPortFailure({
      category: "rejected",
      code: "internal_event_handler_failed",
      message: "Internal event handler rejected the notification.",
      retryable: true,
      ownerContext: "operations",
      safeMetadata: {
        handlerId,
        notificationName,
      },
    }),
  );
}

export function createProductFactNotification(event: DomainEvent): ApplicationNotification {
  const contract = getDomainEventContract(event.name);
  const sourceSignalRef = `${event.aggregateType}:${event.aggregateId}:${event.name}`;

  return Object.freeze({
    name: "product_fact_published",
    sourceSignalRef,
    dataClassification: contract.dataClassification,
    sourceDomainEvent: event,
    ...(contract.integrationEventName === undefined
      ? {}
      : { integrationEventName: contract.integrationEventName }),
    targetContextRef: event.aggregateType,
  });
}
