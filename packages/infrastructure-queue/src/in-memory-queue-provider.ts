import {
  createApplicationPortFailure,
  queueWorkTypes,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type QueueProviderPort,
  type QueueReservation,
  type QueueVisibilityReceipt,
  type QueueWorkRequest,
  type QueueWorkType,
} from "@omniwa/application";
import {
  completeWorkerJob,
  createAttemptNumber,
  createDeadLetterReason,
  createFailureCategory,
  createIdempotencyKey,
  markWorkerJobDead,
  queueWorkerJob,
  reserveWorkerJob,
  retryWorkerJob,
  startWorkerJob,
  type FailureCategory,
  type IdempotencyKey,
  type JobId,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import {
  createMetricPoint,
  type MetricKind,
  type MetricRecorder,
  type RuntimeRole,
} from "@omniwa/observability";
import { err, ok, systemClock, type Clock } from "@omniwa/shared";

type QueueEntryState = "available" | "reserved" | "completed" | "dead";

type IdempotencyAwareWorkerJobRepository = WorkerJobRepositoryPort &
  Partial<{
    recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): Promise<void> | void;
  }>;

type QueueEntry = {
  readonly work: QueueWorkRequest;
  visibleAtEpochMilliseconds: number;
  attempt: number;
  state: QueueEntryState;
  reservationRef?: string;
  deadLetterReasonCode?: string;
};

export type InMemoryQueueProviderOptions = Readonly<{
  workerJobRepository: WorkerJobRepositoryPort;
  clock?: Pick<Clock, "epochMilliseconds">;
  visibilityTimeoutMilliseconds?: number;
  metricRecorder?: MetricRecorder;
  metricRuntimeRole?: RuntimeRole;
}>;

export type InMemoryQueueEntrySnapshot = Readonly<{
  jobId: JobId;
  workType: QueueWorkType;
  ownerRef: string;
  state: QueueEntryState;
  attempt: number;
  visible: boolean;
  queueRef: string;
  visibleAtEpochMilliseconds: number;
  safeInputRef?: string;
  safeMetadata?: QueueWorkRequest["safeMetadata"];
  reservationRef?: string;
  deadLetterReasonCode?: string;
}>;

export type QueueRecoveryResult = Readonly<{
  recovered: number;
}>;

const defaultVisibilityTimeoutMilliseconds = 30_000;

export class InMemoryQueueProvider implements QueueProviderPort {
  private readonly workerJobRepository: IdempotencyAwareWorkerJobRepository;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly visibilityTimeoutMilliseconds: number;
  private readonly metricRecorder: MetricRecorder | undefined;
  private readonly metricRuntimeRole: RuntimeRole;
  private readonly entries = new Map<string, QueueEntry>();
  private readonly jobIdByIdempotencyKey = new Map<string, JobId>();

  constructor(options: InMemoryQueueProviderOptions) {
    this.workerJobRepository = options.workerJobRepository;
    this.clock = options.clock ?? systemClock;
    this.visibilityTimeoutMilliseconds =
      options.visibilityTimeoutMilliseconds ?? defaultVisibilityTimeoutMilliseconds;
    this.metricRecorder = options.metricRecorder;
    this.metricRuntimeRole = options.metricRuntimeRole ?? "worker";
    assertPositiveInteger(this.visibilityTimeoutMilliseconds, "visibilityTimeoutMilliseconds");
  }

  enqueue(
    work: QueueWorkRequest,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;

      const idempotencyKey = createIdempotencyKey(work.idempotencyKey);
      const existingJob = await this.findExistingJob(idempotencyKey);

      if (existingJob !== undefined) {
        this.ensureQueueEntry(work, existingJob);
        this.recordQueueMetric("queue.enqueue.total", work.workType, "duplicate");
        return this.receiptFor(existingJob.id);
      }

      const workerJob = queueWorkerJob(
        work.jobId,
        work.ownerContext,
        work.workType,
        work.retryPolicy,
        work.safeMetadata,
      );

      await this.workerJobRepository.save(workerJob);
      await this.workerJobRepository.recordIdempotencyKey?.(idempotencyKey, work.jobId);
      this.jobIdByIdempotencyKey.set(String(idempotencyKey), work.jobId);
      this.entries.set(this.keyFor(work.jobId), {
        work,
        visibleAtEpochMilliseconds: this.now(),
        attempt: 0,
        state: "available",
      });
      this.recordQueueMetric("queue.enqueue.total", work.workType, "accepted");
      this.recordDepthMetric(work.workType);

      return this.receiptFor(work.jobId);
    });
  }

  reserve(
    workType: QueueWorkType,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    return this.capturePortFailure(async () => {
      void context;

      await this.recoverExpiredReservations();
      const entry = this.findReservableEntry(workType);

      if (entry === undefined) {
        this.recordQueueMetric("queue.reserve.empty.total", workType, "empty");
        return undefined;
      }

      const workerJob = await this.loadWorkerJob(entry.work.jobId);
      const attempt = entry.attempt + 1;
      const reserved = reserveWorkerJob(
        workerJob,
        createAttemptNumber(attempt, workerJob.retryPolicy),
      );
      const reservationRef = this.reservationRefFor(entry.work.jobId, attempt);

      await this.workerJobRepository.save(reserved);
      entry.attempt = attempt;
      entry.state = "reserved";
      entry.reservationRef = reservationRef;
      entry.visibleAtEpochMilliseconds = this.now() + this.visibilityTimeoutMilliseconds;
      this.recordQueueMetric("queue.reserve.total", workType, "reserved");

      return Object.freeze({
        jobId: entry.work.jobId,
        reservationRef,
        attempt,
        ownerContext: entry.work.ownerContext,
        ownerRef: entry.work.ownerRef,
        workType: entry.work.workType,
        ...optional("safeInputRef", entry.work.safeInputRef),
        ...optional("safeMetadata", entry.work.safeMetadata),
      });
    });
  }

  acknowledge(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;

      const entry = this.resolveReservation(reservation);

      if (entry.state === "completed") {
        return this.receiptFor(reservation.jobId);
      }

      this.assertReserved(entry, reservation);
      const workerJob = await this.loadWorkerJob(reservation.jobId);
      const completed =
        workerJob.status === "running"
          ? completeWorkerJob(workerJob)
          : completeWorkerJob(startWorkerJob(workerJob));

      await this.workerJobRepository.save(completed);
      entry.state = "completed";
      entry.visibleAtEpochMilliseconds = Number.POSITIVE_INFINITY;
      this.recordQueueMetric("queue.acknowledge.total", entry.work.workType, "completed");
      this.recordDepthMetric(entry.work.workType);

      return this.receiptFor(reservation.jobId);
    });
  }

  releaseForRetry(
    reservation: QueueReservation,
    delayMilliseconds: number,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;
      assertNonNegativeInteger(delayMilliseconds, "delayMilliseconds");

      const entry = this.resolveReservation(reservation);
      this.assertReserved(entry, reservation);
      const workerJob = await this.loadWorkerJob(reservation.jobId);
      const nextAttempt = reservation.attempt + 1;
      const retrying = retryWorkerJob(
        workerJob,
        createAttemptNumber(nextAttempt, workerJob.retryPolicy),
        createFailureCategory("queue"),
      );

      await this.workerJobRepository.save(retrying);
      entry.state = "available";
      entry.visibleAtEpochMilliseconds = this.now() + delayMilliseconds;
      entry.attempt = reservation.attempt;
      delete entry.reservationRef;
      this.recordQueueMetric("queue.retry.total", entry.work.workType, "scheduled");

      return this.receiptFor(reservation.jobId);
    });
  }

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;

      const entry = this.resolveReservation(reservation);

      if (entry.state === "dead") {
        return this.receiptFor(reservation.jobId);
      }

      this.assertReserved(entry, reservation);
      const workerJob = await this.loadWorkerJob(reservation.jobId);
      const dead = markWorkerJobDead(
        workerJob,
        createDeadLetterReason({ code: reasonCode, category: "queue" }),
      );

      await this.workerJobRepository.save(dead);
      entry.state = "dead";
      entry.deadLetterReasonCode = reasonCode;
      entry.visibleAtEpochMilliseconds = this.now();
      this.recordQueueMetric("queue.dead_letter.total", entry.work.workType, "dead_lettered");
      this.recordDepthMetric(entry.work.workType);

      return this.receiptFor(reservation.jobId);
    });
  }

  async recoverVisibleJobs(): Promise<QueueRecoveryResult> {
    let recovered = await this.recoverExpiredReservations();
    const visibleJobs = [
      ...(await this.workerJobRepository.findByStatus("queued")),
      ...(await this.workerJobRepository.findByStatus("retrying")),
    ];

    for (const job of visibleJobs) {
      if (!isQueueWorkType(job.workType) || this.entries.has(this.keyFor(job.id))) {
        continue;
      }

      this.entries.set(this.keyFor(job.id), {
        work: {
          jobId: job.id,
          ownerContext: job.ownerContext,
          ownerRef: job.safeMetadata?.messageId ?? String(job.id),
          workType: job.workType,
          retryPolicy: job.retryPolicy,
          idempotencyKey: String(job.id),
          ...optional("safeInputRef", job.safeMetadata?.outboundIntentRef),
          ...optional("safeMetadata", job.safeMetadata),
        },
        visibleAtEpochMilliseconds: this.now(),
        attempt: job.attemptNumber ?? 0,
        state: "available",
      });
      recovered += 1;
      this.recordQueueMetric("queue.recovery.total", toQueueWorkType(job.workType), "recovered");
    }

    return Object.freeze({ recovered });
  }

  snapshot(): readonly InMemoryQueueEntrySnapshot[] {
    return Object.freeze(
      [...this.entries.values()].map((entry) =>
        Object.freeze({
          jobId: entry.work.jobId,
          workType: entry.work.workType,
          ownerRef: entry.work.ownerRef,
          state: entry.state,
          attempt: entry.attempt,
          visible: this.isEntryVisible(entry),
          queueRef: this.queueRefFor(entry.work.jobId),
          visibleAtEpochMilliseconds: entry.visibleAtEpochMilliseconds,
          ...optional("safeInputRef", entry.work.safeInputRef),
          ...optional("safeMetadata", entry.work.safeMetadata),
          ...optional("reservationRef", entry.reservationRef),
          ...optional("deadLetterReasonCode", entry.deadLetterReasonCode),
        }),
      ),
    );
  }

  private async findExistingJob(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined> {
    const repositoryMatch = await this.workerJobRepository.findByIdempotencyKey(idempotencyKey);

    if (repositoryMatch !== undefined) {
      this.jobIdByIdempotencyKey.set(String(idempotencyKey), repositoryMatch.id);
      return repositoryMatch;
    }

    const knownJobId = this.jobIdByIdempotencyKey.get(String(idempotencyKey));
    return knownJobId === undefined ? undefined : this.workerJobRepository.load(knownJobId);
  }

  private ensureQueueEntry(work: QueueWorkRequest, existingJob: WorkerJob): void {
    const key = this.keyFor(existingJob.id);

    if (this.entries.has(key)) {
      return;
    }

    const state = queueStateForWorkerJob(existingJob);

    this.entries.set(key, {
      work: {
        ...work,
        jobId: existingJob.id,
        ownerContext: existingJob.ownerContext,
        ownerRef: existingJob.safeMetadata?.messageId ?? work.ownerRef,
        workType: toQueueWorkType(existingJob.workType),
        retryPolicy: existingJob.retryPolicy,
        ...optional(
          "safeInputRef",
          existingJob.safeMetadata?.outboundIntentRef ?? work.safeInputRef,
        ),
        ...optional("safeMetadata", existingJob.safeMetadata ?? work.safeMetadata),
      },
      visibleAtEpochMilliseconds: state === "completed" ? Number.POSITIVE_INFINITY : this.now(),
      attempt: existingJob.attemptNumber ?? 0,
      state,
    });
  }

  private findReservableEntry(workType: QueueWorkType): QueueEntry | undefined {
    return [...this.entries.values()].find(
      (entry) =>
        entry.work.workType === workType &&
        entry.state === "available" &&
        entry.visibleAtEpochMilliseconds <= this.now(),
    );
  }

  private resolveReservation(reservation: QueueReservation): QueueEntry {
    const entry = this.entries.get(this.keyFor(reservation.jobId));

    if (entry === undefined) {
      throw new QueueProviderError("unknown_reservation", "Queue reservation is unknown.");
    }

    if (entry.reservationRef !== reservation.reservationRef) {
      throw new QueueProviderError("stale_reservation", "Queue reservation is stale.");
    }

    return entry;
  }

  private assertReserved(entry: QueueEntry, reservation: QueueReservation): void {
    if (entry.state !== "reserved") {
      throw new QueueProviderError(
        "reservation_not_active",
        "Queue reservation is not active.",
        false,
        "worker",
      );
    }

    if (entry.attempt !== reservation.attempt) {
      throw new QueueProviderError(
        "reservation_attempt_mismatch",
        "Queue reservation attempt does not match visible queue state.",
        false,
        "worker",
      );
    }
  }

  private async recoverExpiredReservations(): Promise<number> {
    let recovered = 0;

    for (const entry of this.entries.values()) {
      if (entry.state !== "reserved" || entry.visibleAtEpochMilliseconds > this.now()) {
        continue;
      }

      const workerJob = await this.loadWorkerJob(entry.work.jobId);

      if (workerJob.status === "completed" || workerJob.status === "dead") {
        entry.state = queueStateForWorkerJob(workerJob);
        delete entry.reservationRef;
        recovered += 1;
        continue;
      }

      const nextAttempt = entry.attempt + 1;

      if (nextAttempt > workerJob.retryPolicy.maxAttempts) {
        const reasonCode = "lease_expired_retry_budget_exhausted";
        const dead = markWorkerJobDead(
          workerJob,
          createDeadLetterReason({ code: reasonCode, category: "queue" }),
        );

        await this.workerJobRepository.save(dead);
        entry.state = "dead";
        entry.deadLetterReasonCode = reasonCode;
        entry.visibleAtEpochMilliseconds = this.now();
        delete entry.reservationRef;
        this.recordQueueMetric("queue.lease_expired.total", entry.work.workType, "dead_lettered");
        this.recordDepthMetric(entry.work.workType);
        recovered += 1;
        continue;
      }

      const retrying = retryWorkerJob(
        workerJob,
        createAttemptNumber(nextAttempt, workerJob.retryPolicy),
        createFailureCategory("queue"),
      );

      await this.workerJobRepository.save(retrying);
      entry.state = "available";
      entry.visibleAtEpochMilliseconds = this.now();
      delete entry.reservationRef;
      this.recordQueueMetric("queue.lease_expired.total", entry.work.workType, "recovered");
      recovered += 1;
    }

    return recovered;
  }

  private async loadWorkerJob(jobId: JobId): Promise<WorkerJob> {
    const workerJob = await this.workerJobRepository.load(jobId);

    if (workerJob === undefined) {
      throw new QueueProviderError("worker_job_missing", "WorkerJob is missing.");
    }

    return workerJob;
  }

  private receiptFor(jobId: JobId): QueueVisibilityReceipt {
    const entry = this.entries.get(this.keyFor(jobId));

    if (entry === undefined) {
      throw new QueueProviderError("queue_entry_missing", "Queue entry is missing.");
    }

    return Object.freeze({
      jobId,
      visible: this.isEntryVisible(entry),
      queueRef: this.queueRefFor(jobId),
    });
  }

  private isEntryVisible(entry: QueueEntry): boolean {
    return (
      entry.state === "dead" ||
      ((entry.state === "available" || entry.state === "reserved") &&
        entry.visibleAtEpochMilliseconds <= this.now())
    );
  }

  private keyFor(jobId: JobId): string {
    return String(jobId);
  }

  private queueRefFor(jobId: JobId): string {
    const entry = this.entries.get(this.keyFor(jobId));
    const workType = entry?.work.workType ?? "unknown";
    return `${workType}:${jobId}`;
  }

  private reservationRefFor(jobId: JobId, attempt: number): string {
    const entry = this.entries.get(this.keyFor(jobId));
    const workType = entry?.work.workType ?? "unknown";
    return `${workType}:${jobId}:attempt:${attempt}`;
  }

  private now(): number {
    return this.clock.epochMilliseconds();
  }

  private async capturePortFailure<T>(action: () => Promise<T>): Promise<ApplicationPortResult<T>> {
    try {
      return ok(await action());
    } catch (error) {
      return err(toApplicationPortFailure(error));
    }
  }

  private recordQueueMetric(name: string, workType: QueueWorkType, result: string): void {
    this.recordMetric(name, 1, "counter", {
      workType,
      result,
    });
  }

  private recordDepthMetric(workType: QueueWorkType): void {
    const depth = [...this.entries.values()].filter(
      (entry) =>
        entry.work.workType === workType && entry.state !== "completed" && entry.state !== "dead",
    ).length;

    this.recordMetric("queue.depth", depth, "gauge", { workType });
  }

  private recordMetric(
    name: string,
    value: number,
    kind: MetricKind,
    labels: Record<string, string>,
  ): void {
    try {
      this.metricRecorder?.recordMetric(
        createMetricPoint({
          name,
          kind,
          value,
          runtimeRole: this.metricRuntimeRole,
          labels,
          observedAtEpochMilliseconds: this.now(),
        }),
      );
    } catch {
      return;
    }
  }
}

class QueueProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly failureCategory: FailureCategory = "queue",
  ) {
    super(message);
  }
}

function toApplicationPortFailure(error: unknown): ApplicationPortFailure {
  if (error instanceof QueueProviderError) {
    return createApplicationPortFailure({
      category: error.retryable ? "unavailable" : "conflict",
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ownerContext: "operations",
      failureCategory: error.failureCategory,
    });
  }

  if (error instanceof TypeError) {
    return createApplicationPortFailure({
      category: "rejected",
      code: "queue_request_rejected",
      message: error.message,
      retryable: false,
      ownerContext: "operations",
      failureCategory: "queue",
    });
  }

  return createApplicationPortFailure({
    category: "unknown",
    code: "queue_provider_unexpected_failure",
    message: "Queue provider failed unexpectedly.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: "unexpected",
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function isQueueWorkType(value: string): value is QueueWorkType {
  return queueWorkTypes.includes(value as QueueWorkType);
}

function toQueueWorkType(value: string): QueueWorkType {
  if (!isQueueWorkType(value)) {
    throw new QueueProviderError("unsupported_work_type", "WorkerJob work type is unsupported.");
  }

  return value;
}

function queueStateForWorkerJob(job: WorkerJob): QueueEntryState {
  switch (job.status) {
    case "queued":
    case "retrying":
      return "available";
    case "reserved":
    case "running":
      return "reserved";
    case "completed":
      return "completed";
    case "dead":
      return "dead";
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
