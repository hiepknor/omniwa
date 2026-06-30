import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { DomainOwnerContext } from "../errors/domain-owner-context.js";
import type { FailureCategory } from "../errors/failure-category.js";
import type { JobId } from "../identity/aggregate-ids.js";
import type { AttemptNumber } from "../policies/attempt-number.js";
import type { DeadLetterReason } from "../policies/dead-letter-reason.js";
import type { RetryPolicy } from "../policies/retry-policy.js";
import type { JobStatus } from "../status/job-status.js";

const workerJobTransitions: StatusTransitionMap<JobStatus> = {
  queued: ["reserved", "retrying", "dead"],
  reserved: ["running", "retrying", "dead"],
  running: ["completed", "retrying", "dead"],
  completed: [],
  retrying: ["reserved", "dead"],
  dead: [],
};

export type WorkerJob = Readonly<{
  id: JobId;
  ownerContext: DomainOwnerContext;
  workType: string;
  status: JobStatus;
  retryPolicy: RetryPolicy;
  attemptNumber?: AttemptNumber;
  failureCategory?: FailureCategory;
  deadLetterReason?: DeadLetterReason;
  recoveryActionRequired: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function queueWorkerJob(
  id: JobId,
  ownerContext: DomainOwnerContext,
  workType: string,
  retryPolicy: RetryPolicy,
): WorkerJob {
  return freezeWorkerJob({
    id,
    ownerContext,
    workType: createSafeDomainCode(workType, "WorkerJob.workType"),
    status: "queued",
    retryPolicy,
    recoveryActionRequired: false,
    domainEvents: appendDomainEvent([], "WorkerJob", id, "WorkerJobQueued"),
  });
}

export function reserveWorkerJob(job: WorkerJob, attemptNumber: AttemptNumber): WorkerJob {
  return transitionWorkerJob(job, "reserved", "WorkerJobReserved", { attemptNumber });
}

export function startWorkerJob(job: WorkerJob): WorkerJob {
  return transitionWorkerJob(job, "running", "WorkerJobStarted");
}

export function completeWorkerJob(job: WorkerJob): WorkerJob {
  return transitionWorkerJob(job, "completed", "WorkerJobCompleted");
}

export function retryWorkerJob(
  job: WorkerJob,
  attemptNumber: AttemptNumber,
  failureCategory: FailureCategory,
): WorkerJob {
  assertAttemptWithinRetryBudget(attemptNumber, job.retryPolicy);
  return transitionWorkerJob(job, "retrying", "WorkerJobRetryScheduled", {
    attemptNumber,
    failureCategory,
  });
}

export function markWorkerJobDead(job: WorkerJob, deadLetterReason: DeadLetterReason): WorkerJob {
  return transitionWorkerJob(job, "dead", "WorkerJobDead", {
    deadLetterReason,
    failureCategory: deadLetterReason.category,
  });
}

export function requireWorkerJobRecovery(job: WorkerJob): WorkerJob {
  return freezeWorkerJob({
    ...job,
    recoveryActionRequired: true,
    domainEvents: appendDomainEvent(
      job.domainEvents,
      "WorkerJob",
      job.id,
      "WorkerJobRecoveryRequired",
    ),
  });
}

function transitionWorkerJob(
  job: WorkerJob,
  status: JobStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    attemptNumber?: AttemptNumber;
    failureCategory?: FailureCategory;
    deadLetterReason?: DeadLetterReason;
  }> = {},
): WorkerJob {
  return freezeWorkerJob({
    id: job.id,
    ownerContext: job.ownerContext,
    workType: job.workType,
    status: transitionStatus(job.status, status, workerJobTransitions, "WorkerJob"),
    retryPolicy: job.retryPolicy,
    recoveryActionRequired: job.recoveryActionRequired,
    ...optionalValue("attemptNumber", patch.attemptNumber, job.attemptNumber),
    ...optionalValue("failureCategory", patch.failureCategory, job.failureCategory),
    ...optionalValue("deadLetterReason", patch.deadLetterReason, job.deadLetterReason),
    domainEvents: appendDomainEvent(job.domainEvents, "WorkerJob", job.id, eventName),
  });
}

function assertAttemptWithinRetryBudget(
  attemptNumber: AttemptNumber,
  retryPolicy: RetryPolicy,
): void {
  if (attemptNumber > retryPolicy.maxAttempts) {
    throw new TypeError("WorkerJob retry attempt exceeds retry policy.");
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

function freezeWorkerJob(job: WorkerJob): WorkerJob {
  return Object.freeze(job);
}
