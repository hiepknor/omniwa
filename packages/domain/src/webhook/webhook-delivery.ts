import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { FailureCategory } from "../errors/failure-category.js";
import type { WebhookDeliveryId, WebhookId } from "../identity/aggregate-ids.js";
import type { AttemptNumber } from "../policies/attempt-number.js";
import type { DeadLetterReason } from "../policies/dead-letter-reason.js";
import type { RetryPolicy } from "../policies/retry-policy.js";
import type { WebhookDeliveryStatus } from "../status/webhook-delivery-status.js";

const webhookDeliveryTransitions: StatusTransitionMap<WebhookDeliveryStatus> = {
  pending: ["delivering", "failed", "dead_letter", "cancelled"],
  delivering: ["delivered", "retrying", "failed", "dead_letter"],
  delivered: [],
  retrying: ["delivering", "failed", "dead_letter", "cancelled"],
  failed: [],
  dead_letter: [],
  cancelled: [],
};

export type WebhookDelivery = Readonly<{
  id: WebhookDeliveryId;
  webhookId: WebhookId;
  sourceSignalRef: string;
  status: WebhookDeliveryStatus;
  retryPolicy: RetryPolicy;
  attemptNumber?: AttemptNumber;
  failureCategory?: FailureCategory;
  deadLetterReason?: DeadLetterReason;
  domainEvents: readonly DomainEvent[];
}>;

export function scheduleWebhookDelivery(
  id: WebhookDeliveryId,
  webhookId: WebhookId,
  sourceSignalRef: string,
  retryPolicy: RetryPolicy,
): WebhookDelivery {
  return freezeWebhookDelivery({
    id,
    webhookId,
    sourceSignalRef: createSafeDomainCode(sourceSignalRef, "WebhookDelivery.sourceSignalRef"),
    status: "pending",
    retryPolicy,
    domainEvents: appendDomainEvent([], "WebhookDelivery", id, "WebhookDeliveryScheduled"),
  });
}

export function startWebhookDelivery(
  delivery: WebhookDelivery,
  attemptNumber: AttemptNumber,
): WebhookDelivery {
  return transitionWebhookDelivery(delivery, "delivering", "WebhookDeliveryStarted", {
    attemptNumber,
  });
}

export function succeedWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return transitionWebhookDelivery(delivery, "delivered", "WebhookDeliverySucceeded");
}

export function retryWebhookDelivery(
  delivery: WebhookDelivery,
  attemptNumber: AttemptNumber,
  failureCategory: FailureCategory,
): WebhookDelivery {
  assertAttemptWithinRetryBudget(attemptNumber, delivery.retryPolicy);
  return transitionWebhookDelivery(delivery, "retrying", "WebhookDeliveryRetryScheduled", {
    attemptNumber,
    failureCategory,
  });
}

export function failWebhookDelivery(
  delivery: WebhookDelivery,
  failureCategory: FailureCategory,
): WebhookDelivery {
  return transitionWebhookDelivery(delivery, "failed", "WebhookDeliveryFailed", {
    failureCategory,
  });
}

export function deadLetterWebhookDelivery(
  delivery: WebhookDelivery,
  deadLetterReason: DeadLetterReason,
): WebhookDelivery {
  return transitionWebhookDelivery(delivery, "dead_letter", "WebhookDeliveryDeadLettered", {
    deadLetterReason,
    failureCategory: deadLetterReason.category,
  });
}

export function cancelWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return transitionWebhookDelivery(delivery, "cancelled", "WebhookDeliveryCancelled");
}

function transitionWebhookDelivery(
  delivery: WebhookDelivery,
  status: WebhookDeliveryStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    attemptNumber?: AttemptNumber;
    failureCategory?: FailureCategory;
    deadLetterReason?: DeadLetterReason;
  }> = {},
): WebhookDelivery {
  return freezeWebhookDelivery({
    id: delivery.id,
    webhookId: delivery.webhookId,
    sourceSignalRef: delivery.sourceSignalRef,
    status: transitionStatus(
      delivery.status,
      status,
      webhookDeliveryTransitions,
      "WebhookDelivery",
    ),
    retryPolicy: delivery.retryPolicy,
    ...optionalValue("attemptNumber", patch.attemptNumber, delivery.attemptNumber),
    ...optionalValue("failureCategory", patch.failureCategory, delivery.failureCategory),
    ...optionalValue("deadLetterReason", patch.deadLetterReason, delivery.deadLetterReason),
    domainEvents: appendDomainEvent(
      delivery.domainEvents,
      "WebhookDelivery",
      delivery.id,
      eventName,
    ),
  });
}

function assertAttemptWithinRetryBudget(
  attemptNumber: AttemptNumber,
  retryPolicy: RetryPolicy,
): void {
  if (attemptNumber > retryPolicy.maxAttempts) {
    throw new TypeError("WebhookDelivery retry attempt exceeds retry policy.");
  }
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  nextValue: TValue | undefined,
  currentValue: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  const value = nextValue ?? currentValue;
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return Object.freeze(delivery);
}
