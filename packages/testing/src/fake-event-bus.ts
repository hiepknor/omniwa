import {
  createProductFactNotification,
  type ApplicationNotification,
  type ApplicationNotificationName,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type InternalEventBus,
  type InternalEventBusSubscription,
  type InternalEventHandler,
  type PublicationReceipt,
} from "@omniwa/application";
import type { DomainEvent } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

type RegisteredHandler = Readonly<{
  subscription: InternalEventBusSubscription;
  handler: InternalEventHandler;
}>;

export type CapturedDomainFactPublication = Readonly<{
  publicationRef: string;
  events: readonly DomainEvent[];
  context: ApplicationPortContext;
}>;

export type CapturedNotificationPublication = Readonly<{
  publicationRef: string;
  notification: ApplicationNotification;
  context: ApplicationPortContext;
}>;

export class FakeInternalEventBus implements InternalEventBus {
  readonly domainFactPublications: CapturedDomainFactPublication[] = [];
  readonly notificationPublications: CapturedNotificationPublication[] = [];

  private readonly handlers = new Map<ApplicationNotificationName, RegisteredHandler[]>();
  private sequence = 0;

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
    const publicationRef = this.nextPublicationRef("domain-facts");
    this.domainFactPublications.push(
      Object.freeze({
        publicationRef,
        events: Object.freeze([...events]),
        context,
      }),
    );

    for (const event of events) {
      const notificationResult = await this.publishNotification(
        createProductFactNotification(event),
        context,
      );

      if (!notificationResult.ok) {
        return err(notificationResult.error);
      }
    }

    return ok({ publicationRef, accepted: true });
  }

  async publishNotification(
    notification: ApplicationNotification,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<PublicationReceipt>> {
    const publicationRef = this.nextPublicationRef(notification.name);
    this.notificationPublications.push(
      Object.freeze({
        publicationRef,
        notification,
        context,
      }),
    );

    const registeredHandlers = [...(this.handlers.get(notification.name) ?? [])];

    for (const registered of registeredHandlers) {
      const handlerResult = await registered.handler(notification, context);

      if (!handlerResult.ok) {
        return err(handlerResult.error);
      }
    }

    return ok({ publicationRef, accepted: true });
  }

  private nextPublicationRef(scope: string): string {
    this.sequence += 1;
    return `${scope}:${this.sequence}`;
  }
}

export function createFakeInternalEventBus(): FakeInternalEventBus {
  return new FakeInternalEventBus();
}
