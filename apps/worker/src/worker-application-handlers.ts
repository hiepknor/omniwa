import {
  createApplicationCommandEnvelope,
  createApplicationPortFailure,
  queueWorkTypes,
  type ApplicationCommandName,
  type ApplicationDispatcher,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type QueueWorkType,
} from "@omniwa/application";
import { err, ok } from "@omniwa/shared";

import type { WorkerHandlerOutcome, WorkerJobHandler, WorkerRuntimeJob } from "./worker-runtime.js";

export const workerRuntimeActorRef = "worker-runtime";

export const defaultWorkerCommandByWorkType = Object.freeze({
  outbound_message: "ProcessOutboundMessageWork",
  media_processing: "ProcessMediaWork",
  webhook_delivery: "DeliverWebhookWork",
  reconnect: "ReconnectInstance",
  retention_cleanup: "CleanupMediaRetention",
  health_refresh: "RefreshHealthStatus",
}) satisfies Readonly<Record<QueueWorkType, ApplicationCommandName>>;

export type WorkerApplicationHandlerOptions = Readonly<{
  dispatcher: ApplicationDispatcher;
  commandByWorkType?: Partial<Readonly<Record<QueueWorkType, ApplicationCommandName>>>;
  retryDelayMilliseconds?: number;
}>;

const defaultRetryDelayMilliseconds = 5_000;

export function createApplicationWorkerHandlers(
  options: WorkerApplicationHandlerOptions,
): readonly WorkerJobHandler[] {
  const retryDelayMilliseconds = options.retryDelayMilliseconds ?? defaultRetryDelayMilliseconds;
  assertPositiveInteger(retryDelayMilliseconds, "retryDelayMilliseconds");

  const commandByWorkType = Object.freeze({
    ...defaultWorkerCommandByWorkType,
    ...(options.commandByWorkType ?? {}),
  });

  return Object.freeze(
    queueWorkTypes.map((workType) =>
      createApplicationWorkerHandler({
        dispatcher: options.dispatcher,
        workType,
        commandName: commandByWorkType[workType],
        retryDelayMilliseconds,
      }),
    ),
  );
}

type ApplicationWorkerHandlerOptions = Readonly<{
  dispatcher: ApplicationDispatcher;
  workType: QueueWorkType;
  commandName: ApplicationCommandName;
  retryDelayMilliseconds: number;
}>;

function createApplicationWorkerHandler(
  options: ApplicationWorkerHandlerOptions,
): WorkerJobHandler {
  return Object.freeze({
    workType: options.workType,
    handle: (job, context) => dispatchWorkerCommand(job, context, options),
  });
}

async function dispatchWorkerCommand(
  job: WorkerRuntimeJob,
  context: ApplicationPortContext,
  options: ApplicationWorkerHandlerOptions,
): Promise<ApplicationPortResult<WorkerHandlerOutcome>> {
  try {
    const outcome = await options.dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: options.commandName,
        commandRef: commandRefFor(job),
        requestContext: context.requestContext,
        targetRef: targetRefFor(job, options),
        actorRef: context.actorRef ?? workerRuntimeActorRef,
        idempotencyKey: idempotencyKeyFor(job, context),
        ...optional("safeInputRef", safeInputRefFor(job, options)),
        dataClassification: context.dataClassification ?? "internal",
      }),
    );

    switch (outcome.outcome) {
      case "completed":
      case "accepted":
      case "queued":
        return ok(Object.freeze({ status: "completed" }));
      case "waiting":
      case "action_required":
        return ok(
          retryOutcome(
            options.retryDelayMilliseconds,
            outcome.reasonCode ?? `${options.commandName.toLowerCase()}_not_ready`,
          ),
        );
      case "failed":
        return outcome.retryable
          ? ok(
              retryOutcome(
                options.retryDelayMilliseconds,
                outcome.reasonCode ?? `${options.commandName.toLowerCase()}_failed`,
              ),
            )
          : ok(
              deadOutcome(
                outcome.reasonCode ?? `${options.commandName.toLowerCase()}_failed_terminal`,
              ),
            );
      case "rejected":
      case "cancelled":
      case "dead_lettered":
        return ok(deadOutcome(outcome.reasonCode ?? `${options.commandName.toLowerCase()}_dead`));
    }
  } catch (error) {
    return err(toWorkerApplicationFailure(error, options.commandName));
  }
}

function retryOutcome(delayMilliseconds: number, reasonCode: string): WorkerHandlerOutcome {
  return Object.freeze({
    status: "retry",
    delayMilliseconds,
    reasonCode,
  });
}

function deadOutcome(reasonCode: string): WorkerHandlerOutcome {
  return Object.freeze({
    status: "dead",
    reasonCode,
  });
}

function commandRefFor(job: WorkerRuntimeJob): string {
  return `worker:${job.workType}:${job.reservation.jobId}:attempt:${job.reservation.attempt}`;
}

function targetRefFor(job: WorkerRuntimeJob, options: ApplicationWorkerHandlerOptions): string {
  if (
    options.commandName === "ProcessOutboundMessageWork" &&
    job.reservation.ownerRef !== undefined
  ) {
    return job.reservation.ownerRef;
  }

  return String(job.reservation.jobId);
}

function safeInputRefFor(
  job: WorkerRuntimeJob,
  options: ApplicationWorkerHandlerOptions,
): string | undefined {
  if (options.commandName !== "ProcessOutboundMessageWork") {
    return undefined;
  }

  return job.reservation.safeInputRef;
}

function idempotencyKeyFor(job: WorkerRuntimeJob, context: ApplicationPortContext): string {
  const prefix = context.idempotencyKey ?? "worker";

  return `${prefix}:${job.workType}:${job.reservation.jobId}:attempt:${job.reservation.attempt}`;
}

function toWorkerApplicationFailure(
  error: unknown,
  commandName: ApplicationCommandName,
): ReturnType<typeof createApplicationPortFailure> {
  const safeMetadata =
    error instanceof Error
      ? Object.freeze({
          errorName: error.name,
          commandName,
        })
      : Object.freeze({ commandName });

  return createApplicationPortFailure({
    category: "unknown",
    code: "worker_application_dispatch_failed",
    message: "Worker Application command dispatch failed before a safe outcome was recorded.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: "unexpected",
    safeMetadata,
  });
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
