import type {
  ApplicationPortContext,
  ApplicationPortResult,
  QueueReservation,
} from "@omniwa/application";
import {
  createIdempotencyKey,
  createJobId,
  createRetryPolicy,
  queueWorkerJob,
  type DomainOwnerContext,
  type IdempotencyKey,
  type JobId,
  type JobStatus,
  type RepositorySaveResult,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { InMemoryQueueProvider } from "./in-memory-queue-provider.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("queue-provider-correlation"),
    requestId: createRequestId("queue-provider-request"),
  }),
  idempotencyKey: "queue-provider-request",
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

describe("InMemoryQueueProvider", () => {
  it("enqueues visible WorkerJob state and replays duplicate idempotency keys", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-1");

    const first = await queue.enqueue(
      {
        jobId,
        ownerContext: "messaging",
        ownerRef: "message-1",
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: "message-1-send",
      },
      context,
    );
    const duplicate = await queue.enqueue(
      {
        jobId: createJobId("queue-job-duplicate"),
        ownerContext: "messaging",
        ownerRef: "message-1",
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: "message-1-send",
      },
      context,
    );

    expectOk(first);
    expectOk(duplicate);
    expect(first.value.visible).toBe(true);
    expect(duplicate.value.jobId).toBe(jobId);
    await expect(workerJobs.findByStatus("queued")).resolves.toHaveLength(1);
    await expect(
      workerJobs.findByIdempotencyKey(createIdempotencyKey("message-1-send")),
    ).resolves.toEqual(await workerJobs.load(jobId));
  });

  it("awaits asynchronous repository idempotency recording before enqueue returns", async () => {
    const workerJobs = new AsyncIdempotencyWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-async-idempotency");

    const enqueue = await queue.enqueue(
      {
        jobId,
        ownerContext: "messaging",
        ownerRef: "message-async-idempotency",
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: "message-async-idempotency-send",
      },
      context,
    );

    expectOk(enqueue);
    await expect(
      workerJobs.findByIdempotencyKey(createIdempotencyKey("message-async-idempotency-send")),
    ).resolves.toEqual(await workerJobs.load(jobId));
  });

  it("reserves work once and persists the WorkerJob reservation attempt", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-2");

    expectOk(
      await queue.enqueue(
        {
          jobId,
          ownerContext: "webhook_delivery",
          ownerRef: "webhook-delivery-1",
          workType: "webhook_delivery",
          retryPolicy,
          idempotencyKey: "webhook-delivery-1",
        },
        context,
      ),
    );

    const reservation = await queue.reserve("webhook_delivery", context);
    const duplicateReservation = await queue.reserve("webhook_delivery", context);
    const reservedWorkerJob = await workerJobs.load(jobId);

    expectOk(reservation);
    expect(reservation.value?.jobId).toBe(jobId);
    expect(reservation.value?.attempt).toBe(1);
    expectOk(duplicateReservation);
    expect(duplicateReservation.value).toBeUndefined();
    expect(reservedWorkerJob?.status).toBe("reserved");
    expect(reservedWorkerJob?.attemptNumber).toBe(1);
  });

  it("acknowledges a reservation and marks WorkerJob completed", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-3");
    const reservation = await enqueueAndReserve(queue, jobId);

    const acknowledgement = await queue.acknowledge(reservation, context);
    const completedWorkerJob = await workerJobs.load(jobId);

    expectOk(acknowledgement);
    expect(acknowledgement.value.visible).toBe(false);
    expect(completedWorkerJob?.status).toBe("completed");
    expect(queue.snapshot()).toEqual([
      expect.objectContaining({
        jobId,
        state: "completed",
        visible: false,
      }),
    ]);
  });

  it("does not requeue completed WorkerJob records during idempotency replay", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-completed-replay");
    const reservation = await enqueueAndReserve(queue, jobId);
    expectOk(await queue.acknowledge(reservation, context));

    const replayQueue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const replay = await replayQueue.enqueue(
      {
        jobId: createJobId("queue-job-completed-replay-duplicate"),
        ownerContext: "messaging",
        ownerRef: String(jobId),
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: `${jobId}-idempotency`,
      },
      context,
    );
    const replayReservation = await replayQueue.reserve("outbound_message", context);

    expectOk(replay);
    expect(replay.value.jobId).toBe(jobId);
    expect(replay.value.visible).toBe(false);
    expectOk(replayReservation);
    expect(replayReservation.value).toBeUndefined();
    expect(replayQueue.snapshot()).toEqual([
      expect.objectContaining({
        jobId,
        state: "completed",
        visible: false,
      }),
    ]);
  });

  it("releases retryable work after the requested delay", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const clock = new ManualClock(1000);
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs, clock });
    const jobId = createJobId("queue-job-4");
    const reservation = await enqueueAndReserve(queue, jobId);

    const retry = await queue.releaseForRetry(reservation, 500, context);
    const retryingWorkerJob = await workerJobs.load(jobId);
    const hiddenReservation = await queue.reserve("outbound_message", context);
    clock.advance(500);
    const nextReservation = await queue.reserve("outbound_message", context);
    const reservedWorkerJob = await workerJobs.load(jobId);

    expectOk(retry);
    expect(retry.value.visible).toBe(false);
    expect(retryingWorkerJob?.status).toBe("retrying");
    expect(retryingWorkerJob?.failureCategory).toBe("queue");
    expectOk(hiddenReservation);
    expect(hiddenReservation.value).toBeUndefined();
    expectOk(nextReservation);
    expect(nextReservation.value?.attempt).toBe(2);
    expect(reservedWorkerJob?.status).toBe("reserved");
  });

  it("recovers expired reservations after the visibility timeout", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const clock = new ManualClock(1000);
    const queue = new InMemoryQueueProvider({
      workerJobRepository: workerJobs,
      clock,
      visibilityTimeoutMilliseconds: 250,
    });
    const jobId = createJobId("queue-job-visibility-timeout");
    const firstReservation = await enqueueAndReserve(queue, jobId);

    clock.advance(249);
    const hiddenReservation = await queue.reserve("outbound_message", context);
    clock.advance(1);
    const secondReservation = await queue.reserve("outbound_message", context);
    const reservedWorkerJob = await workerJobs.load(jobId);

    expect(firstReservation.attempt).toBe(1);
    expectOk(hiddenReservation);
    expect(hiddenReservation.value).toBeUndefined();
    expectOk(secondReservation);
    expect(secondReservation.value?.jobId).toBe(jobId);
    expect(secondReservation.value?.attempt).toBe(2);
    expect(reservedWorkerJob?.status).toBe("reserved");
    expect(reservedWorkerJob?.attemptNumber).toBe(2);
  });

  it("moves expired reservations to dead letter when the retry budget is exhausted", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const clock = new ManualClock(1000);
    const singleAttemptRetryPolicy = createRetryPolicy({
      maxAttempts: 1,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const queue = new InMemoryQueueProvider({
      workerJobRepository: workerJobs,
      clock,
      visibilityTimeoutMilliseconds: 100,
    });
    const jobId = createJobId("queue-job-lease-dead-letter");
    const reservation = await enqueueAndReserve(queue, jobId, singleAttemptRetryPolicy);

    clock.advance(100);
    const nextReservation = await queue.reserve("outbound_message", context);
    const deadWorkerJob = await workerJobs.load(jobId);

    expect(reservation.attempt).toBe(1);
    expectOk(nextReservation);
    expect(nextReservation.value).toBeUndefined();
    expect(deadWorkerJob?.status).toBe("dead");
    expect(deadWorkerJob?.deadLetterReason?.code).toBe("lease_expired_retry_budget_exhausted");
    expect(queue.snapshot()).toEqual([
      expect.objectContaining({
        jobId,
        state: "dead",
        visible: true,
        deadLetterReasonCode: "lease_expired_retry_budget_exhausted",
      }),
    ]);
  });

  it("moves active reservations to dead letter without making them reservable again", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-5");
    const reservation = await enqueueAndReserve(queue, jobId);

    const deadLetter = await queue.moveToDeadLetter(reservation, "retry_budget_exhausted", context);
    const nextReservation = await queue.reserve("outbound_message", context);
    const deadWorkerJob = await workerJobs.load(jobId);

    expectOk(deadLetter);
    expect(deadLetter.value.visible).toBe(true);
    expectOk(nextReservation);
    expect(nextReservation.value).toBeUndefined();
    expect(deadWorkerJob?.status).toBe("dead");
    expect(deadWorkerJob?.deadLetterReason?.code).toBe("retry_budget_exhausted");
    expect(queue.snapshot()).toEqual([
      expect.objectContaining({
        jobId,
        state: "dead",
        visible: true,
        deadLetterReasonCode: "retry_budget_exhausted",
      }),
    ]);
  });

  it("emits queue metrics without making metrics required for queue behavior", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const metricRecorder = new TestMetricRecorder();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs, metricRecorder });
    const jobId = createJobId("queue-job-metrics");
    const reservation = await enqueueAndReserve(queue, jobId);

    expectOk(await queue.acknowledge(reservation, context));

    expect(metricRecorder.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "queue.enqueue.total",
          kind: "counter",
          value: 1,
          labels: expect.objectContaining({
            workType: "outbound_message",
            result: "accepted",
          }),
        }),
        expect.objectContaining({
          name: "queue.reserve.total",
          kind: "counter",
          value: 1,
          labels: expect.objectContaining({
            workType: "outbound_message",
            result: "reserved",
          }),
        }),
        expect.objectContaining({
          name: "queue.acknowledge.total",
          kind: "counter",
          value: 1,
          labels: expect.objectContaining({
            workType: "outbound_message",
            result: "completed",
          }),
        }),
        expect.objectContaining({
          name: "queue.depth",
          kind: "gauge",
          value: 0,
          labels: expect.objectContaining({
            workType: "outbound_message",
          }),
        }),
      ]),
    );
  });

  it("recovers queued WorkerJob records into visible queue entries", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-6");
    await workerJobs.save(queueWorkerJob(jobId, "operations", "health_refresh", retryPolicy));

    const recovery = await queue.recoverVisibleJobs();
    const reservation = await queue.reserve("health_refresh", context);

    expect(recovery.recovered).toBe(1);
    expectOk(reservation);
    expect(reservation.value?.jobId).toBe(jobId);
  });

  it("rejects stale reservations with a safe port failure", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new InMemoryQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("queue-job-7");
    const reservation = await enqueueAndReserve(queue, jobId);

    const staleReservation: QueueReservation = {
      ...reservation,
      reservationRef: "outbound_message:queue-job-7:attempt:stale",
    };
    const staleRelease = await queue.releaseForRetry(staleReservation, 0, context);

    expect(staleRelease.ok).toBe(false);
    expect(staleRelease.ok ? undefined : staleRelease.error).toMatchObject({
      category: "conflict",
      code: "stale_reservation",
      retryable: false,
      ownerContext: "operations",
    });
  });
});

async function enqueueAndReserve(
  queue: InMemoryQueueProvider,
  jobId: JobId,
  policy = retryPolicy,
): Promise<QueueReservation> {
  const enqueue = await queue.enqueue(
    {
      jobId,
      ownerContext: "messaging",
      ownerRef: String(jobId),
      workType: "outbound_message",
      retryPolicy: policy,
      idempotencyKey: `${jobId}-idempotency`,
    },
    context,
  );

  expectOk(enqueue);

  const reservation = await queue.reserve("outbound_message", context);
  expectOk(reservation);

  if (reservation.value === undefined) {
    throw new Error("Expected queue reservation.");
  }

  return reservation.value;
}

function expectOk<T>(result: ApplicationPortResult<T>): asserts result is { ok: true; value: T } {
  if (!result.ok) {
    throw new Error(`Expected ok result but received ${result.error.code}.`);
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

class TestMetricRecorder implements MetricRecorder {
  private readonly metrics: MetricPoint[] = [];

  recordMetric(point: MetricPoint): void {
    this.metrics.push(point);
  }

  snapshot(): readonly MetricPoint[] {
    return Object.freeze([...this.metrics]);
  }
}

class TestWorkerJobRepository implements WorkerJobRepositoryPort {
  private readonly records = new Map<string, WorkerJob>();
  private readonly jobIdByIdempotencyKey = new Map<string, JobId>();

  load(id: JobId): Promise<WorkerJob | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: WorkerJob): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: JobId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    return Promise.resolve(
      Object.freeze([...this.records.values()].filter((job) => job.status === status)),
    );
  }

  findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    return Promise.resolve(
      Object.freeze([...this.records.values()].filter((job) => job.ownerContext === ownerContext)),
    );
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined> {
    const jobId = this.jobIdByIdempotencyKey.get(String(idempotencyKey));
    return Promise.resolve(jobId === undefined ? undefined : this.records.get(String(jobId)));
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): void {
    this.jobIdByIdempotencyKey.set(String(idempotencyKey), jobId);
  }
}

class AsyncIdempotencyWorkerJobRepository extends TestWorkerJobRepository {
  override async recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    super.recordIdempotencyKey(idempotencyKey, jobId);
  }
}
