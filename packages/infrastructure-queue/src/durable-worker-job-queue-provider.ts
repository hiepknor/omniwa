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
  classifyValue,
  createCatalogMetricPoint,
  createMetricPoint,
  toSafeLogFields,
  type MetricKind,
  type MetricRecorder,
  type RuntimeRole,
} from "@omniwa/observability";
import { err, ok, systemClock, type Clock } from "@omniwa/shared";

type IdempotencyAwareWorkerJobRepository = WorkerJobRepositoryPort &
  Partial<{
    recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): Promise<void> | void;
  }>;

type DurableQueueAwareWorkerJobRepository = IdempotencyAwareWorkerJobRepository &
  Partial<{
    reserveNextVisibleWorkerJob(input: {
      workType: string;
      visibleAtEpochMilliseconds: number;
      reservedVisibleAtEpochMilliseconds: number;
      reserve: (workerJob: WorkerJob) => WorkerJob;
    }): Promise<WorkerJob | undefined>;
    recoverExpiredWorkerJobLeases(input: {
      workTypes: readonly string[];
      visibleAtEpochMilliseconds: number;
      recover: (workerJob: WorkerJob) => WorkerJob;
    }): Promise<readonly WorkerJob[]>;
    setWorkerJobVisibleAt(jobId: JobId, visibleAtEpochMilliseconds: number): Promise<void>;
    clearWorkerJobVisibleAt(jobId: JobId): Promise<void>;
    getWorkerJobVisibleAt(jobId: JobId): Promise<number | undefined>;
  }>;

export type DurableWorkerJobQueueProviderOptions = Readonly<{
  workerJobRepository: WorkerJobRepositoryPort;
  clock?: Pick<Clock, "epochMilliseconds">;
  visibilityTimeoutMilliseconds?: number;
  metricRecorder?: MetricRecorder;
  metricRuntimeRole?: RuntimeRole;
}>;

export type DurableWorkerJobQueueSnapshot = Readonly<{
  jobId: JobId;
  workType: QueueWorkType;
  ownerRef: string;
  status: WorkerJob["status"];
  attempt: number;
  visible: boolean;
  queueRef: string;
  safeInputRef?: string;
  safeMetadata?: QueueWorkRequest["safeMetadata"];
  deadLetterReasonCode?: string;
}>;

export type DurableWorkerJobQueueRecoveryResult = Readonly<{
  recovered: number;
}>;

const defaultVisibilityTimeoutMilliseconds = 30_000;

export class DurableWorkerJobQueueProvider implements QueueProviderPort {
  private readonly workerJobRepository: DurableQueueAwareWorkerJobRepository;
  private readonly clock: Pick<Clock, "epochMilliseconds">;
  private readonly visibilityTimeoutMilliseconds: number;
  private readonly metricRecorder: MetricRecorder | undefined;
  private readonly metricRuntimeRole: RuntimeRole;
  private readonly retryVisibleAtByJobId = new Map<string, number>();

  constructor(options: DurableWorkerJobQueueProviderOptions) {
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
      const existingJob = await this.workerJobRepository.findByIdempotencyKey(idempotencyKey);

      if (existingJob !== undefined) {
        this.recordQueueMetric("queue.enqueue.total", work.workType, "duplicate");
        return this.receiptFor(existingJob);
      }

      const workerJob = queueWorkerJob(
        work.jobId,
        work.ownerContext,
        work.workType,
        work.retryPolicy,
        work.safeMetadata,
      );

      await this.workerJobRepository.save(workerJob);
      await this.setWorkerJobVisibility(workerJob.id, this.now());
      await this.workerJobRepository.recordIdempotencyKey?.(idempotencyKey, work.jobId);
      this.recordQueueMetric("queue.enqueue.total", work.workType, "accepted");
      await this.recordBacklogMetrics(work.workType);

      return this.receiptFor(workerJob);
    });
  }

  reserve(
    workType: QueueWorkType,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    return this.capturePortFailure(async () => {
      void context;

      await this.recoverExpiredWorkerJobLeases();
      const reserved = await this.reserveNextVisibleWorkerJob(workType);

      if (reserved === undefined) {
        this.recordQueueMetric("queue.reserve.empty.total", workType, "empty");
        return undefined;
      }

      this.recordQueueMetric("queue.reserve.total", workType, "reserved");
      await this.recordBacklogMetrics(workType);

      return reservationFor(reserved, reserved.attemptNumber ?? 1);
    });
  }

  acknowledge(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;

      const workerJob = await this.loadWorkerJob(reservation.jobId);

      if (workerJob.status === "completed") {
        return this.receiptFor(workerJob);
      }

      assertActiveReservation(workerJob, reservation);
      const completed =
        workerJob.status === "running"
          ? completeWorkerJob(workerJob)
          : completeWorkerJob(startWorkerJob(workerJob));

      await this.workerJobRepository.save(completed);
      await this.clearWorkerJobVisibility(completed.id);
      this.recordQueueMetric(
        "queue.acknowledge.total",
        toQueueWorkType(completed.workType),
        "completed",
      );
      await this.recordBacklogMetrics(toQueueWorkType(completed.workType));

      return this.receiptFor(completed);
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

      const workerJob = await this.loadWorkerJob(reservation.jobId);
      assertActiveReservation(workerJob, reservation);
      const nextAttempt = reservation.attempt + 1;

      if (nextAttempt > workerJob.retryPolicy.maxAttempts) {
        const dead = markWorkerJobDead(
          workerJob,
          createDeadLetterReason({ code: "retry_budget_exhausted", category: "queue" }),
        );

        await this.workerJobRepository.save(dead);
        await this.clearWorkerJobVisibility(dead.id);
        this.recordQueueMetric(
          "queue.dead_letter.total",
          toQueueWorkType(dead.workType),
          "dead_lettered",
        );
        await this.recordBacklogMetrics(toQueueWorkType(dead.workType));

        return this.receiptFor(dead);
      }

      const retrying = retryWorkerJob(
        workerJob,
        createAttemptNumber(nextAttempt, workerJob.retryPolicy),
        createFailureCategory("queue"),
      );

      await this.setWorkerJobVisibility(retrying.id, this.now() + delayMilliseconds);
      await this.workerJobRepository.save(retrying);
      this.recordQueueMetric("queue.retry.total", toQueueWorkType(retrying.workType), "scheduled");
      await this.recordBacklogMetrics(toQueueWorkType(retrying.workType));

      return this.receiptFor(retrying);
    });
  }

  moveToDeadLetter(
    reservation: QueueReservation,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return this.capturePortFailure(async () => {
      void context;

      const workerJob = await this.loadWorkerJob(reservation.jobId);

      if (workerJob.status === "dead") {
        return this.receiptFor(workerJob);
      }

      assertActiveReservation(workerJob, reservation);
      const dead = markWorkerJobDead(
        workerJob,
        createDeadLetterReason({ code: reasonCode, category: "queue" }),
      );

      await this.workerJobRepository.save(dead);
      await this.clearWorkerJobVisibility(dead.id);
      this.recordQueueMetric(
        "queue.dead_letter.total",
        toQueueWorkType(dead.workType),
        "dead_lettered",
      );
      await this.recordBacklogMetrics(toQueueWorkType(dead.workType));

      return this.receiptFor(dead);
    });
  }

  async recoverVisibleJobs(): Promise<DurableWorkerJobQueueRecoveryResult> {
    const recovered = await this.recoverExpiredWorkerJobLeases();

    return Object.freeze({ recovered });
  }

  async snapshot(): Promise<readonly DurableWorkerJobQueueSnapshot[]> {
    const jobs = [
      ...(await this.workerJobRepository.findByStatus("queued")),
      ...(await this.workerJobRepository.findByStatus("reserved")),
      ...(await this.workerJobRepository.findByStatus("running")),
      ...(await this.workerJobRepository.findByStatus("retrying")),
      ...(await this.workerJobRepository.findByStatus("completed")),
      ...(await this.workerJobRepository.findByStatus("dead")),
    ];

    return Object.freeze(
      await Promise.all(
        jobs.filter(isSupportedWorkerJob).map(async (job) =>
          Object.freeze({
            jobId: job.id,
            workType: toQueueWorkType(job.workType),
            ownerRef: ownerRefFor(job),
            status: job.status,
            attempt: job.attemptNumber ?? 0,
            visible: await this.isWorkerJobVisible(job),
            queueRef: queueRefFor(job),
            ...optional("safeInputRef", job.safeMetadata?.outboundIntentRef),
            ...optional("safeMetadata", job.safeMetadata),
            ...optional("deadLetterReasonCode", job.deadLetterReason?.code),
          }),
        ),
      ),
    );
  }

  private async recoverExpiredWorkerJobLeases(): Promise<number> {
    const atomicRecover = this.workerJobRepository.recoverExpiredWorkerJobLeases;

    if (atomicRecover !== undefined) {
      const recovered = await atomicRecover.call(this.workerJobRepository, {
        workTypes: queueWorkTypes,
        visibleAtEpochMilliseconds: this.now(),
        recover: (workerJob) => this.recoverExpiredWorkerJob(workerJob),
      });

      for (const workerJob of recovered) {
        this.recordQueueMetric(
          "queue.lease_expired.total",
          toQueueWorkType(workerJob.workType),
          "recovered",
        );
      }

      return recovered.length;
    }

    let recovered = 0;
    const interruptedJobs = [
      ...(await this.workerJobRepository.findByStatus("reserved")),
      ...(await this.workerJobRepository.findByStatus("running")),
    ];

    for (const workerJob of interruptedJobs) {
      if (!isQueueWorkType(workerJob.workType)) {
        continue;
      }

      const visibleAt = await this.visibleAtFor(workerJob);

      if (visibleAt !== undefined && visibleAt > this.now()) {
        continue;
      }

      const recoveredWorkerJob = this.recoverExpiredWorkerJob(workerJob);

      if (recoveredWorkerJob.status === "retrying") {
        await this.setWorkerJobVisibility(recoveredWorkerJob.id, this.now());
      } else {
        await this.clearWorkerJobVisibility(recoveredWorkerJob.id);
      }

      await this.workerJobRepository.save(recoveredWorkerJob);
      recovered += 1;
      this.recordQueueMetric("queue.lease_expired.total", workerJob.workType, "recovered");
    }

    return recovered;
  }

  private recoverExpiredWorkerJob(workerJob: WorkerJob): WorkerJob {
    const nextAttempt = (workerJob.attemptNumber ?? 0) + 1;

    if (nextAttempt > workerJob.retryPolicy.maxAttempts) {
      return markWorkerJobDead(
        workerJob,
        createDeadLetterReason({
          code: "lease_expired_retry_budget_exhausted",
          category: "queue",
        }),
      );
    }

    return retryWorkerJob(
      workerJob,
      createAttemptNumber(nextAttempt, workerJob.retryPolicy),
      createFailureCategory("queue"),
    );
  }

  private async reserveNextVisibleWorkerJob(
    workType: QueueWorkType,
  ): Promise<WorkerJob | undefined> {
    const atomicReserve = this.workerJobRepository.reserveNextVisibleWorkerJob;

    if (atomicReserve !== undefined) {
      const reserved = await atomicReserve.call(this.workerJobRepository, {
        workType,
        visibleAtEpochMilliseconds: this.now(),
        reservedVisibleAtEpochMilliseconds: this.now() + this.visibilityTimeoutMilliseconds,
        reserve: (workerJob) => {
          const attempt = nextReservationAttempt(workerJob);

          return reserveWorkerJob(workerJob, createAttemptNumber(attempt, workerJob.retryPolicy));
        },
      });

      if (reserved !== undefined) {
        this.retryVisibleAtByJobId.delete(String(reserved.id));
      }

      return reserved;
    }

    const workerJob = await this.findReservableWorkerJob(workType);

    if (workerJob === undefined) {
      return undefined;
    }

    const attempt = nextReservationAttempt(workerJob);
    const reserved = reserveWorkerJob(
      workerJob,
      createAttemptNumber(attempt, workerJob.retryPolicy),
    );

    await this.workerJobRepository.save(reserved);
    await this.setWorkerJobVisibility(
      workerJob.id,
      this.now() + this.visibilityTimeoutMilliseconds,
    );

    return reserved;
  }

  private async visibleAtFor(workerJob: WorkerJob): Promise<number | undefined> {
    const visibleAt = this.workerJobRepository.getWorkerJobVisibleAt;

    if (visibleAt === undefined) {
      return this.retryVisibleAtByJobId.get(String(workerJob.id));
    }

    return visibleAt.call(this.workerJobRepository, workerJob.id);
  }

  private async setWorkerJobVisibility(
    jobId: JobId,
    visibleAtEpochMilliseconds: number,
  ): Promise<void> {
    this.retryVisibleAtByJobId.set(String(jobId), visibleAtEpochMilliseconds);
    await this.workerJobRepository.setWorkerJobVisibleAt?.(jobId, visibleAtEpochMilliseconds);
  }

  private async clearWorkerJobVisibility(jobId: JobId): Promise<void> {
    this.retryVisibleAtByJobId.delete(String(jobId));
    await this.workerJobRepository.clearWorkerJobVisibleAt?.(jobId);
  }

  private async findReservableWorkerJob(workType: QueueWorkType): Promise<WorkerJob | undefined> {
    const candidates = [
      ...(await this.workerJobRepository.findByStatus("queued")),
      ...(await this.workerJobRepository.findByStatus("retrying")),
    ];

    for (const candidate of candidates) {
      if (
        isSupportedWorkerJob(candidate) &&
        candidate.workType === workType &&
        (await this.isWorkerJobVisible(candidate))
      ) {
        return candidate;
      }
    }

    return undefined;
  }

  private async loadWorkerJob(jobId: JobId): Promise<WorkerJob> {
    const workerJob = await this.workerJobRepository.load(jobId);

    if (workerJob === undefined) {
      throw new DurableQueueProviderError("worker_job_missing", "WorkerJob is missing.");
    }

    if (!isSupportedWorkerJob(workerJob)) {
      throw new DurableQueueProviderError(
        "unsupported_work_type",
        "WorkerJob work type is unsupported.",
      );
    }

    return workerJob;
  }

  private async receiptFor(workerJob: WorkerJob): Promise<QueueVisibilityReceipt> {
    return Object.freeze({
      jobId: workerJob.id,
      visible: await this.isWorkerJobVisible(workerJob),
      queueRef: queueRefFor(workerJob),
    });
  }

  private async isWorkerJobVisible(workerJob: WorkerJob): Promise<boolean> {
    switch (workerJob.status) {
      case "queued":
        return true;
      case "retrying":
        return ((await this.visibleAtFor(workerJob)) ?? 0) <= this.now();
      case "dead":
        return true;
      case "reserved":
      case "running":
      case "completed":
        return false;
    }
  }

  private async recordBacklogMetrics(workType: QueueWorkType): Promise<void> {
    const visibleJobs = await this.visibleBacklogJobs(workType);
    const oldestVisibleAt = await this.oldestVisibleAt(visibleJobs);
    const oldestPendingAge =
      oldestVisibleAt === undefined ? 0 : Math.max(0, this.now() - oldestVisibleAt);

    this.recordCatalogMetric("queue.backlog.depth", visibleJobs.length, { work_type: workType });
    this.recordCatalogMetric("queue.backlog.oldest_pending_age", oldestPendingAge, {
      work_type: workType,
    });
  }

  private async visibleBacklogJobs(workType: QueueWorkType): Promise<readonly WorkerJob[]> {
    const candidates = [
      ...(await this.workerJobRepository.findByStatus("queued")),
      ...(await this.workerJobRepository.findByStatus("retrying")),
    ].filter((job) => isSupportedWorkerJob(job) && job.workType === workType);

    const visibleJobs: WorkerJob[] = [];

    for (const job of candidates) {
      if (await this.isWorkerJobVisible(job)) {
        visibleJobs.push(job);
      }
    }

    return Object.freeze(visibleJobs);
  }

  private async oldestVisibleAt(jobs: readonly WorkerJob[]): Promise<number | undefined> {
    let oldest: number | undefined;

    for (const job of jobs) {
      const visibleAt = (await this.visibleAtFor(job)) ?? this.now();
      oldest = oldest === undefined ? visibleAt : Math.min(oldest, visibleAt);
    }

    return oldest;
  }

  private recordCatalogMetric(
    name: "queue.backlog.depth" | "queue.backlog.oldest_pending_age",
    value: number,
    labels: Record<"work_type", QueueWorkType>,
  ): void {
    try {
      this.metricRecorder?.recordMetric(
        createCatalogMetricPoint(name, {
          value,
          labels: toSafeLogFields({
            work_type: classifyValue(labels.work_type, "public"),
          }),
          observedAtEpochMilliseconds: this.now(),
        }),
      );
    } catch {
      return;
    }
  }

  private recordQueueMetric(name: string, workType: QueueWorkType, result: string): void {
    this.recordMetric(name, 1, "counter", {
      workType,
      result,
    });
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

  private async capturePortFailure<T>(action: () => Promise<T>): Promise<ApplicationPortResult<T>> {
    try {
      return ok(await action());
    } catch (error) {
      return err(toApplicationPortFailure(error));
    }
  }

  private now(): number {
    return this.clock.epochMilliseconds();
  }
}

class DurableQueueProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly failureCategory: FailureCategory = "queue",
  ) {
    super(message);
  }
}

function reservationFor(workerJob: WorkerJob, attempt: number): QueueReservation {
  return Object.freeze({
    jobId: workerJob.id,
    reservationRef: reservationRefFor(workerJob, attempt),
    attempt,
    ownerContext: workerJob.ownerContext,
    ownerRef: ownerRefFor(workerJob),
    workType: toQueueWorkType(workerJob.workType),
    ...optional("safeInputRef", workerJob.safeMetadata?.outboundIntentRef),
    ...optional("safeMetadata", workerJob.safeMetadata),
  });
}

function nextReservationAttempt(workerJob: WorkerJob): number {
  return workerJob.status === "retrying" && workerJob.attemptNumber !== undefined
    ? workerJob.attemptNumber
    : (workerJob.attemptNumber ?? 0) + 1;
}

function assertActiveReservation(workerJob: WorkerJob, reservation: QueueReservation): void {
  if (workerJob.status !== "reserved" && workerJob.status !== "running") {
    throw new DurableQueueProviderError(
      "reservation_not_active",
      "Queue reservation is not active.",
      false,
      "worker",
    );
  }

  if (workerJob.attemptNumber !== reservation.attempt) {
    throw new DurableQueueProviderError(
      "reservation_attempt_mismatch",
      "Queue reservation attempt does not match visible queue state.",
      false,
      "worker",
    );
  }

  if (reservation.reservationRef !== reservationRefFor(workerJob, reservation.attempt)) {
    throw new DurableQueueProviderError("stale_reservation", "Queue reservation is stale.");
  }
}

function queueRefFor(workerJob: WorkerJob): string {
  return `${workerJob.workType}:${workerJob.id}`;
}

function reservationRefFor(workerJob: WorkerJob, attempt: number): string {
  return `${workerJob.workType}:${workerJob.id}:attempt:${attempt}`;
}

function ownerRefFor(workerJob: WorkerJob): string {
  return workerJob.safeMetadata?.messageId ?? String(workerJob.id);
}

function isSupportedWorkerJob(workerJob: WorkerJob): boolean {
  return isQueueWorkType(workerJob.workType);
}

function isQueueWorkType(value: string): value is QueueWorkType {
  return queueWorkTypes.includes(value as QueueWorkType);
}

function toQueueWorkType(value: string): QueueWorkType {
  if (!isQueueWorkType(value)) {
    throw new DurableQueueProviderError(
      "unsupported_work_type",
      "WorkerJob work type is unsupported.",
    );
  }

  return value;
}

function toApplicationPortFailure(error: unknown): ApplicationPortFailure {
  if (error instanceof DurableQueueProviderError) {
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
    code: "durable_queue_provider_unexpected_failure",
    message: "Durable queue provider failed unexpectedly.",
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

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
