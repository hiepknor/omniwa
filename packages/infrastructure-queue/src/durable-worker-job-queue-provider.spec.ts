import type {
  ApplicationPortContext,
  ApplicationPortResult,
  QueueReservation,
} from "@omniwa/application";
import {
  createIdempotencyKey,
  createJobId,
  createMessageId,
  createRetryPolicy,
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

import { DurableWorkerJobQueueProvider } from "./durable-worker-job-queue-provider.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("durable-queue-correlation"),
    requestId: createRequestId("durable-queue-request"),
  }),
  actorRef: "durable-queue-test",
  idempotencyKey: "durable-queue-request",
  dataClassification: "internal",
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

const outboundSafeMetadata = Object.freeze({
  jobKind: "outbound_message",
  messageId: String(createMessageId("durable-queue-message")),
  outboundIntentRef: "durable-queue-intent",
});

describe("DurableWorkerJobQueueProvider", () => {
  it("enqueues durable WorkerJob state and replays duplicate idempotency keys", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("durable-queue-job-1");

    const first = await queue.enqueue(
      {
        jobId,
        ownerContext: "messaging",
        ownerRef: outboundSafeMetadata.messageId,
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: "durable-queue-job-1-idem",
        safeInputRef: outboundSafeMetadata.outboundIntentRef,
        safeMetadata: outboundSafeMetadata,
      },
      context,
    );
    const duplicate = await queue.enqueue(
      {
        jobId: createJobId("durable-queue-job-duplicate"),
        ownerContext: "messaging",
        ownerRef: outboundSafeMetadata.messageId,
        workType: "outbound_message",
        retryPolicy,
        idempotencyKey: "durable-queue-job-1-idem",
      },
      context,
    );

    expectOk(first);
    expectOk(duplicate);
    expect(first.value.visible).toBe(true);
    expect(duplicate.value.jobId).toBe(jobId);
    await expect(workerJobs.findByStatus("queued")).resolves.toHaveLength(1);
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      safeMetadata: outboundSafeMetadata,
    });
    await expect(
      workerJobs.findByIdempotencyKey(createIdempotencyKey("durable-queue-job-1-idem")),
    ).resolves.toEqual(await workerJobs.load(jobId));
  });

  it("reserves queued work from repository state after provider restart", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const firstQueue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("durable-queue-job-restart");

    expectOk(
      await firstQueue.enqueue(
        {
          jobId,
          ownerContext: "messaging",
          ownerRef: outboundSafeMetadata.messageId,
          workType: "outbound_message",
          retryPolicy,
          idempotencyKey: "durable-queue-job-restart-idem",
          safeMetadata: outboundSafeMetadata,
        },
        context,
      ),
    );

    const restartedQueue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const reservation = await restartedQueue.reserve("outbound_message", context);
    const duplicateReservation = await restartedQueue.reserve("outbound_message", context);

    expectOk(reservation);
    expect(reservation.value).toMatchObject({
      jobId,
      ownerRef: outboundSafeMetadata.messageId,
      workType: "outbound_message",
      safeInputRef: outboundSafeMetadata.outboundIntentRef,
      safeMetadata: outboundSafeMetadata,
    });
    expectOk(duplicateReservation);
    expect(duplicateReservation.value).toBeUndefined();
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      status: "reserved",
      attemptNumber: 1,
    });
  });

  it("acknowledges reservations and persists completed WorkerJob state", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("durable-queue-job-complete");
    const reservation = await enqueueAndReserve(queue, jobId);

    const acknowledgement = await queue.acknowledge(reservation, context);

    expectOk(acknowledgement);
    expect(acknowledgement.value.visible).toBe(false);
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(queue.reserve("outbound_message", context)).resolves.toMatchObject({
      ok: true,
      value: undefined,
    });
  });

  it("releases retryable work after the requested delay in the current runtime", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const clock = new ManualClock(1000);
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs, clock });
    const jobId = createJobId("durable-queue-job-retry");
    const reservation = await enqueueAndReserve(queue, jobId);

    const retry = await queue.releaseForRetry(reservation, 500, context);
    const hiddenReservation = await queue.reserve("outbound_message", context);
    clock.advance(500);
    const nextReservation = await queue.reserve("outbound_message", context);

    expectOk(retry);
    expect(retry.value.visible).toBe(false);
    expectOk(hiddenReservation);
    expect(hiddenReservation.value).toBeUndefined();
    expectOk(nextReservation);
    expect(nextReservation.value?.attempt).toBe(2);
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      status: "reserved",
      attemptNumber: 2,
    });
  });

  it("moves retry budget exhaustion to dead letter instead of throwing", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const singleAttemptRetryPolicy = createRetryPolicy({
      maxAttempts: 1,
      initialDelayMilliseconds: 100,
      backoffMultiplier: 2,
    });
    const jobId = createJobId("durable-queue-job-budget");
    const reservation = await enqueueAndReserve(queue, jobId, singleAttemptRetryPolicy);

    const retry = await queue.releaseForRetry(reservation, 0, context);

    expectOk(retry);
    expect(retry.value.visible).toBe(true);
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      status: "dead",
      deadLetterReason: expect.objectContaining({
        code: "retry_budget_exhausted",
      }),
    });
  });

  it("recovers interrupted reserved jobs into retry-visible state after restart", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("durable-queue-job-recovery");
    const reservation = await enqueueAndReserve(queue, jobId);
    void reservation;

    const restartedQueue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const recovery = await restartedQueue.recoverVisibleJobs();
    const nextReservation = await restartedQueue.reserve("outbound_message", context);

    expect(recovery).toEqual({ recovered: 1 });
    expectOk(nextReservation);
    expect(nextReservation.value?.attempt).toBe(2);
    await expect(workerJobs.load(jobId)).resolves.toMatchObject({
      status: "reserved",
      attemptNumber: 2,
    });
  });

  it("rejects stale reservations with a safe port failure", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const queue = new DurableWorkerJobQueueProvider({ workerJobRepository: workerJobs });
    const jobId = createJobId("durable-queue-job-stale");
    const reservation = await enqueueAndReserve(queue, jobId);

    const staleReservation: QueueReservation = {
      ...reservation,
      reservationRef: "outbound_message:durable-queue-job-stale:attempt:stale",
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

  it("emits safe queue metrics without raw metadata", async () => {
    const workerJobs = new TestWorkerJobRepository();
    const metricRecorder = new TestMetricRecorder();
    const queue = new DurableWorkerJobQueueProvider({
      workerJobRepository: workerJobs,
      metricRecorder,
    });
    const jobId = createJobId("durable-queue-job-metrics");
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
      ]),
    );
    expect(JSON.stringify(metricRecorder.snapshot())).not.toContain("durable-queue-intent");
  });
});

async function enqueueAndReserve(
  queue: DurableWorkerJobQueueProvider,
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
      safeMetadata: outboundSafeMetadata,
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
