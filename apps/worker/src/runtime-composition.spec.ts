import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOutboundMessageIntentRef, type ApplicationPortContext } from "@omniwa/application";
import {
  acceptMessage,
  activateSession,
  createGuardrailDecisionId,
  createInstance,
  createInstanceId,
  createJobId,
  createMessageId,
  createOutboundMessageIntent,
  createProviderId,
  createRetryPolicy,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  queueMessage,
  startSessionPairing,
} from "@omniwa/domain";
import {
  BaileysMessagingProviderAdapter,
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
  OutboundMessageIntentBaileysResolver,
} from "@omniwa/infrastructure-provider-baileys";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkerRuntimeComposition,
  readWorkerProviderMode,
  readWorkerRepositoryProfile,
  readWorkerRuntimeProfile,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];
const instanceId = createInstanceId("worker-runtime-composition-instance");
const sessionId = createSessionId("worker-runtime-composition-session");
const messageId = createMessageId("worker-runtime-composition-message");
const providerId = createProviderId("baileys");
const outboundIntentRef = createOutboundMessageIntentRef("worker_runtime_composition_intent");
const rawRecipient = "12025550199@s.whatsapp.net";
const rawText = "private worker composition text";
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("worker-runtime-composition-correlation"),
    requestId: createRequestId("worker-runtime-composition-request"),
  }),
  actorRef: "worker-runtime-composition-test",
  idempotencyKey: "worker-runtime-composition",
  dataClassification: "internal",
};
const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Worker runtime composition", () => {
  it("composes a local in-memory worker runtime by default", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
    });

    expect(composition).toMatchObject({
      profile: "test",
      repositoryProfile: "in-memory",
      providerMode: "same-process-local-demo",
    });
    expect(composition.messagingProvider).toBeInstanceOf(BaileysMessagingProviderAdapter);
    expect(composition.outboundMessageResolver).toBeInstanceOf(
      OutboundMessageIntentBaileysResolver,
    );
    await expect(composition.app.recoverVisibleJobs()).resolves.toEqual({
      recovered: 0,
      supported: true,
    });
  });

  it("composes durable JSON repository profile when a state directory is provided", () => {
    const directory = createTemporaryDirectory();
    const composition = createWorkerRuntimeComposition({
      OMNIWA_WORKER_RUNTIME_PROFILE: "local",
      OMNIWA_WORKER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_WORKER_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
  });

  it("wires BaileysOutboundMessageResolver to the worker outbound intent store", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
    });
    const stored = await composition.outboundMessageIntentStore.storeTextIntent(
      {
        outboundIntentRef,
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );

    expect(stored.ok).toBe(true);
    expect(composition.outboundMessageResolver).toBeInstanceOf(
      OutboundMessageIntentBaileysResolver,
    );

    const resolved = await composition.outboundMessageResolver?.resolveOutboundMessage(
      providerRequest(),
      context,
    );

    expect(resolved).toEqual({
      jid: rawRecipient,
      content: {
        text: rawText,
      },
    });
  });

  it("returns a safe provider failure when local demo mode has no shared socket", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
    });
    await composition.outboundMessageIntentStore.storeTextIntent(
      {
        outboundIntentRef,
        recipientRef: rawRecipient,
        text: rawText,
      },
      context,
    );

    const result = await composition.messagingProvider.sendOutboundMessage(
      providerRequest(),
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "baileys_socket_missing",
      retryable: false,
      ownerContext: "provider_integration",
      failureCategory: "provider",
    });
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("dispatches outbound worker work through a shared fake Baileys socket in local demo mode", async () => {
    const socketProvider = new FakeBaileysSocketProvider();
    const socket = new FakeBaileysSocket();
    const composition = createWorkerRuntimeComposition(
      {
        NODE_ENV: "test",
      },
      {
        socketProvider,
      },
    );

    await seedOutboundWork(composition, socketProvider, socket);

    const result = await composition.app.runOnce(context);

    expect(result.completed).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(socket.sentMessages).toEqual([
      {
        jid: rawRecipient,
        content: {
          text: rawText,
        },
        options: undefined,
      },
    ]);
    await expect(
      composition.repositories.messageRepository?.load(messageId),
    ).resolves.toMatchObject({
      status: "sent",
    });
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("dead-letters safely when outbound worker work cannot access a shared socket", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
    });

    await seedOutboundWork(composition, new FakeBaileysSocketProvider(), new FakeBaileysSocket(), {
      registerSocket: false,
    });

    const result = await composition.app.runOnce(context);

    expect(result.completed).toBe(0);
    expect(result.deadLettered).toBe(1);
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
    await expect(
      composition.repositories.messageRepository?.load(messageId),
    ).resolves.toMatchObject({
      status: "failed",
      failureCategory: "provider",
    });
  });

  it("keeps multi-process provider mode fail-safe until IPC/shared socket ownership exists", async () => {
    const composition = createWorkerRuntimeComposition({
      NODE_ENV: "test",
      OMNIWA_WORKER_PROVIDER_MODE: "multi-process-unsupported",
    });

    expect(composition.providerMode).toBe("multi-process-unsupported");
    expect(composition.socketProvider).toBeUndefined();
    expect(composition.outboundMessageResolver).toBeUndefined();

    const result = await composition.messagingProvider.sendOutboundMessage(
      providerRequest(),
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "worker_messaging_provider_ipc_required",
      category: "unavailable",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain(rawRecipient);
    expect(JSON.stringify(result)).not.toContain(rawText);
  });

  it("falls back to API repository profile for shared local stack configuration", () => {
    expect(
      readWorkerRepositoryProfile({
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
  });

  it("rejects PostgreSQL profile without a database URL", () => {
    expect(() =>
      createWorkerRuntimeComposition({
        OMNIWA_WORKER_RUNTIME_PROFILE: "local",
        OMNIWA_WORKER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toThrow(/OMNIWA_POSTGRES_DATABASE_URL/u);
  });

  it("keeps production runtime blocked until remaining production adapters are complete", () => {
    expect(() =>
      createWorkerRuntimeComposition({
        OMNIWA_WORKER_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(/distributed queue, provider, secret, and observability adapters/u);
  });

  it("normalizes worker runtime profile values", () => {
    expect(readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "development" })).toBe(
      "local",
    );
    expect(readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "production" })).toBe(
      "production",
    );
    expect(() => readWorkerRuntimeProfile({ OMNIWA_WORKER_RUNTIME_PROFILE: "invalid" })).toThrow(
      /Unsupported OmniWA Worker runtime profile/u,
    );
  });

  it("normalizes worker provider mode values", () => {
    expect(readWorkerProviderMode({})).toBe("same-process-local-demo");
    expect(readWorkerProviderMode({ OMNIWA_WORKER_PROVIDER_MODE: "local-demo" })).toBe(
      "same-process-local-demo",
    );
    expect(
      readWorkerProviderMode({ OMNIWA_WORKER_PROVIDER_MODE: "multi-process-unsupported" }),
    ).toBe("multi-process-unsupported");
    expect(() => readWorkerProviderMode({ OMNIWA_WORKER_PROVIDER_MODE: "invalid" })).toThrow(
      /Unsupported OmniWA Worker provider mode/u,
    );
  });
});

async function seedOutboundWork(
  composition: ReturnType<typeof createWorkerRuntimeComposition>,
  socketProvider: FakeBaileysSocketProvider,
  socket: FakeBaileysSocket,
  options: Readonly<{ registerSocket?: boolean }> = {},
): Promise<void> {
  await composition.repositories.instanceRepository.save(
    markInstanceConnected(markInstanceConnecting(createInstance(instanceId)), sessionId),
  );
  await composition.repositories.sessionRepository?.save(
    activateSession(startSessionPairing(createSession(sessionId, instanceId))),
  );
  await composition.repositories.messageRepository?.save(
    queueMessage(
      acceptMessage(
        createOutboundMessageIntent({
          id: messageId,
          instanceId,
          type: "text",
        }),
        createGuardrailDecisionId("worker_runtime_composition_guardrail"),
      ),
    ),
  );
  await composition.outboundMessageIntentStore.storeTextIntent(
    {
      outboundIntentRef,
      recipientRef: rawRecipient,
      text: rawText,
    },
    context,
  );
  await composition.outboundMessageIntentStore.bindMessageIntent(
    {
      outboundIntentRef,
      messageId,
    },
    context,
  );

  if (options.registerSocket !== false) {
    socketProvider.registerSocket(
      {
        instanceId,
        providerId,
        sessionId,
        reasonCode: "worker_runtime_composition_test",
      },
      socket,
    );
  }

  const enqueue = await composition.queueProvider.enqueue(
    {
      jobId: createJobId("worker-runtime-composition-outbound-job"),
      ownerContext: "messaging",
      ownerRef: String(messageId),
      workType: "outbound_message",
      retryPolicy,
      idempotencyKey: "worker-runtime-composition-outbound-job:idempotency",
      safeInputRef: String(outboundIntentRef),
      safeMetadata: {
        messageId: String(messageId),
        instanceId: String(instanceId),
        outboundIntentRef: String(outboundIntentRef),
        jobKind: "outbound_message",
      },
    },
    context,
  );

  if (!enqueue.ok) {
    throw new Error(`Expected enqueue to succeed but received ${enqueue.error.code}.`);
  }
}

function providerRequest() {
  return {
    instanceId,
    providerId,
    sessionId,
    messageId,
    messageType: "text" as const,
    outboundIntentRef: String(outboundIntentRef),
    idempotencyKey: "worker-runtime-composition-provider-request",
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-worker-runtime-"));
  temporaryDirectories.push(directory);

  return directory;
}
