import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type QueueProviderPort,
  type QueueReservation,
  type QueueVisibilityReceipt,
  type QueueWorkRequest,
} from "@omniwa/application";
import { createRetryPolicy } from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createUuid,
  err,
  ok,
  type Uuid,
  type UUIDGenerator,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  InMemorySchedulerCheckpointStore,
  SchedulerRuntime,
  createScheduledQueueWorkRequest,
  getScheduleWindowStart,
  type ScheduledWorkDefinition,
} from "./scheduler-runtime.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("scheduler-correlation"),
    requestId: createRequestId("scheduler-request"),
  }),
  actorRef: "scheduler-runtime",
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 2,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

const scheduledDefinition: ScheduledWorkDefinition = Object.freeze({
  id: "SCH-TEST",
  name: "Test Scheduled Work",
  ownerContext: "operations",
  ownerRef: "test-owner",
  workType: "health_refresh",
  intervalMilliseconds: 60_000,
  retryPolicy,
});

describe("SchedulerRuntime", () => {
  it("dispatches due scheduled work once per schedule window", async () => {
    const queueProvider = new CapturingQueueProvider();
    const clock = new ManualClock(900_000);
    const uuidGenerator = new DeterministicUUIDGenerator([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ]);
    const runtime = new SchedulerRuntime({ queueProvider, clock, uuidGenerator });

    const firstTick = await runtime.tick(context);
    const duplicateTick = await runtime.tick(context);
    clock.advance(30_000);
    const nextWindowTick = await runtime.tick(context);

    expect(firstTick.dueCount).toBe(3);
    expect(firstTick.dispatched.map((dispatch) => dispatch.workType)).toEqual([
      "reconnect",
      "retention_cleanup",
      "health_refresh",
    ]);
    expect(duplicateTick.dueCount).toBe(0);
    expect(nextWindowTick.dueCount).toBe(1);
    expect(nextWindowTick.dispatched[0]?.workType).toBe("health_refresh");
    expect(queueProvider.enqueued.map((work) => work.workType)).toEqual([
      "reconnect",
      "retention_cleanup",
      "health_refresh",
      "health_refresh",
    ]);
  });

  it("does not checkpoint a failed queue dispatch", async () => {
    const queueProvider = new CapturingQueueProvider();
    const clock = new ManualClock(120_000);
    const checkpointStore = new InMemorySchedulerCheckpointStore();
    const uuidGenerator = new DeterministicUUIDGenerator([
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
    ]);
    const runtime = new SchedulerRuntime({
      queueProvider,
      clock,
      checkpointStore,
      uuidGenerator,
      definitions: [scheduledDefinition],
    });
    queueProvider.failNextEnqueue();

    const failedTick = await runtime.tick(context);
    expect(checkpointStore.snapshot()).toEqual({});

    const retryTick = await runtime.tick(context);

    expect(failedTick.dispatched[0]?.failure).toMatchObject({
      code: "queue_unavailable",
      retryable: true,
    });
    expect(checkpointStore.snapshot()).toEqual({
      "SCH-TEST": 120_000,
    });
    expect(retryTick.dispatched[0]?.receipt?.visible).toBe(true);
    expect(queueProvider.attempted).toHaveLength(2);
  });

  it("creates stable idempotency keys per schedule window", () => {
    const uuidGenerator = new DeterministicUUIDGenerator(["00000000-0000-4000-8000-000000000021"]);
    const request = createScheduledQueueWorkRequest(scheduledDefinition, 180_000, uuidGenerator);

    expect(getScheduleWindowStart(181_999, 60_000)).toBe(180_000);
    expect(request.idempotencyKey).toBe("scheduler:SCH-TEST:180000");
    expect(request.jobId).toBe("scheduler:SCH-TEST:00000000-0000-4000-8000-000000000021");
    expect(request.ownerContext).toBe("operations");
    expect(request.workType).toBe("health_refresh");
  });
});

class CapturingQueueProvider implements QueueProviderPort {
  readonly enqueued: QueueWorkRequest[] = [];
  readonly attempted: QueueWorkRequest[] = [];
  #failNextEnqueue = false;

  failNextEnqueue(): void {
    this.#failNextEnqueue = true;
  }

  enqueue(work: QueueWorkRequest): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    this.attempted.push(work);

    if (this.#failNextEnqueue) {
      this.#failNextEnqueue = false;
      return Promise.resolve(
        err(
          createApplicationPortFailure({
            category: "unavailable",
            code: "queue_unavailable",
            message: "Queue is temporarily unavailable.",
            retryable: true,
            ownerContext: "operations",
            failureCategory: "queue",
          }),
        ),
      );
    }

    this.enqueued.push(work);
    return Promise.resolve(
      ok({
        jobId: work.jobId,
        visible: true,
        queueRef: `${work.workType}:${work.jobId}`,
      }),
    );
  }

  reserve(): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    return Promise.resolve(ok(undefined));
  }

  acknowledge(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(
      ok({
        jobId: reservation.jobId,
        visible: false,
        queueRef: reservation.reservationRef,
      }),
    );
  }

  releaseForRetry(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(
      ok({
        jobId: reservation.jobId,
        visible: true,
        queueRef: reservation.reservationRef,
      }),
    );
  }

  moveToDeadLetter(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(
      ok({
        jobId: reservation.jobId,
        visible: true,
        queueRef: reservation.reservationRef,
      }),
    );
  }
}

class ManualClock {
  constructor(private currentEpochMilliseconds: number) {}

  epochMilliseconds(): number {
    return this.currentEpochMilliseconds;
  }

  advance(milliseconds: number): void {
    this.currentEpochMilliseconds += milliseconds;
  }
}

class DeterministicUUIDGenerator implements UUIDGenerator {
  readonly #values: readonly Uuid[];
  #index = 0;

  constructor(values: readonly string[]) {
    this.#values = values.map((value) => createUuid(value));
  }

  random(): Uuid {
    const value = this.#values[this.#index];

    if (value === undefined) {
      throw new Error("DeterministicUUIDGenerator exhausted.");
    }

    this.#index += 1;
    return value;
  }
}
