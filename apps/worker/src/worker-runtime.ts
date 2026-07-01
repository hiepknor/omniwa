import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type QueueProviderPort,
  type QueueReservation,
  type QueueVisibilityReceipt,
  type QueueWorkType,
} from "@omniwa/application";
import { err } from "@omniwa/shared";

export type WorkerHandlerOutcome =
  | Readonly<{
      status: "completed";
    }>
  | Readonly<{
      status: "retry";
      delayMilliseconds: number;
      reasonCode: string;
    }>
  | Readonly<{
      status: "dead";
      reasonCode: string;
    }>;

export type WorkerJobHandler = Readonly<{
  workType: QueueWorkType;
  handle(
    job: WorkerRuntimeJob,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WorkerHandlerOutcome>>;
}>;

export type WorkerRuntimeJob = Readonly<{
  workType: QueueWorkType;
  reservation: QueueReservation;
}>;

export type WorkerRuntimeOptions = Readonly<{
  queueProvider: QueueProviderPort;
  handlers: readonly WorkerJobHandler[];
  unexpectedFailureRetryDelayMilliseconds?: number;
}>;

export type WorkerRuntimeTickResult = Readonly<{
  attempted: number;
  completed: number;
  retried: number;
  deadLettered: number;
  idle: number;
  failed: number;
  outcomes: readonly WorkerRuntimeJobOutcome[];
}>;

export type WorkerRuntimeJobOutcome = Readonly<{
  workType: QueueWorkType;
  status: "completed" | "retried" | "dead_lettered" | "idle" | "failed";
  reservation?: QueueReservation;
  receipt?: QueueVisibilityReceipt;
  failure?: ApplicationPortFailure;
}>;

const defaultUnexpectedFailureRetryDelayMilliseconds = 5_000;

export class WorkerRuntime {
  private readonly queueProvider: QueueProviderPort;
  private readonly handlers: readonly WorkerJobHandler[];
  private readonly unexpectedFailureRetryDelayMilliseconds: number;

  constructor(options: WorkerRuntimeOptions) {
    this.queueProvider = options.queueProvider;
    this.handlers = Object.freeze([...options.handlers]);
    this.unexpectedFailureRetryDelayMilliseconds =
      options.unexpectedFailureRetryDelayMilliseconds ??
      defaultUnexpectedFailureRetryDelayMilliseconds;
    assertPositiveInteger(
      this.unexpectedFailureRetryDelayMilliseconds,
      "unexpectedFailureRetryDelayMilliseconds",
    );
    assertUniqueHandlers(this.handlers);
  }

  async runOnce(context: ApplicationPortContext): Promise<WorkerRuntimeTickResult> {
    const outcomes: WorkerRuntimeJobOutcome[] = [];

    for (const handler of this.handlers) {
      outcomes.push(await this.runHandlerOnce(handler, context));
    }

    return summarizeOutcomes(outcomes);
  }

  private async runHandlerOnce(
    handler: WorkerJobHandler,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    const reservationResult = await this.queueProvider.reserve(handler.workType, context);

    if (!reservationResult.ok) {
      return freezeOutcome({
        workType: handler.workType,
        status: "failed",
        failure: reservationResult.error,
      });
    }

    if (reservationResult.value === undefined) {
      return freezeOutcome({
        workType: handler.workType,
        status: "idle",
      });
    }

    const reservation = reservationResult.value;
    const handlerResult = await this.invokeHandler(handler, reservation, context);

    if (!handlerResult.ok) {
      return this.applyHandlerFailure(handler.workType, reservation, handlerResult.error, context);
    }

    return this.applyHandlerOutcome(handler.workType, reservation, handlerResult.value, context);
  }

  private async invokeHandler(
    handler: WorkerJobHandler,
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WorkerHandlerOutcome>> {
    try {
      return await handler.handle(
        Object.freeze({
          workType: handler.workType,
          reservation,
        }),
        context,
      );
    } catch (error) {
      return err(toWorkerRuntimeFailure(error));
    }
  }

  private async applyHandlerOutcome(
    workType: QueueWorkType,
    reservation: QueueReservation,
    outcome: WorkerHandlerOutcome,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    switch (outcome.status) {
      case "completed":
        return this.acknowledge(workType, reservation, context);
      case "retry":
        return this.releaseForRetry(workType, reservation, outcome.delayMilliseconds, context);
      case "dead":
        return this.moveToDeadLetter(workType, reservation, outcome.reasonCode, context);
    }
  }

  private async releaseUnexpectedFailure(
    workType: QueueWorkType,
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    return this.releaseForRetry(
      workType,
      reservation,
      this.unexpectedFailureRetryDelayMilliseconds,
      context,
    );
  }

  private async applyHandlerFailure(
    workType: QueueWorkType,
    reservation: QueueReservation,
    failure: ApplicationPortFailure,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    if (failure.retryable) {
      return this.releaseUnexpectedFailure(workType, reservation, context);
    }

    return this.moveToDeadLetter(workType, reservation, failure.code, context);
  }

  private async acknowledge(
    workType: QueueWorkType,
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    const acknowledgement = await this.queueProvider.acknowledge(reservation, context);

    if (!acknowledgement.ok) {
      return freezeOutcome({
        workType,
        status: "failed",
        reservation,
        failure: acknowledgement.error,
      });
    }

    return freezeOutcome({
      workType,
      status: "completed",
      reservation,
      receipt: acknowledgement.value,
    });
  }

  private async releaseForRetry(
    workType: QueueWorkType,
    reservation: QueueReservation,
    delayMilliseconds: number,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    const retry = await this.queueProvider.releaseForRetry(reservation, delayMilliseconds, context);

    if (!retry.ok) {
      return freezeOutcome({
        workType,
        status: "failed",
        reservation,
        failure: retry.error,
      });
    }

    return freezeOutcome({
      workType,
      status: "retried",
      reservation,
      receipt: retry.value,
    });
  }

  private async moveToDeadLetter(
    workType: QueueWorkType,
    reservation: QueueReservation,
    reasonCode: string,
    context: ApplicationPortContext,
  ): Promise<WorkerRuntimeJobOutcome> {
    const deadLetter = await this.queueProvider.moveToDeadLetter(reservation, reasonCode, context);

    if (!deadLetter.ok) {
      return freezeOutcome({
        workType,
        status: "failed",
        reservation,
        failure: deadLetter.error,
      });
    }

    return freezeOutcome({
      workType,
      status: "dead_lettered",
      reservation,
      receipt: deadLetter.value,
    });
  }
}

function summarizeOutcomes(outcomes: readonly WorkerRuntimeJobOutcome[]): WorkerRuntimeTickResult {
  return Object.freeze({
    attempted: outcomes.filter((outcome) => outcome.status !== "idle").length,
    completed: outcomes.filter((outcome) => outcome.status === "completed").length,
    retried: outcomes.filter((outcome) => outcome.status === "retried").length,
    deadLettered: outcomes.filter((outcome) => outcome.status === "dead_lettered").length,
    idle: outcomes.filter((outcome) => outcome.status === "idle").length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    outcomes: Object.freeze([...outcomes]),
  });
}

function assertUniqueHandlers(handlers: readonly WorkerJobHandler[]): void {
  const workTypes = new Set<QueueWorkType>();

  for (const handler of handlers) {
    if (workTypes.has(handler.workType)) {
      throw new TypeError(`Duplicate WorkerJobHandler for ${handler.workType}.`);
    }

    workTypes.add(handler.workType);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function freezeOutcome(outcome: WorkerRuntimeJobOutcome): WorkerRuntimeJobOutcome {
  return Object.freeze(outcome);
}

function toWorkerRuntimeFailure(error: unknown): ApplicationPortFailure {
  if (error instanceof Error) {
    return createApplicationPortFailure({
      category: "unknown",
      code: "worker_handler_failed",
      message: "Worker handler failed before a safe outcome was recorded.",
      retryable: true,
      ownerContext: "operations",
      failureCategory: "unexpected",
      safeMetadata: {
        errorName: error.name,
      },
    });
  }

  return createApplicationPortFailure({
    category: "unknown",
    code: "worker_handler_failed",
    message: "Worker handler failed before a safe outcome was recorded.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: "unexpected",
  });
}
