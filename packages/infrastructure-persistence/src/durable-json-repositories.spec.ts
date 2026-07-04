import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateSession,
  activateWebhookSubscription,
  activateGroup,
  createChat,
  createChatId,
  createContact,
  createContactDisplayName,
  createContactId,
  createGroup,
  createGroupId,
  createIdempotencyKey,
  createInstance,
  createInstanceId,
  createJid,
  createJobId,
  createLabel,
  createLabelId,
  createMessageId,
  createOutboundMessageIntent,
  createPhoneNumber,
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
import {
  describeInstanceRepositoryContract,
  describeMessageRepositoryContract,
  describeWorkerJobRepositoryContract,
} from "./repository-contracts.spec-helper.js";

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

describeInstanceRepositoryContract({
  name: "durable-json",
  create: () => createDurableJsonRepositorySet(createTemporaryDirectory()).instanceRepository,
});

describeMessageRepositoryContract({
  name: "durable-json",
  create: () => createDurableJsonRepositorySet(createTemporaryDirectory()).messageRepository,
});

describeWorkerJobRepositoryContract({
  name: "durable-json",
  create: () => createDurableJsonRepositorySet(createTemporaryDirectory()).workerJobRepository,
});

describe("durable JSON repository adapters", () => {
  it("persists WorkerJob safe metadata without raw outbound payload", async () => {
    const directory = createTemporaryDirectory();
    const repositorySet = createDurableJsonRepositorySet(directory);
    const rawRecipient = "12025550123@s.whatsapp.net";
    const rawText = "secret durable worker text";
    const safeMetadata = Object.freeze({
      jobKind: "outbound_message",
      instanceId: "inst-durable-worker-metadata",
      messageId: "msg-durable-worker-metadata",
      outboundIntentRef: "intent-durable-worker-metadata",
    });
    const workerJob = queueWorkerJob(
      createJobId("job-durable-worker-metadata"),
      "messaging",
      "outbound_message",
      retryPolicy,
      safeMetadata,
    );

    await repositorySet.workerJobRepository.save(workerJob);

    const persisted = readFileSync(join(directory, "worker-jobs.json"), "utf8");

    expect(persisted).toContain(safeMetadata.messageId);
    expect(persisted).toContain(safeMetadata.instanceId);
    expect(persisted).toContain(safeMetadata.outboundIntentRef);
    expect(persisted).not.toContain(rawRecipient);
    expect(persisted).not.toContain(rawText);
    await expect(repositorySet.workerJobRepository.load(workerJob.id)).resolves.toEqual(workerJob);
  });

  it("persists aggregates and implementation indexes across repository instances", async () => {
    const directory = createTemporaryDirectory();
    const firstRepositorySet = createDurableJsonRepositorySet(directory);
    const instanceId = createInstanceId("instance-durable-1");
    const sessionId = createSessionId("session-durable-1");
    const messageId = createMessageId("message-durable-1");
    const chatId = createChatId("chat-durable-1");
    const contactId = createContactId("contact-durable-1");
    const labelId = createLabelId("label-durable-1");
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
    const label = createLabel({
      id: labelId,
      instanceId,
      name: "Durable Label",
    });
    const chat = createChat({
      id: chatId,
      instanceId,
      jid: createJid("34567@s.whatsapp.net"),
      labelIds: [labelId],
    });
    const contact = createContact({
      id: contactId,
      instanceId,
      jid: createJid("34567@s.whatsapp.net"),
      displayName: createContactDisplayName("Durable Contact"),
      phoneNumber: createPhoneNumber("+12025550124"),
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
    await firstRepositorySet.labelRepository.save(label);
    await firstRepositorySet.chatRepository.save(chat);
    await firstRepositorySet.contactRepository.save(contact);
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
    await expect(secondRepositorySet.labelRepository.findByStatus("active")).resolves.toEqual([
      label,
    ]);
    await expect(secondRepositorySet.chatRepository.findByLabel(labelId)).resolves.toEqual([chat]);
    await expect(
      secondRepositorySet.chatRepository.findByJid(createJid("34567@s.whatsapp.net")),
    ).resolves.toEqual(chat);
    await expect(secondRepositorySet.contactRepository.findByInstance(instanceId)).resolves.toEqual(
      [contact],
    );
    await expect(
      secondRepositorySet.contactRepository.findByJid(createJid("34567@s.whatsapp.net")),
    ).resolves.toEqual(contact);
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
