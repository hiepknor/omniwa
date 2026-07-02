import {
  createApplicationCommandOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationDispatcher,
  type ApplicationPortContext,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
  type QueueWorkRequest,
} from "@omniwa/application";
import { createJobId, createRetryPolicy, type JobId, type JobStatus } from "@omniwa/domain";
import { createInMemoryRepositorySet } from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { WorkerRuntimeApp } from "./worker-app.js";
import {
  createApplicationWorkerHandlers,
  defaultWorkerCommandByWorkType,
} from "./worker-application-handlers.js";
import { WorkerRuntime } from "./worker-runtime.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("worker-application-correlation"),
    requestId: createRequestId("worker-application-request"),
  }),
  actorRef: "worker-runtime-test",
  idempotencyKey: "worker-application-request",
  dataClassification: "internal",
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

describe("Application worker handlers", () => {
  it("maps every queue work type to an approved worker command", () => {
    expect(defaultWorkerCommandByWorkType).toEqual({
      outbound_message: "ProcessOutboundMessageWork",
      media_processing: "ProcessMediaWork",
      webhook_delivery: "DeliverWebhookWork",
      reconnect: "ReconnectInstance",
      retention_cleanup: "CleanupMediaRetention",
      health_refresh: "RefreshHealthStatus",
    });
  });

  it("processes queued work through Application and completes WorkerJob state", async () => {
    const scenario = createWorkerScenario({
      outcome: "completed",
      accepted: true,
      retryable: false,
    });
    const jobId = await scenario.enqueue("outbound-message-job-1");

    const result = await scenario.app.runOnce(context);

    expect(result.completed).toBe(1);
    expect(scenario.dispatcher.commands).toHaveLength(1);
    expect(scenario.dispatcher.commands[0]).toMatchObject({
      name: "ProcessOutboundMessageWork",
      targetRef: String(jobId),
      actorRef: "worker-runtime-test",
      dataClassification: "internal",
    });
    await expect(scenario.repositories.workerJobRepository.load(jobId)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("releases retryable Application failures back to the queue", async () => {
    const scenario = createWorkerScenario({
      outcome: "failed",
      accepted: false,
      retryable: true,
      reasonCode: "provider_unavailable",
    });
    const jobId = await scenario.enqueue("outbound-message-job-retry");

    const result = await scenario.app.runOnce(context);

    expect(result.retried).toBe(1);
    await expectStatus(scenario.repositories.workerJobRepository.load(jobId), "retrying");
  });

  it("dead-letters non-retryable Application failures", async () => {
    const scenario = createWorkerScenario({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "unsupported_message_type",
    });
    const jobId = await scenario.enqueue("outbound-message-job-dead");

    const result = await scenario.app.runOnce(context);

    expect(result.deadLettered).toBe(1);
    await expectStatus(scenario.repositories.workerJobRepository.load(jobId), "dead");
  });
});

function createWorkerScenario(outcome: DispatcherOutcomeInput) {
  const repositories = createInMemoryRepositorySet();
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: repositories.workerJobRepository,
  });
  const dispatcher = new CapturingDispatcher(outcome);
  const runtime = new WorkerRuntime({
    queueProvider,
    handlers: createApplicationWorkerHandlers({
      dispatcher,
      retryDelayMilliseconds: 50,
    }),
  });
  const app = new WorkerRuntimeApp({
    runtime,
    queueProvider,
    contextFactory: () => context,
  });

  return Object.freeze({
    repositories,
    queueProvider,
    dispatcher,
    app,
    enqueue: async (jobIdRef: string) => {
      const jobId = createJobId(jobIdRef);
      const enqueue = await queueProvider.enqueue(workRequest(jobId), context);

      if (!enqueue.ok) {
        throw new Error(`Expected enqueue to succeed but received ${enqueue.error.code}.`);
      }

      return jobId;
    },
  });
}

type DispatcherOutcomeInput = Readonly<{
  outcome: Parameters<typeof createApplicationCommandOutcome>[0]["outcome"];
  accepted: boolean;
  retryable: boolean;
  reasonCode?: string;
}>;

class CapturingDispatcher implements ApplicationDispatcher {
  readonly commands: ApplicationCommandEnvelope[] = [];

  constructor(private readonly outcome: DispatcherOutcomeInput) {}

  executeCommand(envelope: ApplicationCommandEnvelope) {
    this.commands.push(envelope);

    return Promise.resolve(
      createApplicationCommandOutcome({
        commandRef: envelope.commandRef,
        outcome: this.outcome.outcome,
        accepted: this.outcome.accepted,
        retryable: this.outcome.retryable,
        ...optional("reasonCode", this.outcome.reasonCode),
      }),
    );
  }

  executeQuery(envelope: ApplicationQueryEnvelope): Promise<ApplicationQueryOutcome> {
    void envelope;

    throw new Error("Worker handler must not execute queries.");
  }
}

function workRequest(jobId: JobId): QueueWorkRequest {
  return Object.freeze({
    jobId,
    ownerContext: "messaging",
    ownerRef: String(jobId),
    workType: "outbound_message",
    retryPolicy,
    idempotencyKey: `${jobId}:idempotency`,
  });
}

async function expectStatus(
  workerJob: Promise<Readonly<{ status: JobStatus }> | undefined>,
  status: JobStatus,
): Promise<void> {
  await expect(workerJob).resolves.toMatchObject({ status });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
