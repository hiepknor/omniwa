import { describe, expect, it } from "vitest";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  ok,
  type Result,
} from "@omniwa/shared";
import { createDomainEvent, createJobId, createRetryPolicy, type JobId } from "@omniwa/domain";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";
import { createApplicationPortFailure } from "./application-port.js";
import type { ApplicationNotification, EventBusPort, PublicationReceipt } from "./event-bus.js";
import type {
  QueueProviderPort,
  QueueReservation,
  QueueVisibilityReceipt,
  QueueWorkRequest,
  QueueWorkType,
} from "./queue-provider.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("application-port-correlation"),
    requestId: createRequestId("application-port-request"),
  }),
  idempotencyKey: "safe-idempotency-key",
};

describe("application ports", () => {
  it("define safe port failures without exposing raw dependency details", () => {
    const failure = createApplicationPortFailure({
      category: "timeout",
      code: "queue_timeout",
      message: "QueueProvider did not acknowledge visible work in time.",
      retryable: true,
      ownerContext: "operations",
      safeMetadata: {
        workType: "outbound_message",
      },
    });

    expect(failure).toMatchObject({
      category: "timeout",
      code: "queue_timeout",
      retryable: true,
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.safeMetadata)).toBe(true);
  });

  it("allows deterministic QueueProvider fakes without queue engine concepts", async () => {
    const queue: QueueProviderPort = new FakeQueueProvider();
    const jobId = createJobId("job-application-port");

    const enqueueResult = await queue.enqueue(
      {
        jobId,
        ownerContext: "operations",
        ownerRef: "message-1",
        workType: "outbound_message",
        retryPolicy: createRetryPolicy({
          maxAttempts: 3,
          initialDelayMilliseconds: 100,
          backoffMultiplier: 2,
        }),
        idempotencyKey: "message-1-send",
      },
      context,
    );

    expect(enqueueResult.ok).toBe(true);
    expect(enqueueResult.ok ? enqueueResult.value.visible : false).toBe(true);

    const reservation = await queue.reserve("outbound_message", context);
    expect(reservation.ok && reservation.value?.jobId).toBe(jobId);
  });

  it("publishes application notifications separately from domain event facts", async () => {
    const captured = new CapturingEventBus();
    const eventBus: EventBusPort = captured;
    const sourceDomainEvent = createDomainEvent({
      aggregateType: "Message",
      aggregateId: "message-1",
      name: "MessageAccepted",
    });
    const notification: ApplicationNotification = {
      name: "webhook_delivery_requested",
      sourceSignalRef: "message-1.accepted",
      dataClassification: "internal",
      sourceDomainEvent,
      integrationEventName: "message.accepted.v1",
    };

    const result = await eventBus.publishNotification(notification, context);

    expect(result.ok).toBe(true);
    expect(captured.notifications).toEqual([notification]);
    expect(captured.domainFacts).toEqual([]);
  });
});

class FakeQueueProvider implements QueueProviderPort {
  private readonly pending = new Map<QueueWorkType, QueueWorkRequest[]>();

  enqueue(work: QueueWorkRequest): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    const queue = this.pending.get(work.workType) ?? [];
    queue.push(work);
    this.pending.set(work.workType, queue);

    return Promise.resolve(
      ok({
        jobId: work.jobId,
        visible: true,
        queueRef: `${work.workType}:${String(work.jobId)}`,
      }),
    );
  }

  reserve(workType: QueueWorkType): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    const next = this.pending.get(workType)?.shift();

    return Promise.resolve(
      ok(
        next === undefined
          ? undefined
          : {
              jobId: next.jobId,
              reservationRef: `${workType}:reservation`,
              attempt: 1,
            },
      ),
    );
  }

  acknowledge(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(this.receipt(reservation.jobId, false));
  }

  releaseForRetry(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(this.receipt(reservation.jobId, true));
  }

  moveToDeadLetter(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(this.receipt(reservation.jobId, true));
  }

  private receipt(jobId: JobId, visible: boolean): Result<QueueVisibilityReceipt, never> {
    return ok({
      jobId,
      visible,
      queueRef: `job:${String(jobId)}`,
    });
  }
}

class CapturingEventBus implements EventBusPort {
  readonly domainFacts: unknown[] = [];
  readonly notifications: ApplicationNotification[] = [];

  publishDomainFacts(
    events: readonly unknown[],
  ): Promise<ApplicationPortResult<PublicationReceipt>> {
    this.domainFacts.push(...events);
    return Promise.resolve(ok({ publicationRef: "domain-facts", accepted: true }));
  }

  publishNotification(
    notification: ApplicationNotification,
  ): Promise<ApplicationPortResult<PublicationReceipt>> {
    this.notifications.push(notification);
    return Promise.resolve(ok({ publicationRef: "notification", accepted: true }));
  }
}
