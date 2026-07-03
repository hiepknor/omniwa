import {
  createApplicationDispatcher,
  createDomainEventPublisher,
  createOutboundMessageIntentRef,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type MessagingProviderPort,
  type ProviderCapabilitySummary,
  type ProviderConnectionRequest,
  type ProviderConnectionResult,
  type ProviderOutboundMessageRequest,
  type ProviderOutboundMessageResult,
  type ProviderQrPairingChallenge,
  type ProviderQrPairingRequest,
  type QueueWorkRequest,
} from "@omniwa/application";
import {
  acceptMessage,
  activateSession,
  createGuardrailDecisionId,
  createInstance,
  createInstanceId,
  createJobId,
  createMessageId,
  createOutboundMessageIntent,
  createRetryPolicy,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  markMessageProcessing,
  markMessageSent,
  queueMessage,
  queueWorkerJob,
  startSessionPairing,
  type ProviderId,
  type WorkerJob,
  type WorkerJobSafeMetadata,
} from "@omniwa/domain";
import {
  InMemoryOutboundMessageIntentStore,
  createInMemoryEventLogStore,
  createInMemoryRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { WorkerRuntimeApp } from "./worker-app.js";
import { createApplicationWorkerHandlers } from "./worker-application-handlers.js";
import { WorkerRuntime } from "./worker-runtime.js";

const instanceId = createInstanceId("inst-worker-recovery");
const sessionId = createSessionId("session-worker-recovery");
const messageId = createMessageId("msg-worker-recovery");
const jobId = createJobId("job-worker-recovery");
const outboundIntentRef = createOutboundMessageIntentRef("intent-worker-recovery");
const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});
const safeMetadata: WorkerJobSafeMetadata = Object.freeze({
  jobKind: "outbound_message",
  instanceId: String(instanceId),
  messageId: String(messageId),
  outboundIntentRef: String(outboundIntentRef),
});
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    requestId: createRequestId("worker-recovery-request"),
    correlationId: createCorrelationId("worker-recovery-correlation"),
  }),
  actorRef: "worker-runtime-test",
  idempotencyKey: "worker-recovery",
  dataClassification: "internal",
};

describe("outbound message worker recovery", () => {
  it("reconstructs outboundIntentRef from persisted WorkerJob safe metadata after restart", async () => {
    const harness = await createHarness();

    await enqueueWithTransientQueue(harness);

    const app = createRecoveredWorkerApp(harness);
    const recovery = await app.recoverVisibleJobs();
    const result = await app.runOnce(context);

    expect(recovery).toEqual({ recovered: 1, supported: true });
    expect(result.completed).toBe(1);
    expect(harness.provider.requests).toHaveLength(1);
    expect(harness.provider.requests[0]).toMatchObject({
      instanceId,
      sessionId,
      messageId,
      outboundIntentRef: String(outboundIntentRef),
    });
    await expect(harness.repositories.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "sent",
    });
  });

  it("fails safe and does not call provider when recovered metadata is missing", async () => {
    const harness = await createHarness();

    await harness.repositories.workerJobRepository.save(
      queueWorkerJob(jobId, "messaging", "outbound_message", retryPolicy),
    );

    const app = createRecoveredWorkerApp(harness);
    await app.recoverVisibleJobs();
    const result = await app.runOnce(context);

    expect(result.deadLettered).toBe(1);
    expect(harness.provider.requests).toHaveLength(0);
  });

  it("fails safe and does not call provider when recovered metadata is corrupt", async () => {
    const harness = await createHarness();
    const corruptJob = Object.freeze({
      ...queueWorkerJob(jobId, "messaging", "outbound_message", retryPolicy),
      safeMetadata: Object.freeze({
        ...safeMetadata,
        outboundIntentRef: "unsafe raw ref @@",
      }),
    }) as WorkerJob;

    await harness.repositories.workerJobRepository.save(corruptJob);

    const app = createRecoveredWorkerApp(harness);
    await app.recoverVisibleJobs();
    const result = await app.runOnce(context);

    expect(result.deadLettered).toBe(1);
    expect(harness.provider.requests).toHaveLength(0);
  });

  it("does not double-send a recovered retry when the message is already sent", async () => {
    const harness = await createHarness({
      message: markMessageSent(markMessageProcessing(queuedMessage())),
    });

    await harness.repositories.workerJobRepository.save(
      queueWorkerJob(jobId, "messaging", "outbound_message", retryPolicy, safeMetadata),
    );

    const app = createRecoveredWorkerApp(harness);
    await app.recoverVisibleJobs();
    const result = await app.runOnce(context);

    expect(result.completed).toBe(1);
    expect(harness.provider.requests).toHaveLength(0);
    await expect(harness.repositories.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "sent",
    });
  });
});

async function createHarness(
  options: Readonly<{ message?: ReturnType<typeof queuedMessage> }> = {},
) {
  const repositories = createInMemoryRepositorySet();
  const intentStore = new InMemoryOutboundMessageIntentStore();
  const provider = new FakeMessagingProvider();
  const eventLog = createInMemoryEventLogStore();
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      sessionRepository: repositories.sessionRepository,
      messageRepository: repositories.messageRepository,
    },
    outboundMessageIntentStore: intentStore,
    messagingProvider: provider,
    domainEventPublisher: createDomainEventPublisher({
      eventLog,
      nowIso: () => "2026-07-03T00:00:00.000Z",
    }),
  });

  await repositories.instanceRepository.save(
    markInstanceConnected(markInstanceConnecting(createInstance(instanceId)), sessionId),
  );
  await repositories.sessionRepository.save(
    activateSession(startSessionPairing(createSession(sessionId, instanceId))),
  );
  await repositories.messageRepository.save(options.message ?? queuedMessage());
  await intentStore.storeTextIntent(
    {
      outboundIntentRef,
      recipientRef: "12025550123@s.whatsapp.net",
      text: "secret worker recovery text",
    },
    context,
  );

  return Object.freeze({
    repositories,
    intentStore,
    provider,
    dispatcher,
  });
}

async function enqueueWithTransientQueue(
  harness: Awaited<ReturnType<typeof createHarness>>,
): Promise<void> {
  const queue = new InMemoryQueueProvider({
    workerJobRepository: harness.repositories.workerJobRepository,
  });
  const result = await queue.enqueue(workRequest(), context);

  if (!result.ok) {
    throw new Error(`Expected enqueue to succeed but got ${result.error.code}.`);
  }
}

function createRecoveredWorkerApp(harness: Awaited<ReturnType<typeof createHarness>>) {
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: harness.repositories.workerJobRepository,
  });
  const runtime = new WorkerRuntime({
    queueProvider,
    handlers: createApplicationWorkerHandlers({
      dispatcher: harness.dispatcher,
      retryDelayMilliseconds: 50,
    }),
  });

  return new WorkerRuntimeApp({
    runtime,
    queueProvider,
    contextFactory: () => context,
  });
}

function workRequest(): QueueWorkRequest {
  return {
    jobId,
    ownerContext: "messaging",
    ownerRef: String(messageId),
    workType: "outbound_message",
    retryPolicy,
    idempotencyKey: "worker-recovery-idempotency",
    safeInputRef: String(outboundIntentRef),
    safeMetadata,
  };
}

function queuedMessage() {
  return queueMessage(
    acceptMessage(
      createOutboundMessageIntent({
        id: messageId,
        instanceId,
        type: "text",
      }),
      createGuardrailDecisionId("guardrail-worker-recovery"),
    ),
  );
}

class FakeMessagingProvider implements MessagingProviderPort {
  readonly requests: ProviderOutboundMessageRequest[] = [];

  requestConnection(
    request: ProviderConnectionRequest,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "connected",
      }),
    );
  }

  requestQrPairing(
    request: ProviderQrPairingRequest,
  ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> {
    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        sessionId: request.sessionId,
        challengeRef: "qr-worker-recovery",
        dataClassification: "secret",
      }),
    );
  }

  disconnect(
    request: ProviderConnectionRequest,
  ): Promise<ApplicationPortResult<ProviderConnectionResult>> {
    return Promise.resolve(
      ok({
        instanceId: request.instanceId,
        providerId: request.providerId,
        state: "disconnected",
      }),
    );
  }

  sendOutboundMessage(
    request: ProviderOutboundMessageRequest,
  ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> {
    this.requests.push(request);

    return Promise.resolve(
      ok({
        messageId: request.messageId,
        status: "accepted",
        retryable: false,
      }),
    );
  }

  getCapabilitySummary(
    providerId: ProviderId,
  ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    return Promise.resolve(
      ok({
        providerId,
        supportedMessageTypes: ["text"],
        degraded: false,
      }),
    );
  }
}
