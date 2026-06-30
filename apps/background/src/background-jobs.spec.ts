import type {
  ApplicationPortContext,
  ApplicationPortResult,
  QueueReservation,
  QueueVisibilityReceipt,
  QueueWorkRequest,
} from "@omniwa/application";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  BackgroundJobRunner,
  backgroundJobDefinitions,
  type QueueRecoveryCapableProvider,
  type QueueRecoveryResult,
} from "./background-jobs.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("background-correlation"),
    requestId: createRequestId("background-request"),
  }),
  actorRef: "background-runtime",
};

describe("BackgroundJobRunner", () => {
  it("runs queue recovery when the queue provider exposes recovery support", async () => {
    const queueProvider = new RecoverableQueueProviderFake({ recovered: 3 });
    const runner = new BackgroundJobRunner({ queueProvider });

    const result = await runner.run(getQueueRecoveryDefinition(), context);

    expectOk(result);
    expect(result.value).toEqual({
      jobId: "BG-QUEUE-RECOVERY",
      kind: "queue_recovery",
      status: "completed",
      recovered: 3,
      reasonCode: "queue_recovery_completed",
    });
    expect(queueProvider.recoveryRuns).toBe(1);
  });

  it("skips safely when queue recovery is not supported by the provider", async () => {
    const queueProvider = new QueueProviderFake();
    const runner = new BackgroundJobRunner({ queueProvider });

    const result = await runner.run(getQueueRecoveryDefinition(), context);

    expectOk(result);
    expect(result.value).toEqual({
      jobId: "BG-QUEUE-RECOVERY",
      kind: "queue_recovery",
      status: "skipped",
      recovered: 0,
      reasonCode: "queue_recovery_not_supported",
    });
  });

  it("maps recovery failures to safe application port failures", async () => {
    const queueProvider = new RecoverableQueueProviderFake({ recovered: 0 });
    queueProvider.failRecovery = true;
    const runner = new BackgroundJobRunner({ queueProvider });

    const result = await runner.run(getQueueRecoveryDefinition(), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unknown",
      code: "background_job_failed",
      retryable: true,
      ownerContext: "operations",
      failureCategory: "unexpected",
      safeMetadata: {
        errorName: "Error",
      },
    });
  });
});

function expectOk<T>(result: ApplicationPortResult<T>): asserts result is { ok: true; value: T } {
  if (!result.ok) {
    throw new Error(`Expected ok result but received ${result.error.code}.`);
  }
}

function getQueueRecoveryDefinition() {
  const definition = backgroundJobDefinitions[0];

  if (definition === undefined) {
    throw new Error("Queue recovery definition is missing.");
  }

  return definition;
}

class QueueProviderFake implements QueueRecoveryCapableProvider {
  enqueue(work: QueueWorkRequest): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
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

class RecoverableQueueProviderFake extends QueueProviderFake {
  recoveryRuns = 0;
  failRecovery = false;

  constructor(private readonly result: QueueRecoveryResult) {
    super();
  }

  recoverVisibleJobs(): Promise<QueueRecoveryResult> {
    this.recoveryRuns += 1;

    if (this.failRecovery) {
      throw new Error("Recovery scan failed.");
    }

    return Promise.resolve(this.result);
  }
}
