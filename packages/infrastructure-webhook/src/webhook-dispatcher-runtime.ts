import type {
  ApplicationPortContext,
  ApplicationPortResult,
  QueueProviderPort,
  QueueReservation,
  QueueVisibilityReceipt,
  WebhookDeliveryEnvelope,
  WebhookTransportPort,
  WebhookTransportReceipt,
} from "@omniwa/application";
import { err, ok, type Result } from "@omniwa/shared";

export type WebhookDeliveryWorkResult = Readonly<{
  outcome: "delivered" | "retry" | "dead_letter";
  receipt?: WebhookTransportReceipt;
  retryDelayMilliseconds?: number;
  reasonCode?: string;
}>;

export type WebhookDeliveryWorkHandler = Readonly<{
  deliver(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WebhookDeliveryWorkResult> | WebhookDeliveryWorkResult;
}>;

export type WebhookDeliveryEnvelopeResolver = Readonly<{
  resolve(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WebhookDeliveryEnvelope | undefined> | WebhookDeliveryEnvelope | undefined;
}>;

export type WebhookDispatcherOutcome =
  "idle" | "delivered" | "retry_scheduled" | "dead_lettered" | "queue_failure" | "handler_failure";

export type WebhookDispatcherResult = Readonly<{
  outcome: WebhookDispatcherOutcome;
  reservation?: QueueReservation;
  queueReceipt?: QueueVisibilityReceipt;
  reasonCode?: string;
}>;

export type WebhookDispatcherRuntimeOptions = Readonly<{
  queueProvider: QueueProviderPort;
  handler: WebhookDeliveryWorkHandler;
  defaultRetryDelayMilliseconds?: number;
}>;

export class WebhookDispatcherRuntime {
  private readonly queueProvider: QueueProviderPort;
  private readonly handler: WebhookDeliveryWorkHandler;
  private readonly defaultRetryDelayMilliseconds: number;

  constructor(options: WebhookDispatcherRuntimeOptions) {
    this.queueProvider = options.queueProvider;
    this.handler = options.handler;
    this.defaultRetryDelayMilliseconds = options.defaultRetryDelayMilliseconds ?? 1_000;
    assertNonNegativeInteger(this.defaultRetryDelayMilliseconds, "defaultRetryDelayMilliseconds");
  }

  async dispatchNext(context: ApplicationPortContext): Promise<WebhookDispatcherResult> {
    const reservationResult = await this.queueProvider.reserve("webhook_delivery", context);

    if (!reservationResult.ok) {
      return freezeWebhookDispatcherResult({
        outcome: "queue_failure",
        reasonCode: reservationResult.error.code,
      });
    }

    if (reservationResult.value === undefined) {
      return freezeWebhookDispatcherResult({ outcome: "idle" });
    }

    const reservation = reservationResult.value;
    const work = await this.deliverReservedWork(reservation, context);

    if (!work.ok) {
      const release = await this.queueProvider.releaseForRetry(
        reservation,
        this.defaultRetryDelayMilliseconds,
        context,
      );

      return freezeWebhookDispatcherResult({
        outcome: release.ok ? "retry_scheduled" : "handler_failure",
        reservation,
        ...optional("queueReceipt", release.ok ? release.value : undefined),
        reasonCode: release.ok ? work.error : release.error.code,
      });
    }

    return this.applyWorkResult(reservation, work.value, context);
  }

  private async deliverReservedWork(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<Result<WebhookDeliveryWorkResult, string>> {
    try {
      return ok(await this.handler.deliver(reservation, context));
    } catch {
      return err("webhook_handler_unexpected_failure");
    }
  }

  private async applyWorkResult(
    reservation: QueueReservation,
    work: WebhookDeliveryWorkResult,
    context: ApplicationPortContext,
  ): Promise<WebhookDispatcherResult> {
    switch (work.outcome) {
      case "delivered": {
        const acknowledgement = await this.queueProvider.acknowledge(reservation, context);
        return resultFromQueueOperation("delivered", reservation, acknowledgement);
      }
      case "retry": {
        const delayMilliseconds = work.retryDelayMilliseconds ?? this.defaultRetryDelayMilliseconds;
        assertNonNegativeInteger(delayMilliseconds, "retryDelayMilliseconds");
        const retry = await this.queueProvider.releaseForRetry(
          reservation,
          delayMilliseconds,
          context,
        );
        return resultFromQueueOperation(
          "retry_scheduled",
          reservation,
          retry,
          work.reasonCode ?? work.receipt?.failureReasonCode,
        );
      }
      case "dead_letter": {
        const deadLetter = await this.queueProvider.moveToDeadLetter(
          reservation,
          work.reasonCode ?? work.receipt?.failureReasonCode ?? "webhook_delivery_terminal_failure",
          context,
        );
        return resultFromQueueOperation(
          "dead_lettered",
          reservation,
          deadLetter,
          work.reasonCode ?? work.receipt?.failureReasonCode,
        );
      }
    }
  }
}

export type WebhookTransportDeliveryHandlerOptions = Readonly<{
  envelopeResolver: WebhookDeliveryEnvelopeResolver;
  transport: WebhookTransportPort;
  retryDelayMilliseconds?: number;
}>;

export class WebhookTransportDeliveryHandler implements WebhookDeliveryWorkHandler {
  private readonly envelopeResolver: WebhookDeliveryEnvelopeResolver;
  private readonly transport: WebhookTransportPort;
  private readonly retryDelayMilliseconds: number | undefined;

  constructor(options: WebhookTransportDeliveryHandlerOptions) {
    this.envelopeResolver = options.envelopeResolver;
    this.transport = options.transport;
    this.retryDelayMilliseconds = options.retryDelayMilliseconds;

    if (this.retryDelayMilliseconds !== undefined) {
      assertNonNegativeInteger(this.retryDelayMilliseconds, "retryDelayMilliseconds");
    }
  }

  async deliver(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WebhookDeliveryWorkResult> {
    const envelope = await this.envelopeResolver.resolve(reservation, context);

    if (envelope === undefined) {
      return freezeWebhookDeliveryWorkResult({
        outcome: "dead_letter",
        reasonCode: "webhook_delivery_envelope_missing",
      });
    }

    const receipt = await this.transport.deliver(envelope, context);

    if (!receipt.ok) {
      return freezeWebhookDeliveryWorkResult({
        outcome: receipt.error.retryable ? "retry" : "dead_letter",
        reasonCode: receipt.error.code,
        ...optional(
          "retryDelayMilliseconds",
          receipt.error.retryable ? this.retryDelayMilliseconds : undefined,
        ),
      });
    }

    switch (receipt.value.outcome) {
      case "delivered":
        return freezeWebhookDeliveryWorkResult({
          outcome: "delivered",
          receipt: receipt.value,
        });
      case "retryable_failure":
        return freezeWebhookDeliveryWorkResult({
          outcome: "retry",
          receipt: receipt.value,
          ...optional("retryDelayMilliseconds", this.retryDelayMilliseconds),
          ...optional("reasonCode", receipt.value.failureReasonCode),
        });
      case "terminal_failure":
        return freezeWebhookDeliveryWorkResult({
          outcome: "dead_letter",
          receipt: receipt.value,
          reasonCode: receipt.value.failureReasonCode ?? "webhook_receiver_terminal_failure",
        });
    }
  }
}

function resultFromQueueOperation(
  outcome: Exclude<WebhookDispatcherOutcome, "idle" | "queue_failure" | "handler_failure">,
  reservation: QueueReservation,
  result: ApplicationPortResult<QueueVisibilityReceipt>,
  reasonCode?: string,
): WebhookDispatcherResult {
  if (!result.ok) {
    return freezeWebhookDispatcherResult({
      outcome: "queue_failure",
      reservation,
      reasonCode: result.error.code,
    });
  }

  return freezeWebhookDispatcherResult({
    outcome,
    reservation,
    queueReceipt: result.value,
    ...optional("reasonCode", reasonCode),
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

function freezeWebhookDispatcherResult(result: WebhookDispatcherResult): WebhookDispatcherResult {
  return Object.freeze(result);
}

function freezeWebhookDeliveryWorkResult(
  result: WebhookDeliveryWorkResult,
): WebhookDeliveryWorkResult {
  return Object.freeze(result);
}
