import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type QueueProviderPort,
  type QueueReservation,
  type QueueVisibilityReceipt,
  type QueueWorkType,
} from "@omniwa/application";
import { createJobId } from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { WorkerRuntime, type WorkerJobHandler } from "./worker-runtime.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("worker-runtime-correlation"),
    requestId: createRequestId("worker-runtime-request"),
  }),
  idempotencyKey: "worker-runtime-request",
};

describe("WorkerRuntime", () => {
  it("reports idle when no work is reserved for a registered handler", async () => {
    const queue = new FakeQueueProvider();
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [completedHandler("outbound_message")],
    });

    const result = await runtime.runOnce(context);

    expect(result).toMatchObject({
      attempted: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      idle: 1,
      failed: 0,
    });
    expect(queue.snapshot()).toMatchObject({
      acknowledged: [],
      released: [],
      deadLettered: [],
    });
  });

  it("acknowledges completed handler outcomes", async () => {
    const reservation = createReservation("worker-runtime-job-1");
    const queue = new FakeQueueProvider([reservation]);
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [completedHandler("outbound_message")],
    });

    const result = await runtime.runOnce(context);

    expect(result.completed).toBe(1);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        status: "completed",
        reservation,
      }),
    ]);
    expect(queue.snapshot().acknowledged).toEqual([reservation]);
  });

  it("releases retry handler outcomes with the requested delay", async () => {
    const reservation = createReservation("worker-runtime-job-2");
    const queue = new FakeQueueProvider([reservation]);
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [
        {
          workType: "webhook_delivery",
          handle: () =>
            Promise.resolve(
              ok({
                status: "retry",
                delayMilliseconds: 250,
                reasonCode: "webhook_receiver_unavailable",
              }),
            ),
        },
      ],
    });

    const result = await runtime.runOnce(context);

    expect(result.retried).toBe(1);
    expect(queue.snapshot().released).toEqual([
      {
        reservation,
        delayMilliseconds: 250,
      },
    ]);
  });

  it("moves dead handler outcomes to dead letter", async () => {
    const reservation = createReservation("worker-runtime-job-3");
    const queue = new FakeQueueProvider([reservation]);
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [
        {
          workType: "media_processing",
          handle: () =>
            Promise.resolve(
              ok({
                status: "dead",
                reasonCode: "unsupported_media_type",
              }),
            ),
        },
      ],
    });

    const result = await runtime.runOnce(context);

    expect(result.deadLettered).toBe(1);
    expect(queue.snapshot().deadLettered).toEqual([
      {
        reservation,
        reasonCode: "unsupported_media_type",
      },
    ]);
  });

  it("releases handler failures for retry with the configured unexpected failure delay", async () => {
    const reservation = createReservation("worker-runtime-job-4");
    const queue = new FakeQueueProvider([reservation]);
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      unexpectedFailureRetryDelayMilliseconds: 750,
      handlers: [
        {
          workType: "reconnect",
          handle: () => Promise.reject(new Error("provider unavailable")),
        },
      ],
    });

    const result = await runtime.runOnce(context);

    expect(result.retried).toBe(1);
    expect(queue.snapshot().released).toEqual([
      {
        reservation,
        delayMilliseconds: 750,
      },
    ]);
  });

  it("dead-letters non-retryable handler failures by failure code", async () => {
    const reservation = createReservation("worker-runtime-job-non-retryable");
    const queue = new FakeQueueProvider([reservation]);
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [
        {
          workType: "media_processing",
          handle: () =>
            Promise.resolve(
              err(
                createApplicationPortFailure({
                  category: "rejected",
                  code: "unsupported_media_type",
                  message: "Unsupported media type.",
                  retryable: false,
                  ownerContext: "media",
                  failureCategory: "validation",
                }),
              ),
            ),
        },
      ],
    });

    const result = await runtime.runOnce(context);

    expect(result.deadLettered).toBe(1);
    expect(queue.snapshot().deadLettered).toEqual([
      {
        reservation,
        reasonCode: "unsupported_media_type",
      },
    ]);
  });

  it("reports queue failures without invoking handlers", async () => {
    const queue = new FakeQueueProvider([], queueFailure("queue_reserve_failed"));
    const handler = completedHandler("outbound_message");
    const runtime = new WorkerRuntime({
      queueProvider: queue,
      handlers: [handler],
    });

    const result = await runtime.runOnce(context);

    expect(result.failed).toBe(1);
    expect(handler.handled).toBe(0);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        status: "failed",
        failure: expect.objectContaining({
          code: "queue_reserve_failed",
        }),
      }),
    ]);
  });

  it("rejects duplicate handlers for the same QueueWorkType", () => {
    expect(
      () =>
        new WorkerRuntime({
          queueProvider: new FakeQueueProvider(),
          handlers: [completedHandler("outbound_message"), completedHandler("outbound_message")],
        }),
    ).toThrow("Duplicate WorkerJobHandler for outbound_message.");
  });
});

function completedHandler(
  workType: QueueWorkType,
): WorkerJobHandler & { readonly handled: number } {
  let handled = 0;

  return {
    workType,
    get handled() {
      return handled;
    },
    handle: () => {
      handled += 1;
      return Promise.resolve(ok({ status: "completed" }));
    },
  };
}

function createReservation(id: string): QueueReservation {
  return Object.freeze({
    jobId: createJobId(id),
    reservationRef: `${id}:reservation:1`,
    attempt: 1,
  });
}

function queueFailure(code: string): ApplicationPortResult<never> {
  return err(
    createApplicationPortFailure({
      category: "unavailable",
      code,
      message: "Queue failed.",
      retryable: true,
      ownerContext: "operations",
      failureCategory: "queue",
    }),
  );
}

class FakeQueueProvider implements QueueProviderPort {
  private readonly reservations: QueueReservation[];
  private readonly reserveFailure: ApplicationPortResult<never> | undefined;
  private readonly acknowledged: QueueReservation[] = [];
  private readonly released: Array<
    Readonly<{
      reservation: QueueReservation;
      delayMilliseconds: number;
    }>
  > = [];
  private readonly deadLettered: Array<
    Readonly<{
      reservation: QueueReservation;
      reasonCode: string;
    }>
  > = [];

  constructor(
    reservations: readonly QueueReservation[] = [],
    reserveFailure?: ApplicationPortResult<never>,
  ) {
    this.reservations = [...reservations];
    this.reserveFailure = reserveFailure;
  }

  enqueue(): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    throw new Error("WorkerRuntime should not enqueue work.");
  }

  reserve(): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    if (this.reserveFailure !== undefined) {
      return Promise.resolve(this.reserveFailure);
    }

    return Promise.resolve(ok(this.reservations.shift()));
  }

  acknowledge(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.acknowledged.push(reservation);
    return Promise.resolve(ok(receiptFor(reservation)));
  }

  releaseForRetry(
    reservation: QueueReservation,
    delayMilliseconds: number,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.released.push(
      Object.freeze({
        reservation,
        delayMilliseconds,
      }),
    );
    return Promise.resolve(ok(receiptFor(reservation)));
  }

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.deadLettered.push(
      Object.freeze({
        reservation,
        reasonCode,
      }),
    );
    return Promise.resolve(ok(receiptFor(reservation)));
  }

  snapshot(): Readonly<{
    acknowledged: readonly QueueReservation[];
    released: readonly Readonly<{
      reservation: QueueReservation;
      delayMilliseconds: number;
    }>[];
    deadLettered: readonly Readonly<{
      reservation: QueueReservation;
      reasonCode: string;
    }>[];
  }> {
    return Object.freeze({
      acknowledged: Object.freeze([...this.acknowledged]),
      released: Object.freeze([...this.released]),
      deadLettered: Object.freeze([...this.deadLettered]),
    });
  }
}

function receiptFor(reservation: QueueReservation): QueueVisibilityReceipt {
  return Object.freeze({
    jobId: reservation.jobId,
    visible: false,
    queueRef: `worker-test:${reservation.jobId}`,
  });
}
