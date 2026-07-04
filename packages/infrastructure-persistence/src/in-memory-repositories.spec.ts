import {
  acceptMediaAsset,
  acceptMessage,
  activateConfigurationSnapshot,
  activateSession,
  activateWebhookSubscription,
  activateGroup,
  captureTelemetrySignal,
  classifyDegraded,
  createChat,
  createChatId,
  createAccessDecisionId,
  createAuditRecordId,
  createConfigurationSnapshotId,
  createContact,
  createContactDisplayName,
  createContactId,
  createGuardrailDecisionId,
  createGroup,
  createGroupId,
  createHealthStatus,
  createHealthStatusId,
  createIdempotencyKey,
  createInstance,
  createInstanceId,
  createJid,
  createJobId,
  createLabel,
  createLabelId,
  createMediaAsset,
  createMediaId,
  createMessageId,
  createOutboundMessageIntent,
  createPhoneNumber,
  createProviderId,
  createProviderProfile,
  createRetentionPolicy,
  createRetryPolicy,
  createSession,
  createSessionId,
  createTelemetrySignalId,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookSubscription,
  createWebhookUrl,
  evaluateGuardrailDecision,
  expireAuditRetention,
  expireSession,
  grantAccessDecision,
  markInstanceConnected,
  markInstanceConnecting,
  markMediaProcessing,
  markMediaProcessed,
  markProviderSupported,
  projectTelemetrySignal,
  proposeConfigurationSnapshot,
  queueMessage,
  queueWorkerJob,
  requestAccessDecision,
  requestAuditRecord,
  requestGuardrailDecision,
  sanitizeTelemetrySignal,
  scheduleWebhookDelivery,
  startSessionPairing,
  validateConfigurationSnapshot,
  validateWebhookSubscription,
} from "@omniwa/domain";
import { describe, expect, it } from "vitest";

import { createInMemoryRepositorySet } from "./in-memory-repositories.js";
import {
  describeChatRepositoryContract,
  describeContactRepositoryContract,
  describeGroupRepositoryContract,
  describeGuardrailDecisionRepositoryContract,
  describeHealthStatusRepositoryContract,
  describeInstanceRepositoryContract,
  describeMessageRepositoryContract,
  describeSessionRepositoryContract,
  describeWebhookDeliveryRepositoryContract,
  describeWebhookSubscriptionRepositoryContract,
  describeWorkerJobRepositoryContract,
} from "./repository-contracts.spec-helper.js";

const retryPolicy = createRetryPolicy({
  maxAttempts: 3,
  initialDelayMilliseconds: 100,
  backoffMultiplier: 2,
});

const messageRetention = createRetentionPolicy({
  category: "message_metadata",
  retentionDays: 30,
});

const auditRetention = createRetentionPolicy({
  category: "audit_record",
  retentionDays: 180,
});

describeInstanceRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().instanceRepository,
});

describeSessionRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().sessionRepository,
});

describeMessageRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().messageRepository,
});

describeChatRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().chatRepository,
});

describeContactRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().contactRepository,
});

describeGroupRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().groupRepository,
});

describeGuardrailDecisionRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().guardrailDecisionRepository,
});

describeHealthStatusRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().healthStatusRepository,
});

describeWebhookSubscriptionRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().webhookSubscriptionRepository,
});

describeWebhookDeliveryRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().webhookDeliveryRepository,
});

describeWorkerJobRepositoryContract({
  name: "in-memory",
  create: () => createInMemoryRepositorySet().workerJobRepository,
});

describe("in-memory repository adapters", () => {
  it("persists owner aggregates and reads them through approved repository methods", async () => {
    const repositories = createInMemoryRepositorySet();
    const instanceId = createInstanceId("instance-repo-1");
    const sessionId = createSessionId("session-repo-1");
    const messageId = createMessageId("message-repo-1");
    const guardrailId = createGuardrailDecisionId("guardrail-repo-1");
    const mediaId = createMediaId("media-repo-1");
    const chatId = createChatId("chat-repo-1");
    const contactId = createContactId("contact-repo-1");
    const labelId = createLabelId("label-repo-1");
    const groupId = createGroupId("group-repo-1");

    const session = activateSession(startSessionPairing(createSession(sessionId, instanceId)));
    const instance = markInstanceConnected(
      markInstanceConnecting(createInstance(instanceId)),
      sessionId,
    );
    const guardrailDecision = evaluateGuardrailDecision(
      requestGuardrailDecision(guardrailId, "message-repo-intent"),
    );
    const message = queueMessage(
      acceptMessage(
        createOutboundMessageIntent({
          id: messageId,
          instanceId,
          type: "text",
          retentionPolicy: messageRetention,
        }),
        guardrailId,
      ),
    );
    const media = markMediaProcessed(
      markMediaProcessing(acceptMediaAsset(createMediaAsset(mediaId, "image", messageRetention))),
    );
    const label = createLabel({
      id: labelId,
      instanceId,
      name: "Repository Label",
    });
    const chat = createChat({
      id: chatId,
      instanceId,
      jid: createJid("12345@s.whatsapp.net"),
      labelIds: [labelId],
    });
    const contact = createContact({
      id: contactId,
      instanceId,
      jid: createJid("12345@s.whatsapp.net"),
      displayName: createContactDisplayName("Repository Contact"),
      phoneNumber: createPhoneNumber("+12025550123"),
    });
    const group = activateGroup(
      createGroup({
        id: groupId,
        instanceId,
        jid: createJid("12345@g.us"),
        metadata: {
          subject: "Repository Group",
        },
      }),
    );

    await repositories.sessionRepository.save(session);
    await repositories.instanceRepository.save(instance);
    await repositories.guardrailDecisionRepository.save(guardrailDecision);
    await repositories.messageRepository.save(message);
    await repositories.mediaAssetRepository.save(media);
    await repositories.labelRepository.save(label);
    await repositories.chatRepository.save(chat);
    await repositories.contactRepository.save(contact);
    await repositories.groupRepository.save(group);
    repositories.mediaAssetRepository.markRequiringCleanup(mediaId);

    await expect(repositories.instanceRepository.load(instanceId)).resolves.toEqual(instance);
    await expect(repositories.instanceRepository.getCurrentSessionId(instanceId)).resolves.toBe(
      sessionId,
    );
    await expect(repositories.instanceRepository.findNonTerminal()).resolves.toEqual([instance]);
    await expect(repositories.sessionRepository.findByInstance(instanceId)).resolves.toEqual([
      session,
    ]);
    await expect(
      repositories.sessionRepository.findByStatusForInstance(instanceId, "active"),
    ).resolves.toEqual([session]);
    await expect(
      repositories.guardrailDecisionRepository.findByEvaluatedIntent("message-repo-intent"),
    ).resolves.toEqual(guardrailDecision);
    await expect(repositories.messageRepository.findByStatus("queued")).resolves.toEqual([message]);
    await expect(repositories.mediaAssetRepository.findByStatus("processed")).resolves.toEqual([
      media,
    ]);
    await expect(repositories.mediaAssetRepository.findRequiringCleanup()).resolves.toEqual([
      media,
    ]);
    await expect(repositories.labelRepository.findByInstance(instanceId)).resolves.toEqual([label]);
    await expect(repositories.labelRepository.findByStatus("active")).resolves.toEqual([label]);
    await expect(repositories.chatRepository.findByInstance(instanceId)).resolves.toEqual([chat]);
    await expect(repositories.chatRepository.findByStatus("open")).resolves.toEqual([chat]);
    await expect(repositories.chatRepository.findByLabel(labelId)).resolves.toEqual([chat]);
    await expect(
      repositories.chatRepository.findByJid(createJid("12345@s.whatsapp.net")),
    ).resolves.toEqual(chat);
    await expect(repositories.contactRepository.findByInstance(instanceId)).resolves.toEqual([
      contact,
    ]);
    await expect(repositories.contactRepository.findByStatus("discovered")).resolves.toEqual([
      contact,
    ]);
    await expect(
      repositories.contactRepository.findByJid(createJid("12345@s.whatsapp.net")),
    ).resolves.toEqual(contact);
    await expect(repositories.groupRepository.findByInstance(instanceId)).resolves.toEqual([group]);
    await expect(repositories.groupRepository.findByStatus("active")).resolves.toEqual([group]);
    await expect(repositories.groupRepository.findByJid(createJid("12345@g.us"))).resolves.toEqual(
      group,
    );
  });

  it("keeps implementation-only indexes outside aggregate state", async () => {
    const repositories = createInMemoryRepositorySet();
    const instanceId = createInstanceId("instance-index-1");
    const messageId = createMessageId("message-index-1");
    const webhookId = createWebhookId("webhook-index-1");
    const deliveryId = createWebhookDeliveryId("webhook-delivery-index-1");
    const jobId = createJobId("job-index-1");
    const accessDecisionId = createAccessDecisionId("access-index-1");
    const auditRecordId = createAuditRecordId("audit-index-1");

    const message = createOutboundMessageIntent({
      id: messageId,
      instanceId,
      type: "text",
    });
    const webhook = activateWebhookSubscription(
      validateWebhookSubscription(
        createWebhookSubscription(webhookId, createWebhookUrl("https://webhook.example.test/a")),
      ),
    );
    const delivery = scheduleWebhookDelivery(
      deliveryId,
      webhookId,
      "message_accepted_v1",
      retryPolicy,
    );
    const workerJob = queueWorkerJob(jobId, "operations", "outbound_message", retryPolicy);
    const accessDecision = grantAccessDecision(
      requestAccessDecision(accessDecisionId, "operator", "instance_write"),
    );
    const auditRecord = expireAuditRetention(
      requestAuditRecord(auditRecordId, "instance_change", auditRetention),
    );

    await repositories.messageRepository.save(message);
    await repositories.webhookSubscriptionRepository.save(webhook);
    await repositories.webhookDeliveryRepository.save(delivery);
    await repositories.workerJobRepository.save(workerJob);
    await repositories.accessDecisionRepository.save(accessDecision);
    await repositories.auditRecordRepository.save(auditRecord);

    repositories.messageRepository.recordIdempotencyKey(
      createIdempotencyKey("message-idempotency-1"),
      messageId,
    );
    repositories.webhookSubscriptionRepository.recordSignalSelection(webhookId, [
      "message_accepted_v1",
    ]);
    repositories.webhookDeliveryRepository.recordIdempotencyKey(
      createIdempotencyKey("webhook-idempotency-1"),
      deliveryId,
    );
    repositories.workerJobRepository.recordIdempotencyKey(
      createIdempotencyKey("job-idempotency-1"),
      jobId,
    );
    repositories.accessDecisionRepository.recordTargetContext(accessDecisionId, "instance_index_1");
    repositories.auditRecordRepository.recordSourceSignal(auditRecordId, "instance.created.v1");

    await expect(
      repositories.messageRepository.findByIdempotencyKey(
        createIdempotencyKey("message-idempotency-1"),
      ),
    ).resolves.toEqual(message);
    await expect(
      repositories.webhookSubscriptionRepository.findActiveForSignal("message_accepted_v1"),
    ).resolves.toEqual([webhook]);
    await expect(
      repositories.webhookDeliveryRepository.findByIdempotencyKey(
        createIdempotencyKey("webhook-idempotency-1"),
      ),
    ).resolves.toEqual(delivery);
    await expect(
      repositories.workerJobRepository.findByIdempotencyKey(
        createIdempotencyKey("job-idempotency-1"),
      ),
    ).resolves.toEqual(workerJob);
    await expect(
      repositories.accessDecisionRepository.findUnexpiredByCapability(
        "operator",
        "instance_write",
        "instance_index_1",
      ),
    ).resolves.toEqual(accessDecision);
    await expect(
      repositories.auditRecordRepository.findBySourceSignal("instance.created.v1"),
    ).resolves.toEqual([auditRecord]);
    await expect(repositories.auditRecordRepository.findRetentionExpired()).resolves.toEqual([
      auditRecord,
    ]);
  });

  it("supports operational projection-owned aggregates without becoming business logic", async () => {
    const repositories = createInMemoryRepositorySet();
    const providerId = createProviderId("provider-repo-1");
    const healthId = createHealthStatusId("health-repo-1");
    const configurationId = createConfigurationSnapshotId("config-repo-1");
    const telemetryId = createTelemetrySignalId("telemetry-repo-1");
    const sessionId = createSessionId("session-recovery-1");
    const instanceId = createInstanceId("instance-recovery-1");

    const provider = markProviderSupported(createProviderProfile(providerId, "baileys"), ["text"]);
    const health = classifyDegraded(createHealthStatus(healthId, "provider_baileys"), "provider");
    const activeConfiguration = activateConfigurationSnapshot(
      validateConfigurationSnapshot(proposeConfigurationSnapshot(configurationId, "valid")),
    );
    const telemetry = projectTelemetrySignal(
      sanitizeTelemetrySignal(captureTelemetrySignal(telemetryId, "worker")),
    );
    const expiredSession = expireSession(startSessionPairing(createSession(sessionId, instanceId)));

    await repositories.providerProfileRepository.save(provider);
    await repositories.healthStatusRepository.save(health);
    await repositories.configurationSnapshotRepository.save(activeConfiguration);
    await repositories.telemetrySignalRepository.save(telemetry);
    await repositories.sessionRepository.save(expiredSession);

    await expect(repositories.providerProfileRepository.findSupportedOrDegraded()).resolves.toEqual(
      [provider],
    );
    await expect(
      repositories.healthStatusRepository.findBySubject("provider_baileys"),
    ).resolves.toEqual(health);
    await expect(repositories.healthStatusRepository.findByCategory("degraded")).resolves.toEqual([
      health,
    ]);
    await expect(repositories.configurationSnapshotRepository.findActive()).resolves.toEqual(
      activeConfiguration,
    );
    await expect(repositories.telemetrySignalRepository.findCaptured()).resolves.toEqual([]);
    await expect(repositories.sessionRepository.findRecoveryRequired()).resolves.toEqual([
      expiredSession,
    ]);
  });
});
