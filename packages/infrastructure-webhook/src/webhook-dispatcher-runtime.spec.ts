import type {
  ApplicationPortContext,
  ApplicationPortFailure,
  ApplicationPortResult,
  QueueProviderPort,
  QueueReservation,
  QueueVisibilityReceipt,
  WebhookDeliveryEnvelope,
  WebhookTransportPort,
  WebhookTransportReceipt,
} from "@omniwa/application";
import { createApplicationPortFailure } from "@omniwa/application";
import {
  createFailureCategory,
  createJobId,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookUrl,
  type JobId,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  WebhookDispatcherRuntime,
  WebhookTransportDeliveryHandler,
  type WebhookDeliveryEnvelopeResolver,
  type WebhookDeliveryWorkHandler,
} from "./webhook-dispatcher-runtime.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("webhook-dispatcher-correlation"),
    requestId: createRequestId("webhook-dispatcher-request"),
  }),
  actorRef: "webhook.dispatcher",
  idempotencyKey: "webhook-dispatcher-run",
  dataClassification: "internal",
};

describe("WebhookDispatcherRuntime", () => {
  it("returns idle when no webhook delivery work is visible", async () => {
    const queue = new FakeQueueProvider();
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      handler: new StaticWebhookWorkHandler({ outcome: "delivered" }),
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toEqual({
      outcome: "idle",
    });
  });

  it("acknowledges delivered webhook work", async () => {
    const queue = new FakeQueueProvider([reservation("webhook-dispatch-job-1")]);
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      handler: new StaticWebhookWorkHandler({ outcome: "delivered" }),
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toMatchObject({
      outcome: "delivered",
      queueReceipt: {
        visible: false,
        queueRef: "webhook_delivery:webhook-dispatch-job-1",
      },
    });
    expect(queue.acknowledged).toHaveLength(1);
    expect(queue.retried).toHaveLength(0);
    expect(queue.deadLettered).toHaveLength(0);
  });

  it("releases retryable webhook work with bounded visibility delay", async () => {
    const queue = new FakeQueueProvider([reservation("webhook-dispatch-job-2")]);
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      handler: new StaticWebhookWorkHandler({
        outcome: "retry",
        retryDelayMilliseconds: 250,
        reasonCode: "receiver_retryable_failure",
      }),
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toMatchObject({
      outcome: "retry_scheduled",
      reasonCode: "receiver_retryable_failure",
    });
    expect(queue.retried).toEqual([
      {
        reservationRef: "webhook_delivery:webhook-dispatch-job-2:attempt:1",
        delayMilliseconds: 250,
      },
    ]);
  });

  it("moves terminal webhook work to dead letter", async () => {
    const queue = new FakeQueueProvider([reservation("webhook-dispatch-job-3")]);
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      handler: new StaticWebhookWorkHandler({
        outcome: "dead_letter",
        reasonCode: "receiver_terminal_failure",
      }),
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toMatchObject({
      outcome: "dead_lettered",
      reasonCode: "receiver_terminal_failure",
    });
    expect(queue.deadLettered).toEqual([
      {
        reservationRef: "webhook_delivery:webhook-dispatch-job-3:attempt:1",
        reasonCode: "receiver_terminal_failure",
      },
    ]);
  });

  it("keeps accepted work visible when handler throws unexpectedly", async () => {
    const queue = new FakeQueueProvider([reservation("webhook-dispatch-job-4")]);
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      defaultRetryDelayMilliseconds: 1000,
      handler: {
        deliver: () => {
          throw new Error("raw webhook receiver body secret");
        },
      },
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toMatchObject({
      outcome: "retry_scheduled",
      reasonCode: "webhook_handler_unexpected_failure",
    });
    expect(queue.retried).toEqual([
      {
        reservationRef: "webhook_delivery:webhook-dispatch-job-4:attempt:1",
        delayMilliseconds: 1000,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns queue failure without invoking handler when reservation fails", async () => {
    const queue = new FakeQueueProvider([], queueFailure("queue_reserve_failed"));
    const handler = new StaticWebhookWorkHandler({ outcome: "delivered" });
    const runtime = new WebhookDispatcherRuntime({
      queueProvider: queue,
      handler,
    });

    const result = await runtime.dispatchNext(context);

    expect(result).toEqual({
      outcome: "queue_failure",
      reasonCode: "queue_reserve_failed",
    });
    expect(handler.calls).toBe(0);
  });
});

describe("WebhookTransportDeliveryHandler", () => {
  it("maps delivered, retryable, and terminal transport receipts into dispatch outcomes", async () => {
    const delivered = await createHandler("delivered").deliver(
      reservation("webhook-handler-job-1"),
      context,
    );
    const retry = await createHandler("retryable_failure", "receiver_retryable_failure").deliver(
      reservation("webhook-handler-job-2"),
      context,
    );
    const terminal = await createHandler("terminal_failure", "receiver_terminal_failure").deliver(
      reservation("webhook-handler-job-3"),
      context,
    );

    expect(delivered).toMatchObject({ outcome: "delivered" });
    expect(retry).toMatchObject({
      outcome: "retry",
      retryDelayMilliseconds: 500,
      reasonCode: "receiver_retryable_failure",
    });
    expect(terminal).toMatchObject({
      outcome: "dead_letter",
      reasonCode: "receiver_terminal_failure",
    });
  });

  it("dead-letters work when the application envelope cannot be resolved", async () => {
    const handler = new WebhookTransportDeliveryHandler({
      envelopeResolver: {
        resolve: () => undefined,
      },
      transport: new FakeWebhookTransport("delivered"),
    });

    const result = await handler.deliver(reservation("webhook-handler-job-4"), context);

    expect(result).toEqual({
      outcome: "dead_letter",
      reasonCode: "webhook_delivery_envelope_missing",
    });
  });

  it("maps retryable port failures to retry without leaking raw transport detail", async () => {
    const handler = new WebhookTransportDeliveryHandler({
      envelopeResolver: new StaticEnvelopeResolver(),
      retryDelayMilliseconds: 500,
      transport: new FailingWebhookTransport(
        createApplicationPortFailure({
          category: "unavailable",
          code: "webhook_transport_failure",
          message: "Webhook transport failed with a sanitized transport error.",
          retryable: true,
          ownerContext: "webhook_delivery",
          failureCategory: createFailureCategory("network"),
        }),
      ),
    });

    const result = await handler.deliver(reservation("webhook-handler-job-5"), context);

    expect(result).toEqual({
      outcome: "retry",
      reasonCode: "webhook_transport_failure",
      retryDelayMilliseconds: 500,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

function createHandler(
  outcome: WebhookTransportReceipt["outcome"],
  failureReasonCode?: string,
): WebhookTransportDeliveryHandler {
  return new WebhookTransportDeliveryHandler({
    envelopeResolver: new StaticEnvelopeResolver(),
    retryDelayMilliseconds: 500,
    transport: new FakeWebhookTransport(outcome, failureReasonCode),
  });
}

function reservation(jobId: string): QueueReservation {
  return {
    jobId: createJobId(jobId),
    reservationRef: `webhook_delivery:${jobId}:attempt:1`,
    attempt: 1,
  };
}

function queueFailure(code: string): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: "unavailable",
    code,
    message: "Queue operation failed.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: createFailureCategory("queue"),
  });
}

class StaticWebhookWorkHandler implements WebhookDeliveryWorkHandler {
  calls = 0;

  constructor(
    private readonly result: Awaited<ReturnType<WebhookDeliveryWorkHandler["deliver"]>>,
  ) {}

  deliver(): Awaited<ReturnType<WebhookDeliveryWorkHandler["deliver"]>> {
    this.calls += 1;
    return this.result;
  }
}

class StaticEnvelopeResolver implements WebhookDeliveryEnvelopeResolver {
  resolve(): WebhookDeliveryEnvelope {
    return {
      webhookId: createWebhookId("webhook_handler_1"),
      deliveryId: createWebhookDeliveryId("webhook_delivery_handler_1"),
      targetUrl: createWebhookUrl("https://receiver.example.test/webhooks"),
      sourceSignalRef: "source.signal.handler",
      payloadRef: "payload.ref.handler",
      eventVersion: "v1",
      dataClassification: "internal",
    };
  }
}

class FakeWebhookTransport implements WebhookTransportPort {
  constructor(
    private readonly outcome: WebhookTransportReceipt["outcome"],
    private readonly failureReasonCode?: string,
  ) {}

  deliver(
    envelope: WebhookDeliveryEnvelope,
  ): Promise<ApplicationPortResult<WebhookTransportReceipt>> {
    return Promise.resolve(
      ok({
        deliveryId: envelope.deliveryId,
        outcome: this.outcome,
        ...optional("failureReasonCode", this.failureReasonCode),
      }),
    );
  }
}

class FailingWebhookTransport implements WebhookTransportPort {
  constructor(private readonly failure: ApplicationPortFailure) {}

  deliver(): Promise<ApplicationPortResult<WebhookTransportReceipt>> {
    return Promise.resolve(err(this.failure));
  }
}

class FakeQueueProvider implements QueueProviderPort {
  readonly acknowledged: QueueReservation[] = [];
  readonly retried: Array<Readonly<{ reservationRef: string; delayMilliseconds: number }>> = [];
  readonly deadLettered: Array<Readonly<{ reservationRef: string; reasonCode: string }>> = [];
  private readonly reservations: QueueReservation[];

  constructor(
    reservations: readonly QueueReservation[] = [],
    private readonly reserveFailure?: ApplicationPortFailure,
  ) {
    this.reservations = [...reservations];
  }

  enqueue(): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(err(queueFailure("enqueue_not_used_by_dispatcher_test")));
  }

  reserve(): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    if (this.reserveFailure !== undefined) {
      return Promise.resolve(err(this.reserveFailure));
    }

    return Promise.resolve(ok(this.reservations.shift()));
  }

  acknowledge(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.acknowledged.push(reservation);
    return Promise.resolve(ok(queueReceipt(reservation.jobId, false)));
  }

  releaseForRetry(
    reservation: QueueReservation,
    delayMilliseconds: number,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.retried.push({
      reservationRef: reservation.reservationRef,
      delayMilliseconds,
    });
    return Promise.resolve(ok(queueReceipt(reservation.jobId, false)));
  }

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.deadLettered.push({
      reservationRef: reservation.reservationRef,
      reasonCode,
    });
    return Promise.resolve(ok(queueReceipt(reservation.jobId, true)));
  }
}

function queueReceipt(jobId: JobId, visible: boolean): QueueVisibilityReceipt {
  return {
    jobId,
    visible,
    queueRef: `webhook_delivery:${jobId}`,
  };
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
