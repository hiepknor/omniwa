import type { ApplicationPortContext, QueueReservation } from "@omniwa/application";
import {
  createAttemptNumber,
  createDeadLetterReason,
  createFailureCategory,
  createWebhookDeliveryId,
  deadLetterWebhookDelivery,
  retryWebhookDelivery,
  startWebhookDelivery,
  succeedWebhookDelivery,
  type WebhookDelivery,
  type WebhookDeliveryId,
  type WebhookDeliveryRepositoryPort,
} from "@omniwa/domain";

import type {
  WebhookDeliveryWorkHandler,
  WebhookDeliveryWorkResult,
} from "./webhook-dispatcher-runtime.js";

export type RepositoryWebhookDeliveryWorkHandlerOptions = Readonly<{
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  innerHandler: WebhookDeliveryWorkHandler;
  deliveryIdFromReservation?: (reservationJobId: string) => WebhookDeliveryId;
}>;

export class RepositoryWebhookDeliveryWorkHandler implements WebhookDeliveryWorkHandler {
  private readonly webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  private readonly innerHandler: WebhookDeliveryWorkHandler;
  private readonly deliveryIdFromReservation: (reservationJobId: string) => WebhookDeliveryId;

  constructor(options: RepositoryWebhookDeliveryWorkHandlerOptions) {
    this.webhookDeliveryRepository = options.webhookDeliveryRepository;
    this.innerHandler = options.innerHandler;
    this.deliveryIdFromReservation =
      options.deliveryIdFromReservation ?? ((jobId) => createWebhookDeliveryId(jobId));
  }

  async deliver(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WebhookDeliveryWorkResult> {
    const delivery = await this.webhookDeliveryRepository.load(
      this.deliveryIdFromReservation(reservation.jobId.toString()),
    );

    if (delivery === undefined) {
      return freezeWebhookDeliveryWorkResult({
        outcome: "dead_letter",
        reasonCode: "webhook_delivery_not_found",
      });
    }

    if (delivery.status === "delivered") {
      return freezeWebhookDeliveryWorkResult({
        outcome: "delivered",
        reasonCode: "webhook_delivery_already_delivered",
      });
    }

    if (isWebhookDeliveryTerminal(delivery)) {
      return freezeWebhookDeliveryWorkResult({
        outcome: "dead_letter",
        reasonCode: "webhook_delivery_terminal_state",
      });
    }

    const delivering =
      delivery.status === "delivering"
        ? delivery
        : startWebhookDelivery(
            delivery,
            createAttemptNumber(reservation.attempt, delivery.retryPolicy),
          );
    await this.webhookDeliveryRepository.save(delivering);

    const result = await this.innerHandler.deliver(reservation, context);

    return this.persistWorkResult(delivering, result);
  }

  private async persistWorkResult(
    delivering: WebhookDelivery,
    result: WebhookDeliveryWorkResult,
  ): Promise<WebhookDeliveryWorkResult> {
    switch (result.outcome) {
      case "delivered": {
        await this.webhookDeliveryRepository.save(succeedWebhookDelivery(delivering));
        return result;
      }
      case "retry": {
        return this.persistRetryOutcome(delivering, result);
      }
      case "dead_letter": {
        await this.webhookDeliveryRepository.save(
          deadLetterWebhookDelivery(
            delivering,
            createDeadLetterReason({
              code: result.reasonCode ?? result.receipt?.failureReasonCode ?? "webhook_dead_letter",
              category: "webhook",
            }),
          ),
        );
        return result;
      }
    }
  }

  private async persistRetryOutcome(
    delivering: WebhookDelivery,
    result: WebhookDeliveryWorkResult,
  ): Promise<WebhookDeliveryWorkResult> {
    const nextAttempt = delivering.attemptNumber === undefined ? 2 : delivering.attemptNumber + 1;

    if (nextAttempt > delivering.retryPolicy.maxAttempts) {
      const reasonCode =
        result.reasonCode ??
        result.receipt?.failureReasonCode ??
        "webhook_delivery_retry_budget_exhausted";
      await this.webhookDeliveryRepository.save(
        deadLetterWebhookDelivery(
          delivering,
          createDeadLetterReason({
            code: reasonCode,
            category: "webhook",
          }),
        ),
      );
      return freezeWebhookDeliveryWorkResult({
        outcome: "dead_letter",
        ...optional("receipt", result.receipt),
        reasonCode,
      });
    }

    await this.webhookDeliveryRepository.save(
      retryWebhookDelivery(
        delivering,
        createAttemptNumber(nextAttempt, delivering.retryPolicy),
        createFailureCategory("webhook"),
      ),
    );

    return result;
  }
}

function isWebhookDeliveryTerminal(delivery: WebhookDelivery): boolean {
  return (
    delivery.status === "dead_letter" ||
    delivery.status === "cancelled" ||
    delivery.status === "failed"
  );
}

function freezeWebhookDeliveryWorkResult(
  result: WebhookDeliveryWorkResult,
): WebhookDeliveryWorkResult {
  return Object.freeze(result);
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
