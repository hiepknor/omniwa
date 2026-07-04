import {
  activateContact,
  activateGroup,
  createInstance,
  createInstanceId,
  createAttemptNumber,
  createChat,
  createChatId,
  createContact,
  createContactDisplayName,
  createContactId,
  createGroup,
  createGroupId,
  createGuardrailDecisionAggregate,
  createHealthStatusAggregate,
  createHealthStatusId,
  createIdempotencyKey,
  createJobId,
  createGuardrailDecisionId,
  createJid,
  createLabelId,
  createRetryPolicy,
  createSessionId,
  createMessageId,
  createMessageType,
  createOutboundMessageAggregate,
  createSessionAggregate,
  activateSession,
  activateWebhookSubscription,
  expireSession,
  createWebhookDeliveryAggregate,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookSubscriptionAggregate,
  createWebhookUrl,
  queueMessage,
  validateWebhookSubscription,
  markInstanceConnected,
  markInstanceConnecting,
  markMessageProcessing,
  queueWorkerJob,
  reserveWorkerJob,
  type InstanceRepositoryPort,
  type IdempotencyKey,
  type ChatRepositoryPort,
  type ContactRepositoryPort,
  type GroupRepositoryPort,
  type GuardrailDecisionRepositoryPort,
  type HealthStatusRepositoryPort,
  type JobId,
  type MessageId,
  type MessageRepositoryPort,
  type SessionRepositoryPort,
  type WebhookDeliveryId,
  type WebhookDeliveryRepositoryPort,
  type WebhookId,
  type WebhookSubscriptionRepositoryPort,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import { beforeEach, describe, expect, it } from "vitest";

export type InstanceRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): InstanceRepositoryPort;
}>;

export function describeInstanceRepositoryContract(
  factory: InstanceRepositoryContractFactory,
): void {
  describe(`${factory.name} InstanceRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and reports aggregate existence by InstanceId", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-load`);
      const instance = createInstance(instanceId);

      await expect(repository.exists(instanceId)).resolves.toBe(false);
      await repository.save(instance);

      await expect(repository.exists(instanceId)).resolves.toBe(true);
      await expect(repository.load(instanceId)).resolves.toEqual(instance);
    });

    it("filters instances by lifecycle status without returning destroyed instances as non-terminal", async () => {
      const repository = factory.create();
      const created = createInstance(
        createInstanceId(`${safeFactoryName(factory.name)}-instance-created`),
      );
      const connected = markInstanceConnected(
        markInstanceConnecting(
          createInstance(createInstanceId(`${safeFactoryName(factory.name)}-instance-connected`)),
        ),
        createSessionId(`${safeFactoryName(factory.name)}-session-connected`),
      );

      await repository.save(created);
      await repository.save(connected);

      await expect(repository.findByStatus("created")).resolves.toEqual([created]);
      await expect(repository.findByStatus("connected")).resolves.toEqual([connected]);
      const nonTerminal = await repository.findNonTerminal();

      expect(nonTerminal).toHaveLength(2);
      expect(nonTerminal).toEqual(expect.arrayContaining([created, connected]));
    });

    it("returns the current SessionId owned by the Instance aggregate", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-session`);
      const sessionId = createSessionId(`${safeFactoryName(factory.name)}-session-current`);
      const instance = markInstanceConnected(
        markInstanceConnecting(createInstance(instanceId)),
        sessionId,
      );

      await repository.save(instance);

      await expect(repository.getCurrentSessionId(instanceId)).resolves.toBe(sessionId);
    });
  });
}

export type WorkerJobRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): WorkerJobRepositoryPort &
    Partial<{
      recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): Promise<void> | void;
    }>;
}>;

export function describeWorkerJobRepositoryContract(
  factory: WorkerJobRepositoryContractFactory,
): void {
  describe(`${factory.name} WorkerJobRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and reports aggregate existence by JobId", async () => {
      const repository = factory.create();
      const jobId = createJobId(`${safeFactoryName(factory.name)}-job-load`);
      const safeMetadata = {
        jobKind: "outbound_message",
        instanceId: `${safeFactoryName(factory.name)}-instance-safe-meta`,
        messageId: `${safeFactoryName(factory.name)}-message-safe-meta`,
        outboundIntentRef: `${safeFactoryName(factory.name)}-intent-safe-meta`,
      };
      const workerJob = queueWorkerJob(
        jobId,
        "operations",
        "outbound_message",
        standardRetryPolicy(),
        safeMetadata,
      );

      await expect(repository.exists(jobId)).resolves.toBe(false);
      await repository.save(workerJob);

      await expect(repository.exists(jobId)).resolves.toBe(true);
      await expect(repository.load(jobId)).resolves.toEqual(workerJob);
    });

    it("filters jobs by status and owner context", async () => {
      const repository = factory.create();
      const queued = queueWorkerJob(
        createJobId(`${safeFactoryName(factory.name)}-job-queued`),
        "operations",
        "outbound_message",
        standardRetryPolicy(),
      );
      const reserved = reserveWorkerJob(
        queueWorkerJob(
          createJobId(`${safeFactoryName(factory.name)}-job-reserved`),
          "webhook_delivery",
          "webhook_delivery",
          standardRetryPolicy(),
        ),
        createAttemptNumber(1),
      );

      await repository.save(queued);
      await repository.save(reserved);

      await expect(repository.findByStatus("queued")).resolves.toEqual([queued]);
      await expect(repository.findByStatus("reserved")).resolves.toEqual([reserved]);
      await expect(repository.findByOwnerContext("operations")).resolves.toEqual([queued]);
      await expect(repository.findByOwnerContext("webhook_delivery")).resolves.toEqual([reserved]);
    });

    it("resolves idempotency keys when the adapter supports the optional index", async () => {
      const repository = factory.create();
      const recordIdempotencyKey = repository.recordIdempotencyKey;

      if (recordIdempotencyKey === undefined) {
        return;
      }

      const jobId = createJobId(`${safeFactoryName(factory.name)}-job-idempotency`);
      const idempotencyKey = createIdempotencyKey(`${safeFactoryName(factory.name)}-idem-job`);
      const workerJob = queueWorkerJob(
        jobId,
        "operations",
        "outbound_message",
        standardRetryPolicy(),
      );

      await repository.save(workerJob);
      await recordIdempotencyKey.call(repository, idempotencyKey, jobId);

      await expect(repository.findByIdempotencyKey(idempotencyKey)).resolves.toEqual(workerJob);
    });
  });
}

export type MessageRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): MessageRepositoryPort &
    Partial<{
      recordIdempotencyKey(
        idempotencyKey: IdempotencyKey,
        messageId: MessageId,
      ): Promise<void> | void;
    }>;
}>;

export function describeMessageRepositoryContract(factory: MessageRepositoryContractFactory): void {
  describe(`${factory.name} MessageRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and reports aggregate existence by MessageId", async () => {
      const repository = factory.create();
      const messageId = createMessageId(`${safeFactoryName(factory.name)}-message-load`);
      const message = createOutboundMessageAggregate({
        id: messageId,
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-message-load`),
        type: createMessageType("text"),
      });

      await expect(repository.exists(messageId)).resolves.toBe(false);
      await repository.save(message);

      await expect(repository.exists(messageId)).resolves.toBe(true);
      await expect(repository.load(messageId)).resolves.toEqual(message);
    });

    it("filters messages by status and recoverable owner", async () => {
      const repository = factory.create();
      const accepted = createOutboundMessageAggregate({
        id: createMessageId(`${safeFactoryName(factory.name)}-message-accepted`),
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-message-accepted`),
        type: createMessageType("text"),
        guardrailDecisionId: createGuardrailDecisionId(
          `${safeFactoryName(factory.name)}-guardrail-accepted`,
        ),
      });
      const queued = queueMessage(accepted);
      const processing = markMessageProcessing(
        queueMessage(
          createOutboundMessageAggregate({
            id: createMessageId(`${safeFactoryName(factory.name)}-message-processing`),
            instanceId: createInstanceId(
              `${safeFactoryName(factory.name)}-instance-message-processing`,
            ),
            type: createMessageType("text"),
            guardrailDecisionId: createGuardrailDecisionId(
              `${safeFactoryName(factory.name)}-guardrail-processing`,
            ),
          }),
        ),
      );

      await repository.save(queued);
      await repository.save(processing);

      await expect(repository.findByStatus("queued")).resolves.toEqual([queued]);
      await expect(repository.findByStatus("processing")).resolves.toEqual([processing]);
      const recoverable = await repository.findRecoverableByOwner("messaging");
      expect(recoverable).toHaveLength(2);
      expect(recoverable).toEqual(expect.arrayContaining([queued, processing]));
      await expect(repository.findRecoverableByOwner("operations")).resolves.toEqual([]);
    });

    it("resolves idempotency keys when the adapter supports the optional index", async () => {
      const repository = factory.create();
      const recordIdempotencyKey = repository.recordIdempotencyKey;

      if (recordIdempotencyKey === undefined) {
        return;
      }

      const messageId = createMessageId(`${safeFactoryName(factory.name)}-message-idempotency`);
      const idempotencyKey = createIdempotencyKey(`${safeFactoryName(factory.name)}-idem-message`);
      const message = createOutboundMessageAggregate({
        id: messageId,
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-idempotency`),
        type: createMessageType("text"),
      });

      await repository.save(message);
      await recordIdempotencyKey.call(repository, idempotencyKey, messageId);

      await expect(repository.findByIdempotencyKey(idempotencyKey)).resolves.toEqual(message);
    });
  });
}

export type SessionRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): SessionRepositoryPort;
}>;

export function describeSessionRepositoryContract(factory: SessionRepositoryContractFactory): void {
  describe(`${factory.name} SessionRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and reports aggregate existence by SessionId", async () => {
      const repository = factory.create();
      const sessionId = createSessionId(`${safeFactoryName(factory.name)}-session-load`);
      const session = createSessionAggregate({
        id: sessionId,
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-session-load`),
      });

      await expect(repository.exists(sessionId)).resolves.toBe(false);
      await repository.save(session);

      await expect(repository.exists(sessionId)).resolves.toBe(true);
      await expect(repository.load(sessionId)).resolves.toEqual(session);
    });

    it("filters sessions by instance, instance status, and recovery requirement", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-sessions`);
      const active = activateSession(
        createSessionAggregate({
          id: createSessionId(`${safeFactoryName(factory.name)}-session-active`),
          instanceId,
          startPairing: true,
        }),
      );
      const expired = expireSession(
        activateSession(
          createSessionAggregate({
            id: createSessionId(`${safeFactoryName(factory.name)}-session-expired`),
            instanceId,
            startPairing: true,
          }),
        ),
      );
      const other = createSessionAggregate({
        id: createSessionId(`${safeFactoryName(factory.name)}-session-other-instance`),
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-other`),
      });

      await repository.save(active);
      await repository.save(expired);
      await repository.save(other);

      const byInstance = await repository.findByInstance(instanceId);
      expect(byInstance).toHaveLength(2);
      expect(byInstance).toEqual(expect.arrayContaining([active, expired]));
      await expect(repository.findByStatusForInstance(instanceId, "active")).resolves.toEqual([
        active,
      ]);
      await expect(repository.findRecoveryRequired()).resolves.toEqual([expired]);
    });
  });
}

export type ChatRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): ChatRepositoryPort;
}>;

export function describeChatRepositoryContract(factory: ChatRepositoryContractFactory): void {
  describe(`${factory.name} ChatRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters chats by instance, status, JID, and label", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-chat`);
      const labelId = createLabelId(`${safeFactoryName(factory.name)}-label-chat`);
      const chat = createChat({
        id: createChatId(`${safeFactoryName(factory.name)}-chat-load`),
        instanceId,
        jid: createJid("12025550123@s.whatsapp.net"),
        labelIds: [labelId],
      });
      const other = createChat({
        id: createChatId(`${safeFactoryName(factory.name)}-chat-other`),
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-chat-other`),
        jid: createJid("12025550124@s.whatsapp.net"),
      });

      await expect(repository.exists(chat.id)).resolves.toBe(false);
      await repository.save(chat);
      await repository.save(other);

      await expect(repository.exists(chat.id)).resolves.toBe(true);
      await expect(repository.load(chat.id)).resolves.toEqual(chat);
      await expect(repository.findByInstance(instanceId)).resolves.toEqual([chat]);
      await expect(repository.findByStatus("open")).resolves.toEqual([chat, other]);
      await expect(repository.findByJid(chat.jid)).resolves.toEqual(chat);
      await expect(repository.findByLabel(labelId)).resolves.toEqual([chat]);
      await expect(
        repository.findByLabel(createLabelId(`${safeFactoryName(factory.name)}-label-missing`)),
      ).resolves.toEqual([]);
    });
  });
}

export type ContactRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): ContactRepositoryPort;
}>;

export function describeContactRepositoryContract(factory: ContactRepositoryContractFactory): void {
  describe(`${factory.name} ContactRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters contacts by instance, status, and JID", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-contact`);
      const contact = activateContact(
        createContact({
          id: createContactId(`${safeFactoryName(factory.name)}-contact-load`),
          instanceId,
          jid: createJid("12025550125@s.whatsapp.net"),
          displayName: createContactDisplayName("Repository Contract Contact"),
        }),
      );
      const other = createContact({
        id: createContactId(`${safeFactoryName(factory.name)}-contact-other`),
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-contact-other`),
        jid: createJid("12025550126@s.whatsapp.net"),
      });

      await expect(repository.exists(contact.id)).resolves.toBe(false);
      await repository.save(contact);
      await repository.save(other);

      await expect(repository.exists(contact.id)).resolves.toBe(true);
      await expect(repository.load(contact.id)).resolves.toEqual(contact);
      await expect(repository.findByInstance(instanceId)).resolves.toEqual([contact]);
      await expect(repository.findByStatus("active")).resolves.toEqual([contact]);
      await expect(repository.findByStatus("discovered")).resolves.toEqual([other]);
      await expect(repository.findByJid(contact.jid)).resolves.toEqual(contact);
    });
  });
}

export type GroupRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): GroupRepositoryPort;
}>;

export function describeGroupRepositoryContract(factory: GroupRepositoryContractFactory): void {
  describe(`${factory.name} GroupRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters groups by instance, status, and JID", async () => {
      const repository = factory.create();
      const instanceId = createInstanceId(`${safeFactoryName(factory.name)}-instance-group`);
      const group = activateGroup(
        createGroup({
          id: createGroupId(`${safeFactoryName(factory.name)}-group-load`),
          instanceId,
          jid: createJid("12025550127@g.us"),
          metadata: {
            subject: "Repository Contract Group",
          },
        }),
      );
      const other = createGroup({
        id: createGroupId(`${safeFactoryName(factory.name)}-group-other`),
        instanceId: createInstanceId(`${safeFactoryName(factory.name)}-instance-group-other`),
        jid: createJid("12025550128@g.us"),
        metadata: {
          subject: "Repository Contract Other Group",
        },
      });

      await expect(repository.exists(group.id)).resolves.toBe(false);
      await repository.save(group);
      await repository.save(other);

      await expect(repository.exists(group.id)).resolves.toBe(true);
      await expect(repository.load(group.id)).resolves.toEqual(group);
      await expect(repository.findByInstance(instanceId)).resolves.toEqual([group]);
      await expect(repository.findByStatus("active")).resolves.toEqual([group]);
      await expect(repository.findByStatus("discovered")).resolves.toEqual([other]);
      await expect(repository.findByJid(group.jid)).resolves.toEqual(group);
    });
  });
}

export type GuardrailDecisionRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): GuardrailDecisionRepositoryPort;
}>;

export function describeGuardrailDecisionRepositoryContract(
  factory: GuardrailDecisionRepositoryContractFactory,
): void {
  describe(`${factory.name} GuardrailDecisionRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and resolves decisions by evaluated intent", async () => {
      const repository = factory.create();
      const evaluatedIntentRef = `${safeFactoryName(factory.name)}-message-intent`;
      const decision = createGuardrailDecisionAggregate({
        id: createGuardrailDecisionId(`${safeFactoryName(factory.name)}-guardrail-load`),
        evaluatedIntentRef,
        outcome: "allow",
        reasonCode: "repository_contract_pass",
      });

      await expect(repository.exists(decision.id)).resolves.toBe(false);
      await repository.save(decision);

      await expect(repository.exists(decision.id)).resolves.toBe(true);
      await expect(repository.load(decision.id)).resolves.toEqual(decision);
      await expect(repository.findByEvaluatedIntent(evaluatedIntentRef)).resolves.toEqual(decision);
      await expect(repository.findByEvaluatedIntent("missing-intent")).resolves.toBeUndefined();
    });
  });
}

export type HealthStatusRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): HealthStatusRepositoryPort;
}>;

export function describeHealthStatusRepositoryContract(
  factory: HealthStatusRepositoryContractFactory,
): void {
  describe(`${factory.name} HealthStatusRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters health status by subject and category", async () => {
      const repository = factory.create();
      const subjectRef = `${safeFactoryName(factory.name)}-provider-runtime`;
      const degraded = createHealthStatusAggregate({
        id: createHealthStatusId(`${safeFactoryName(factory.name)}-health-degraded`),
        subjectRef,
        category: "degraded",
        causeCategory: "provider",
      });
      const healthy = createHealthStatusAggregate({
        id: createHealthStatusId(`${safeFactoryName(factory.name)}-health-healthy`),
        subjectRef: `${safeFactoryName(factory.name)}-api-runtime`,
        category: "healthy",
      });

      await expect(repository.exists(degraded.id)).resolves.toBe(false);
      await repository.save(degraded);
      await repository.save(healthy);

      await expect(repository.exists(degraded.id)).resolves.toBe(true);
      await expect(repository.load(degraded.id)).resolves.toEqual(degraded);
      await expect(repository.findBySubject(subjectRef)).resolves.toEqual(degraded);
      await expect(repository.findBySubject("missing-health-subject")).resolves.toBeUndefined();
      await expect(repository.findByCategory("degraded")).resolves.toEqual([degraded]);
      await expect(repository.findByCategory("healthy")).resolves.toEqual([healthy]);
    });
  });
}

export type WebhookSubscriptionRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): WebhookSubscriptionRepositoryPort &
    Partial<{
      recordSignalSelection(
        webhookId: WebhookId,
        sourceSignalRefs: readonly string[],
      ): Promise<void> | void;
    }>;
}>;

export function describeWebhookSubscriptionRepositoryContract(
  factory: WebhookSubscriptionRepositoryContractFactory,
): void {
  describe(`${factory.name} WebhookSubscriptionRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters subscriptions by status", async () => {
      const repository = factory.create();
      const webhookId = createWebhookId(`${safeFactoryName(factory.name)}-webhook-load`);
      const subscription = createWebhookSubscriptionAggregate({
        id: webhookId,
        targetUrl: createWebhookUrl("https://example.test/omniwa-webhook"),
      });

      await expect(repository.exists(webhookId)).resolves.toBe(false);
      await repository.save(subscription);

      await expect(repository.exists(webhookId)).resolves.toBe(true);
      await expect(repository.load(webhookId)).resolves.toEqual(subscription);
      await expect(repository.findByStatus("proposed")).resolves.toEqual([subscription]);
    });

    it("resolves active subscriptions by signal selection when the adapter supports the optional index", async () => {
      const repository = factory.create();
      const recordSignalSelection = repository.recordSignalSelection;

      if (recordSignalSelection === undefined) {
        return;
      }

      const webhookId = createWebhookId(`${safeFactoryName(factory.name)}-webhook-signal`);
      const subscription = activateWebhookSubscription(
        validateWebhookSubscription(
          createWebhookSubscriptionAggregate({
            id: webhookId,
            targetUrl: createWebhookUrl("https://example.test/omniwa-signal"),
          }),
        ),
      );

      await repository.save(subscription);
      await recordSignalSelection.call(repository, webhookId, ["signal_alpha", "signal_beta"]);

      await expect(repository.findActiveForSignal("signal_alpha")).resolves.toEqual([subscription]);
      await expect(repository.findActiveForSignal("signal_unknown")).resolves.toEqual([]);
    });
  });
}

export type WebhookDeliveryRepositoryContractFactory = Readonly<{
  name: string;
  beforeEach?: () => Promise<void> | void;
  create(): WebhookDeliveryRepositoryPort &
    Partial<{
      recordIdempotencyKey(
        idempotencyKey: IdempotencyKey,
        deliveryId: WebhookDeliveryId,
      ): Promise<void> | void;
    }>;
}>;

export function describeWebhookDeliveryRepositoryContract(
  factory: WebhookDeliveryRepositoryContractFactory,
): void {
  describe(`${factory.name} WebhookDeliveryRepositoryPort contract`, () => {
    beforeEach(async () => {
      await factory.beforeEach?.();
    });

    it("saves, loads, and filters deliveries by status and source signal", async () => {
      const repository = factory.create();
      const deliveryId = createWebhookDeliveryId(`${safeFactoryName(factory.name)}-delivery-load`);
      const delivery = createWebhookDeliveryAggregate({
        id: deliveryId,
        webhookId: createWebhookId(`${safeFactoryName(factory.name)}-webhook-delivery`),
        sourceSignalRef: "signal_delivery_alpha",
        retryPolicy: standardRetryPolicy(),
      });

      await expect(repository.exists(deliveryId)).resolves.toBe(false);
      await repository.save(delivery);

      await expect(repository.exists(deliveryId)).resolves.toBe(true);
      await expect(repository.load(deliveryId)).resolves.toEqual(delivery);
      await expect(repository.findByStatus("pending")).resolves.toEqual([delivery]);
      await expect(repository.findBySourceSignal("signal_delivery_alpha")).resolves.toEqual([
        delivery,
      ]);
      await expect(repository.findBySourceSignal("signal_delivery_unknown")).resolves.toEqual([]);
    });

    it("resolves idempotency keys when the adapter supports the optional index", async () => {
      const repository = factory.create();
      const recordIdempotencyKey = repository.recordIdempotencyKey;

      if (recordIdempotencyKey === undefined) {
        return;
      }

      const deliveryId = createWebhookDeliveryId(
        `${safeFactoryName(factory.name)}-delivery-idempotency`,
      );
      const idempotencyKey = createIdempotencyKey(`${safeFactoryName(factory.name)}-idem-delivery`);
      const delivery = createWebhookDeliveryAggregate({
        id: deliveryId,
        webhookId: createWebhookId(`${safeFactoryName(factory.name)}-webhook-idempotency`),
        sourceSignalRef: "signal_delivery_idempotency",
        retryPolicy: standardRetryPolicy(),
      });

      await repository.save(delivery);
      await recordIdempotencyKey.call(repository, idempotencyKey, deliveryId);

      await expect(repository.findByIdempotencyKey(idempotencyKey)).resolves.toEqual(delivery);
    });
  });
}

function standardRetryPolicy(): ReturnType<typeof createRetryPolicy> {
  return createRetryPolicy({
    maxAttempts: 3,
    initialDelayMilliseconds: 100,
    backoffMultiplier: 2,
  });
}

function safeFactoryName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_:-]+/gu, "-");
}
