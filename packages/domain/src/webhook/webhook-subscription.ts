import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { WebhookId } from "../identity/aggregate-ids.js";
import type { WebhookSubscriptionStatus } from "../status/webhook-subscription-status.js";
import type { WebhookUrl } from "./webhook-url.js";

const webhookSubscriptionTransitions: StatusTransitionMap<WebhookSubscriptionStatus> = {
  proposed: ["validated", "invalid", "retired"],
  validated: ["active", "invalid", "retired"],
  active: ["suspended", "invalid", "retired"],
  suspended: ["active", "invalid", "retired"],
  invalid: ["validated", "retired"],
  retired: [],
};

export type WebhookSubscription = Readonly<{
  id: WebhookId;
  targetUrl: WebhookUrl;
  status: WebhookSubscriptionStatus;
  domainEvents: readonly DomainEvent[];
}>;

export function createWebhookSubscription(
  id: WebhookId,
  targetUrl: WebhookUrl,
): WebhookSubscription {
  return freezeWebhookSubscription({
    id,
    targetUrl,
    status: "proposed",
    domainEvents: appendDomainEvent([], "WebhookSubscription", id, "WebhookSubscriptionProposed"),
  });
}

export function validateWebhookSubscription(
  subscription: WebhookSubscription,
): WebhookSubscription {
  return transitionWebhookSubscription(subscription, "validated", "WebhookSubscriptionValidated");
}

export function activateWebhookSubscription(
  subscription: WebhookSubscription,
): WebhookSubscription {
  if (subscription.status !== "validated" && subscription.status !== "suspended") {
    throw new TypeError("WebhookSubscription must be validated before activation.");
  }

  return transitionWebhookSubscription(subscription, "active", "WebhookSubscriptionActivated");
}

export function suspendWebhookSubscription(subscription: WebhookSubscription): WebhookSubscription {
  return transitionWebhookSubscription(subscription, "suspended", "WebhookSubscriptionSuspended");
}

export function invalidateWebhookSubscription(
  subscription: WebhookSubscription,
): WebhookSubscription {
  return transitionWebhookSubscription(subscription, "invalid", "WebhookSubscriptionInvalidated");
}

export function retireWebhookSubscription(subscription: WebhookSubscription): WebhookSubscription {
  return transitionWebhookSubscription(subscription, "retired", "WebhookSubscriptionRetired");
}

function transitionWebhookSubscription(
  subscription: WebhookSubscription,
  status: WebhookSubscriptionStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
): WebhookSubscription {
  return freezeWebhookSubscription({
    id: subscription.id,
    targetUrl: subscription.targetUrl,
    status: transitionStatus(
      subscription.status,
      status,
      webhookSubscriptionTransitions,
      "WebhookSubscription",
    ),
    domainEvents: appendDomainEvent(
      subscription.domainEvents,
      "WebhookSubscription",
      subscription.id,
      eventName,
    ),
  });
}

function freezeWebhookSubscription(subscription: WebhookSubscription): WebhookSubscription {
  return Object.freeze(subscription);
}
