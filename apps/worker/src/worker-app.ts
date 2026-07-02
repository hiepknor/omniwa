import type { ApplicationPortContext, QueueProviderPort } from "@omniwa/application";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

import { WorkerRuntime, type WorkerRuntimeTickResult } from "./worker-runtime.js";
import { workerRuntimeActorRef } from "./worker-application-handlers.js";

export type QueueRecoveryCapableProvider = QueueProviderPort &
  Readonly<{
    recoverVisibleJobs?: () => Promise<Readonly<{ recovered: number }>>;
  }>;

export type WorkerRuntimeAppOptions = Readonly<{
  runtime: WorkerRuntime;
  queueProvider?: QueueRecoveryCapableProvider;
  contextFactory?: () => ApplicationPortContext;
}>;

export type WorkerRuntimeRecoveryResult = Readonly<{
  recovered: number;
  supported: boolean;
}>;

export class WorkerRuntimeApp {
  private readonly runtime: WorkerRuntime;
  private readonly queueProvider: QueueRecoveryCapableProvider | undefined;
  private readonly contextFactory: () => ApplicationPortContext;

  constructor(options: WorkerRuntimeAppOptions) {
    this.runtime = options.runtime;
    this.queueProvider = options.queueProvider;
    this.contextFactory = options.contextFactory ?? createWorkerRuntimeContext;
  }

  runOnce(
    context: ApplicationPortContext = this.contextFactory(),
  ): Promise<WorkerRuntimeTickResult> {
    return this.runtime.runOnce(context);
  }

  async recoverVisibleJobs(): Promise<WorkerRuntimeRecoveryResult> {
    const recovery = await this.queueProvider?.recoverVisibleJobs?.();

    if (recovery === undefined) {
      return Object.freeze({
        recovered: 0,
        supported: false,
      });
    }

    return Object.freeze({
      recovered: recovery.recovered,
      supported: true,
    });
  }
}

export function createWorkerRuntimeContext(): ApplicationPortContext {
  const id = randomUUID();

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`worker:${id}`),
      requestId: createRequestId(`worker:${id}`),
    }),
    actorRef: workerRuntimeActorRef,
    idempotencyKey: `worker:${id}`,
    dataClassification: "internal",
  });
}
