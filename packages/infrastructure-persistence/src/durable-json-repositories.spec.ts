import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateSession,
  activateWebhookSubscription,
  activateGroup,
  createGroup,
  createGroupId,
  createIdempotencyKey,
  createInstance,
  createInstanceId,
  createJid,
  createJobId,
  createMessageId,
  createOutboundMessageIntent,
  createRetryPolicy,
  createSession,
  createSessionId,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookSubscription,
  createWebhookUrl,
  markInstanceConnected,
  markInstanceConnecting,
  queueWorkerJob,
  scheduleWebhookDelivery,
  startSessionPairing,
  validateWebhookSubscription,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createDurableJsonReadProjectionStore } from "./durable-json-read-projection-store.js";
import { createDurableJsonRepositorySet } from "./durable-json-repositories.js";

const temporaryDirectories: string[] = [];

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

describe("durable JSON repository adapters", () => {
  it("persists aggregates and implementation indexes across repository instances", async () => {
    const directory = createTemporaryDirectory();
    const firstRepositorySet = createDurableJsonRepositorySet(directory);
    const instanceId = createInstanceId("instance-durable-1");
    const sessionId = createSessionId("session-durable-1");
    const messageId = createMessageId("message-durable-1");
    const groupId = createGroupId("group-durable-1");
    const webhookId = createWebhookId("webhook-durable-1");
    const deliveryId = createWebhookDeliveryId("webhook-delivery-durable-1");
    const jobId = createJobId("job-durable-1");

    const session = activateSession(startSessionPairing(createSession(sessionId, instanceId)));
    const instance = markInstanceConnected(
      markInstanceConnecting(createInstance(instanceId)),
      sessionId,
    );
    const message = createOutboundMessageIntent({
      id: messageId,
      instanceId,
      type: "text",
    });
    const group = activateGroup(
      createGroup({
        id: groupId,
        instanceId,
        jid: createJid("23456@g.us"),
        metadata: {
          subject: "Durable Group",
        },
      }),
    );
    const webhook = activateWebhookSubscription(
      validateWebhookSubscription(
        createWebhookSubscription(webhookId, createWebhookUrl("https://webhook.example.test/a")),
      ),
    );
    const webhookDelivery = scheduleWebhookDelivery(
      deliveryId,
      webhookId,
      "message.accepted.v1",
      retryPolicy,
    );
    const workerJob = queueWorkerJob(jobId, "operations", "outbound_message", retryPolicy);

    await firstRepositorySet.instanceRepository.save(instance);
    await firstRepositorySet.sessionRepository.save(session);
    await firstRepositorySet.messageRepository.save(message);
    await firstRepositorySet.groupRepository.save(group);
    await firstRepositorySet.webhookSubscriptionRepository.save(webhook);
    await firstRepositorySet.webhookDeliveryRepository.save(webhookDelivery);
    await firstRepositorySet.workerJobRepository.save(workerJob);
    firstRepositorySet.messageRepository.recordIdempotencyKey(
      createIdempotencyKey("message-durable-idempotency"),
      messageId,
    );
    firstRepositorySet.webhookSubscriptionRepository.recordSignalSelection(webhookId, [
      "message.accepted.v1",
    ]);
    firstRepositorySet.webhookDeliveryRepository.recordIdempotencyKey(
      createIdempotencyKey("webhook-durable-idempotency"),
      deliveryId,
    );
    firstRepositorySet.workerJobRepository.recordIdempotencyKey(
      createIdempotencyKey("job-durable-idempotency"),
      jobId,
    );

    const secondRepositorySet = createDurableJsonRepositorySet(directory);

    await expect(secondRepositorySet.instanceRepository.load(instanceId)).resolves.toEqual(
      instance,
    );
    await expect(secondRepositorySet.sessionRepository.findByInstance(instanceId)).resolves.toEqual(
      [session],
    );
    await expect(secondRepositorySet.groupRepository.findByInstance(instanceId)).resolves.toEqual([
      group,
    ]);
    await expect(
      secondRepositorySet.groupRepository.findByJid(createJid("23456@g.us")),
    ).resolves.toEqual(group);
    await expect(
      secondRepositorySet.messageRepository.findByIdempotencyKey(
        createIdempotencyKey("message-durable-idempotency"),
      ),
    ).resolves.toEqual(message);
    await expect(
      secondRepositorySet.webhookSubscriptionRepository.findActiveForSignal("message.accepted.v1"),
    ).resolves.toEqual([webhook]);
    await expect(
      secondRepositorySet.webhookDeliveryRepository.findByIdempotencyKey(
        createIdempotencyKey("webhook-durable-idempotency"),
      ),
    ).resolves.toEqual(webhookDelivery);
    await expect(
      secondRepositorySet.workerJobRepository.findByIdempotencyKey(
        createIdempotencyKey("job-durable-idempotency"),
      ),
    ).resolves.toEqual(workerJob);
  });

  it("persists read projections for rebuildable platform views", async () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "read-projections.json");
    const firstStore = createDurableJsonReadProjectionStore(filePath);

    await firstStore.project(
      {
        projectionName: "EventLogProjection",
        projectionKey: "events",
        model: [{ cursor: "cursor_1", type: "message.accepted.v1" }],
        refreshedAtEpochMilliseconds: 1234,
        version: "v1",
      },
      {
        requestContext: createRequestContext({
          correlationId: createCorrelationId("corr-durable-projection"),
        }),
      },
    );

    const secondStore = createDurableJsonReadProjectionStore(filePath);
    const result = await secondStore.read(
      {
        projectionName: "EventLogProjection",
        projectionKey: "events",
      },
      {
        requestContext: createRequestContext({
          correlationId: createCorrelationId("corr-durable-projection"),
        }),
      },
    );

    expect(result.ok ? result.value : undefined).toEqual({
      model: [{ cursor: "cursor_1", type: "message.accepted.v1" }],
      consistency: "retention_bound",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1234,
      },
    });
    expect(secondStore.listStoredProjectionsByName("EventLogProjection")).toHaveLength(1);
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-durable-json-"));
  temporaryDirectories.push(directory);

  return directory;
}
