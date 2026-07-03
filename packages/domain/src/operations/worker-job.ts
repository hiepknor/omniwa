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
  safeMetadata?: WorkerJobSafeMetadata;
  status: JobStatus;
  retryPolicy: RetryPolicy;
  attemptNumber?: AttemptNumber;
  failureCategory?: FailureCategory;
  deadLetterReason?: DeadLetterReason;
  recoveryActionRequired: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export type WorkerJobSafeMetadata = Readonly<{
  jobKind: string;
  instanceId?: string;
  messageId?: string;
  outboundIntentRef?: string;
}>;

export function queueWorkerJob(
  id: JobId,
  ownerContext: DomainOwnerContext,
  workType: string,
  retryPolicy: RetryPolicy,
  safeMetadata?: WorkerJobSafeMetadata,
): WorkerJob {
  return freezeWorkerJob({
    id,
    ownerContext,
    workType: createSafeDomainCode(workType, "WorkerJob.workType"),
    ...optionalValue("safeMetadata", createWorkerJobSafeMetadata(safeMetadata), undefined),
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
    ...optionalValue("safeMetadata", undefined, job.safeMetadata),
    status: transitionStatus(job.status, status, workerJobTransitions, "WorkerJob"),
    retryPolicy: job.retryPolicy,
    recoveryActionRequired: job.recoveryActionRequired,
    ...optionalValue("attemptNumber", patch.attemptNumber, job.attemptNumber),
    ...optionalValue("failureCategory", patch.failureCategory, job.failureCategory),
    ...optionalValue("deadLetterReason", patch.deadLetterReason, job.deadLetterReason),
    domainEvents: appendDomainEvent(job.domainEvents, "WorkerJob", job.id, eventName),
  });
}

export function createWorkerJobSafeMetadata(
  input: WorkerJobSafeMetadata | undefined,
): WorkerJobSafeMetadata | undefined {
  if (input === undefined) {
    return undefined;
  }

  return Object.freeze({
    jobKind: createSafeDomainCode(input.jobKind, "WorkerJob.safeMetadata.jobKind"),
    ...optionalToken("instanceId", input.instanceId, "WorkerJob.safeMetadata.instanceId"),
    ...optionalToken("messageId", input.messageId, "WorkerJob.safeMetadata.messageId"),
    ...optionalToken(
      "outboundIntentRef",
      input.outboundIntentRef,
      "WorkerJob.safeMetadata.outboundIntentRef",
    ),
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

function optionalToken<TKey extends string>(
  key: TKey,
  value: string | undefined,
  label: string,
): Partial<Record<TKey, string>> {
  if (value === undefined) {
    return {};
  }

  const normalized = value.trim();

  if (!/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new TypeError(`${label} must be an opaque safe token.`);
  }

  return { [key]: normalized } as Partial<Record<TKey, string>>;
}

function freezeWorkerJob(job: WorkerJob): WorkerJob {
  return Object.freeze(job);
}
