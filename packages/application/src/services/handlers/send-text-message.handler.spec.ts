import {
  acceptMessage,
  activateSession,
  createGuardrailDecisionAggregate,
  createGuardrailDecisionId,
  createInstance,
  createInstanceId,
  createMessageId,
  createOutboundMessageIntent,
  createSession,
  createSessionId,
  failMessage,
  markInstanceConnected,
  markInstanceConnecting,
  queueMessage,
  startSessionPairing,
  type DomainEvent,
  type GuardrailDecision,
  type GuardrailDecisionId,
  type GuardrailDecisionRepositoryPort,
  type IdempotencyKey,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type JobId,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type MessageStatus,
  type RepositorySaveResult,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
  type SessionStatus,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createUuid,
  err,
  ok,
  type Result,
  type UUIDGenerator,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createApplicationCommandEnvelope } from "../../commands/command-model.js";
import {
  createApplicationDispatcher,
  type ApplicationDispatcher,
} from "../application-dispatcher.js";
import { createActiveSessionResolver } from "../active-session-resolver.js";
import type {
  DomainEventPublicationReceipt,
  DomainEventPublisher,
  DomainEventPublisherInput,
} from "../domain-event-publisher.js";
import { createMinimalMessageGuardrailService } from "../minimal-message-guardrail.js";
import {
  createOutboundMessageIntentRef,
  type OutboundMessageIntentBinding,
  type OutboundMessageIntentReceipt,
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
  type StoredTextOutboundMessageIntent,
  type TextOutboundMessageIntentInput,
} from "../../ports/outbound-message-intent-store.js";
import type {
  ApplicationPortContext,
  ApplicationPortFailure,
  ApplicationPortResult,
} from "../../ports/application-port.js";
import { createApplicationPortFailure } from "../../ports/application-port.js";
import type {
  QueueProviderPort,
  QueueReservation,
  QueueVisibilityReceipt,
  QueueWorkRequest,
} from "../../ports/queue-provider.js";
import { createSendTextMessageHandler } from "./send-text-message.handler.js";
import { createRetryMessageSendHandler } from "./retry-message-send.handler.js";
import { createCancelMessageHandler } from "./cancel-message.handler.js";

const instanceId = createInstanceId("inst_send_text");
const sessionId = createSessionId("session_send_text");
const outboundIntentRef = createOutboundMessageIntentRef("intent_send_text_1");
const requestContext = createRequestContext({
  requestId: createRequestId("send-text-request"),
  correlationId: createCorrelationId("send-text-correlation"),
});
describe("send text message handler", () => {
  it("stores intent binding, creates a message, enqueues work, and publishes domain events", async () => {
    const harness = await createHarness();
    const handler = createSendTextMessageHandler(harness.handlerOptions);

    const outcome = await handler(sendTextCommand("cmd-send-text-success", "idem-send-text-1"));

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-text-success",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "msg:00000000-0000-4000-8000-000000000002",
    });
    expect(harness.intentStore.bindingFor(outboundIntentRef)).toEqual({
      outboundIntentRef,
      messageId: createMessageId("msg:00000000-0000-4000-8000-000000000002"),
    });
    expect(harness.messageRepository.list()).toHaveLength(1);
    expect(harness.messageRepository.list()[0]).toMatchObject({
      id: "msg:00000000-0000-4000-8000-000000000002",
      status: "queued",
      type: "text",
      guardrailDecisionId: "guardrail:00000000-0000-4000-8000-000000000001",
    });
    expect(harness.queueProvider.enqueued).toHaveLength(1);
    expect(harness.queueProvider.enqueued[0]).toMatchObject({
      ownerContext: "messaging",
      ownerRef: "msg:00000000-0000-4000-8000-000000000002",
      workType: "outbound_message",
      idempotencyKey: "send_text:idem-send-text-1",
      safeInputRef: String(outboundIntentRef),
      safeMetadata: {
        jobKind: "outbound_message",
        instanceId: String(instanceId),
        messageId: "msg:00000000-0000-4000-8000-000000000002",
        outboundIntentRef: String(outboundIntentRef),
      },
    });
    expect(harness.domainEventPublisher.eventNames()).toEqual([
      "GuardrailPassed",
      "MessageAccepted",
      "MessageQueued",
    ]);
  });

  it("does not enqueue twice for the same idempotency key", async () => {
    const harness = await createHarness();
    const handler = createSendTextMessageHandler(harness.handlerOptions);
    const command = sendTextCommand("cmd-send-text-duplicate", "idem-send-text-duplicate");

    const first = await handler(command);
    const second = await handler(command);

    expect(first.accepted).toBe(true);
    expect(second).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-text-duplicate",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "msg:00000000-0000-4000-8000-000000000002",
    });
    expect(harness.messageRepository.list()).toHaveLength(1);
    expect(harness.queueProvider.enqueued).toHaveLength(1);
  });

  it("does not save a message or enqueue work when guardrail blocks the intent", async () => {
    const blockedDecision = createGuardrailDecisionAggregate({
      id: createGuardrailDecisionId("guardrail_blocked_send_text"),
      evaluatedIntentRef: String(outboundIntentRef),
      outcome: "block",
      reasonCode: "minimal_guardrail_block",
    });
    const harness = await createHarness({ guardrailDecisions: [blockedDecision] });
    const handler = createSendTextMessageHandler(harness.handlerOptions);

    const outcome = await handler(
      sendTextCommand("cmd-send-text-blocked", "idem-send-text-blocked"),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-text-blocked",
      outcome: "rejected",
      accepted: false,
      retryable: false,
      reasonCode: "message_guardrail_not_passing",
    });
    expect(harness.messageRepository.list()).toHaveLength(0);
    expect(harness.queueProvider.enqueued).toHaveLength(0);
  });

  it("records a failed message when queue enqueue fails without marking it accepted", async () => {
    const harness = await createHarness({ queueFailure: true });
    const handler = createSendTextMessageHandler(harness.handlerOptions);

    const outcome = await handler(
      sendTextCommand("cmd-send-text-queue-fail", "idem-send-text-queue"),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-text-queue-fail",
      outcome: "failed",
      accepted: false,
      retryable: true,
      reasonCode: "queue_enqueue_failed",
      resultRef: "msg:00000000-0000-4000-8000-000000000002",
    });
    expect(harness.queueProvider.enqueued).toHaveLength(0);
    expect(harness.messageRepository.list()).toHaveLength(1);
    expect(harness.messageRepository.list()[0]).toMatchObject({
      id: "msg:00000000-0000-4000-8000-000000000002",
      status: "failed",
    });
    expect(harness.messageRepository.list()[0]?.guardrailDecisionId).toBeUndefined();
  });

  it("does not expose raw text or JID in failures or public command outcomes", async () => {
    const rawJid = "84999999999@s.whatsapp.net";
    const rawText = "super secret message body";
    const harness = await createHarness({ rawJid, rawText, queueFailure: true });
    const handler = createSendTextMessageHandler(harness.handlerOptions);

    const outcome = await handler(
      sendTextCommand("cmd-send-text-redaction", "idem-send-text-redact"),
    );
    const serialized = JSON.stringify({
      outcome,
      messages: harness.messageRepository.list(),
      enqueued: harness.queueProvider.enqueued,
      events: harness.domainEventPublisher.eventNames(),
    });

    expect(serialized).not.toContain(rawJid);
    expect(serialized).not.toContain(rawText);
    expect(serialized).not.toContain("super secret");
  });

  it("keeps commands without registered handlers as not implemented", async () => {
    const harness = await createHarness();
    const dispatcher = createDispatcher(harness);

    const outcome = await dispatcher.executeCommand(
      createApplicationCommandEnvelope({
        name: "SendMediaMessage",
        commandRef: "cmd-send-media-message",
        requestContext,
        actorRef: "api_key:test",
        targetRef: String(instanceId),
        idempotencyKey: "idem-send-media-message",
        safeInputRef: "media_ref_1",
      }),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-send-media-message",
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "application_handler_not_implemented",
    });
  });

  it("retries a failed accepted message as a new queued message without exposing raw payload", async () => {
    const guardrailDecisionId = createGuardrailDecisionId("guardrail_retry_original");
    const harness = await createHarness({
      guardrailDecisions: [
        createGuardrailDecisionAggregate({
          id: guardrailDecisionId,
          evaluatedIntentRef: String(outboundIntentRef),
          outcome: "allow",
          reasonCode: "minimal_guardrail_pass",
        }),
      ],
      rawJid: "84999999999@s.whatsapp.net",
      rawText: "secret retry text",
    });
    const original = failedQueuedMessage("msg_retry_original", guardrailDecisionId);
    await harness.messageRepository.save(original);
    await harness.intentStore.bindMessageIntent(
      {
        outboundIntentRef,
        messageId: original.id,
      },
      applicationContext("bind-original-retry"),
    );
    const handler = createRetryMessageSendHandler(harness.handlerOptions);

    const outcome = await handler(
      retryMessageCommand("cmd-retry-message", "idem-retry-message", original.id),
    );
    const serialized = JSON.stringify({
      outcome,
      messages: harness.messageRepository.list(),
      enqueued: harness.queueProvider.enqueued,
      events: harness.domainEventPublisher.inputs,
    });

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-retry-message",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "msg:00000000-0000-4000-8000-000000000002",
    });
    expect(harness.messageRepository.list()).toHaveLength(2);
    expect(harness.messageRepository.list()[1]).toMatchObject({
      id: "msg:00000000-0000-4000-8000-000000000002",
      status: "queued",
      type: "text",
    });
    expect(harness.queueProvider.enqueued).toHaveLength(1);
    expect(harness.queueProvider.enqueued[0]).toMatchObject({
      ownerContext: "messaging",
      ownerRef: "msg:00000000-0000-4000-8000-000000000002",
      workType: "outbound_message",
      idempotencyKey: "retry_message:idem-retry-message",
      safeInputRef: String(outboundIntentRef),
      safeMetadata: {
        jobKind: "outbound_message",
        instanceId: String(instanceId),
        messageId: "msg:00000000-0000-4000-8000-000000000002",
        outboundIntentRef: String(outboundIntentRef),
      },
    });
    expect(harness.domainEventPublisher.eventNames()).toEqual(["MessageAccepted", "MessageQueued"]);
    expect(serialized).not.toContain("84999999999@s.whatsapp.net");
    expect(serialized).not.toContain("secret retry text");
  });

  it("does not enqueue duplicate retry work for the same idempotency key", async () => {
    const guardrailDecisionId = createGuardrailDecisionId("guardrail_retry_duplicate");
    const harness = await createHarness({
      guardrailDecisions: [
        createGuardrailDecisionAggregate({
          id: guardrailDecisionId,
          evaluatedIntentRef: String(outboundIntentRef),
          outcome: "allow",
          reasonCode: "minimal_guardrail_pass",
        }),
      ],
    });
    const original = failedQueuedMessage("msg_retry_duplicate", guardrailDecisionId);
    await harness.messageRepository.save(original);
    await harness.intentStore.bindMessageIntent(
      {
        outboundIntentRef,
        messageId: original.id,
      },
      applicationContext("bind-original-duplicate"),
    );
    const handler = createRetryMessageSendHandler(harness.handlerOptions);
    const command = retryMessageCommand("cmd-retry-duplicate", "idem-retry-duplicate", original.id);

    const first = await handler(command);
    const second = await handler(command);

    expect(first.accepted).toBe(true);
    expect(second).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-retry-duplicate",
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: "msg:00000000-0000-4000-8000-000000000002",
    });
    expect(harness.messageRepository.list()).toHaveLength(2);
    expect(harness.queueProvider.enqueued).toHaveLength(1);
  });

  it("rejects retry for messages that were not previously accepted", async () => {
    const harness = await createHarness();
    const original = createOutboundMessageIntent({
      id: createMessageId("msg_retry_not_allowed"),
      instanceId,
      type: "text",
    });
    await harness.messageRepository.save(original);
    const handler = createRetryMessageSendHandler(harness.handlerOptions);

    const outcome = await handler(
      retryMessageCommand("cmd-retry-not-allowed", "idem-retry-not-allowed", original.id),
    );

    expect(outcome).toMatchObject({
      outcome: "rejected",
      accepted: false,
      retryable: false,
      reasonCode: "retry_message_not_allowed",
      resultRef: String(original.id),
    });
    expect(harness.queueProvider.enqueued).toHaveLength(0);
  });

  it("cancels a queued outbound message and publishes only the new cancellation event", async () => {
    const guardrailDecisionId = createGuardrailDecisionId("guardrail_cancel_queued");
    const harness = await createHarness();
    const queued = queuedMessage("msg_cancel_queued", guardrailDecisionId);
    await harness.messageRepository.save(queued);
    const handler = createCancelMessageHandler({
      messageRepository: harness.messageRepository,
      domainEventPublisher: harness.domainEventPublisher,
    });

    const outcome = await handler(
      cancelMessageCommand("cmd-cancel-queued", "idem-cancel-queued", queued.id),
    );

    expect(outcome).toEqual({
      kind: "command_outcome",
      commandRef: "cmd-cancel-queued",
      outcome: "accepted",
      accepted: true,
      retryable: false,
      resultRef: String(queued.id),
    });
    await expect(harness.messageRepository.load(queued.id)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(harness.domainEventPublisher.eventNames()).toEqual(["MessageCancelled"]);
    expect(harness.domainEventPublisher.inputs[0]).toMatchObject({
      baseEventCount: queued.domainEvents.length,
    });
  });

  it("rejects cancellation for terminal messages without leaking raw payload", async () => {
    const guardrailDecisionId = createGuardrailDecisionId("guardrail_cancel_terminal");
    const harness = await createHarness({ rawJid: "raw-cancel-jid", rawText: "raw cancel text" });
    const failed = failedQueuedMessage("msg_cancel_terminal", guardrailDecisionId);
    await harness.messageRepository.save(failed);
    const handler = createCancelMessageHandler({
      messageRepository: harness.messageRepository,
      domainEventPublisher: harness.domainEventPublisher,
    });

    const outcome = await handler(
      cancelMessageCommand("cmd-cancel-terminal", "idem-cancel-terminal", failed.id),
    );
    const serialized = JSON.stringify({
      outcome,
      messages: harness.messageRepository.list(),
      events: harness.domainEventPublisher.inputs,
    });

    expect(outcome).toMatchObject({
      outcome: "rejected",
      accepted: false,
      retryable: false,
      reasonCode: "cancel_message_not_allowed",
      resultRef: String(failed.id),
    });
    expect(harness.domainEventPublisher.inputs).toHaveLength(0);
    expect(serialized).not.toContain("raw-cancel-jid");
    expect(serialized).not.toContain("raw cancel text");
  });
});

function sendTextCommand(commandRef: string, idempotencyKey: string) {
  return createApplicationCommandEnvelope({
    name: "SendTextMessage",
    commandRef,
    requestContext,
    actorRef: "api_key:test",
    targetRef: String(instanceId),
    idempotencyKey,
    safeInputRef: String(outboundIntentRef),
    dataClassification: "confidential",
  });
}

function retryMessageCommand(commandRef: string, idempotencyKey: string, messageId: MessageId) {
  return createApplicationCommandEnvelope({
    name: "RetryMessageSend",
    commandRef,
    requestContext,
    actorRef: "api_key:test",
    targetRef: String(messageId),
    idempotencyKey,
    dataClassification: "confidential",
  });
}

function cancelMessageCommand(commandRef: string, idempotencyKey: string, messageId: MessageId) {
  return createApplicationCommandEnvelope({
    name: "CancelMessage",
    commandRef,
    requestContext,
    actorRef: "api_key:test",
    targetRef: String(messageId),
    idempotencyKey,
    dataClassification: "confidential",
  });
}

function queuedMessage(id: string, guardrailDecisionId: GuardrailDecisionId): Message {
  return queueMessage(
    acceptMessage(
      createOutboundMessageIntent({
        id: createMessageId(id),
        instanceId,
        type: "text",
      }),
      guardrailDecisionId,
    ),
  );
}

function failedQueuedMessage(id: string, guardrailDecisionId: GuardrailDecisionId): Message {
  return failMessage(queuedMessage(id, guardrailDecisionId), "provider");
}

async function createHarness(
  options: Readonly<{
    rawJid?: string;
    rawText?: string;
    queueFailure?: boolean;
    guardrailDecisions?: readonly GuardrailDecision[];
  }> = {},
) {
  const instanceRepository = new FakeInstanceRepository([
    markInstanceConnected(markInstanceConnecting(createInstance(instanceId)), sessionId),
  ]);
  const sessionRepository = new FakeSessionRepository([
    activateSession(startSessionPairing(createSession(sessionId, instanceId))),
  ]);
  const messageRepository = new FakeMessageRepository();
  const guardrailDecisionRepository = new FakeGuardrailDecisionRepository(
    options.guardrailDecisions ?? [],
  );
  const intentStore = new FakeOutboundMessageIntentStore();
  const queueProvider = new FakeQueueProvider(options.queueFailure === true);
  const domainEventPublisher = new CapturingDomainEventPublisher();
  const uuidGenerator = fixedUuidGenerator([
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
    "00000000-0000-4000-8000-000000000004",
    "00000000-0000-4000-8000-000000000005",
    "00000000-0000-4000-8000-000000000006",
  ]);
  const activeSessionResolver = createActiveSessionResolver({
    instanceRepository,
    sessionRepository,
  });
  const guardrailService = createMinimalMessageGuardrailService({
    guardrailDecisionRepository,
  });

  await intentStore.storeTextIntent(
    {
      outboundIntentRef,
      recipientRef: options.rawJid ?? "safe-recipient-ref",
      text: options.rawText ?? "safe text",
    },
    applicationContext("intent-store"),
  );

  return {
    instanceRepository,
    sessionRepository,
    messageRepository,
    guardrailDecisionRepository,
    intentStore,
    queueProvider,
    domainEventPublisher,
    uuidGenerator,
    handlerOptions: {
      activeSessionResolver,
      messageRepository,
      outboundMessageIntentStore: intentStore,
      guardrailService,
      queueProvider,
      domainEventPublisher,
      uuidGenerator,
    },
  };
}

function createDispatcher(
  harness: Awaited<ReturnType<typeof createHarness>>,
): ApplicationDispatcher {
  return createApplicationDispatcher({
    repositories: {
      instanceRepository: harness.instanceRepository,
      sessionRepository: harness.sessionRepository,
      messageRepository: harness.messageRepository,
      guardrailDecisionRepository: harness.guardrailDecisionRepository,
    },
    outboundMessageIntentStore: harness.intentStore,
    queueProvider: harness.queueProvider,
    domainEventPublisher: harness.domainEventPublisher,
    uuidGenerator: harness.uuidGenerator,
  });
}

function applicationContext(idempotencyKey: string): ApplicationPortContext {
  return Object.freeze({
    requestContext,
    actorRef: "api_key:test",
    idempotencyKey,
    dataClassification: "confidential",
  });
}

function fixedUuidGenerator(values: readonly string[]): UUIDGenerator {
  let index = 0;

  return {
    random: () => createUuid(values[Math.min(index++, values.length - 1)] ?? values[0] ?? ""),
  };
}

class FakeInstanceRepository implements InstanceRepositoryPort {
  private readonly records = new Map<string, Instance>();

  constructor(initialRecords: readonly Instance[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: InstanceId): Promise<Instance | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Instance): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: InstanceId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    return Promise.resolve(
      [...this.records.values()].filter((instance) => instance.status === status),
    );
  }

  findNonTerminal(): Promise<readonly Instance[]> {
    return Promise.resolve(
      [...this.records.values()].filter((instance) => instance.status !== "destroyed"),
    );
  }

  getCurrentSessionId(id: InstanceId): Promise<SessionId | undefined> {
    return Promise.resolve(this.records.get(String(id))?.currentSessionId);
  }
}

class FakeSessionRepository implements SessionRepositoryPort {
  private readonly records = new Map<string, Session>();

  constructor(initialRecords: readonly Session[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: SessionId): Promise<Session | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Session): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: SessionId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByInstance(ownerInstanceId: InstanceId): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (session) => String(session.instanceId) === String(ownerInstanceId),
      ),
    );
  }

  findByStatusForInstance(
    ownerInstanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (session) =>
          String(session.instanceId) === String(ownerInstanceId) && session.status === status,
      ),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.records.values()].filter((session) => session.requiresRecovery),
    );
  }
}

class FakeMessageRepository implements MessageRepositoryPort {
  private readonly records = new Map<string, Message>();
  private readonly messageIdByIdempotencyKey = new Map<string, MessageId>();

  load(id: MessageId): Promise<Message | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: Message): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: MessageId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByStatus(status: MessageStatus): Promise<readonly Message[]> {
    return Promise.resolve(this.list().filter((message) => message.status === status));
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<Message | undefined> {
    const messageId = this.messageIdByIdempotencyKey.get(String(idempotencyKey));
    return Promise.resolve(
      messageId === undefined ? undefined : this.records.get(String(messageId)),
    );
  }

  findRecoverableByOwner(): Promise<readonly Message[]> {
    return Promise.resolve(
      this.list().filter((message) => ["queued", "processing", "failed"].includes(message.status)),
    );
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, messageId: MessageId): void {
    this.messageIdByIdempotencyKey.set(String(idempotencyKey), messageId);
  }

  list(): readonly Message[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeGuardrailDecisionRepository implements GuardrailDecisionRepositoryPort {
  private readonly records = new Map<string, GuardrailDecision>();

  constructor(initialRecords: readonly GuardrailDecision[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

  load(id: GuardrailDecisionId): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(this.records.get(String(id)));
  }

  save(aggregate: GuardrailDecision): Promise<RepositorySaveResult> {
    this.records.set(String(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: GuardrailDecisionId): Promise<boolean> {
    return Promise.resolve(this.records.has(String(id)));
  }

  findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(
      [...this.records.values()].find(
        (decision) => decision.evaluatedIntentRef === evaluatedIntentRef,
      ),
    );
  }
}

class FakeOutboundMessageIntentStore implements OutboundMessageIntentStorePort {
  private readonly records = new Map<string, StoredTextOutboundMessageIntent>();

  storeTextIntent(
    intent: TextOutboundMessageIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    void context;

    const outboundRef =
      intent.outboundIntentRef ?? createOutboundMessageIntentRef("intent_generated");
    const stored: StoredTextOutboundMessageIntent = Object.freeze({
      outboundIntentRef: outboundRef,
      kind: "text",
      recipientRef: intent.recipientRef,
      text: intent.text,
      createdAtEpochMilliseconds: 1,
    });
    this.records.set(String(outboundRef), stored);

    return Promise.resolve(
      ok({
        outboundIntentRef: outboundRef,
        kind: "text",
        createdAtEpochMilliseconds: stored.createdAtEpochMilliseconds,
      }),
    );
  }

  bindMessageIntent(
    binding: OutboundMessageIntentBinding,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentBinding>> {
    void context;

    const existing = this.records.get(String(binding.outboundIntentRef));

    if (existing === undefined) {
      return Promise.resolve(err(portFailure("outbound_intent_not_found", false)));
    }

    this.records.set(
      String(binding.outboundIntentRef),
      Object.freeze({
        ...existing,
        messageId: binding.messageId,
      }),
    );

    return Promise.resolve(ok(binding));
  }

  findTextIntentByMessage(
    messageId: MessageId,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    const stored = [...this.records.values()].find(
      (record) => String(record.messageId) === String(messageId),
    );

    return Promise.resolve(
      stored === undefined
        ? err(portFailure("outbound_intent_not_found", false))
        : ok({
            outboundIntentRef: stored.outboundIntentRef,
            kind: "text",
            createdAtEpochMilliseconds: stored.createdAtEpochMilliseconds,
          }),
    );
  }

  verifyTextIntent(
    ref: OutboundMessageIntentRef,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    const stored = this.records.get(String(ref));

    return Promise.resolve(
      stored === undefined
        ? err(portFailure("outbound_intent_not_found", false))
        : ok({
            outboundIntentRef: stored.outboundIntentRef,
            kind: "text",
            createdAtEpochMilliseconds: stored.createdAtEpochMilliseconds,
            ...(stored.expiresAtEpochMilliseconds === undefined
              ? {}
              : { expiresAtEpochMilliseconds: stored.expiresAtEpochMilliseconds }),
          }),
    );
  }

  resolveTextIntent(
    ref: OutboundMessageIntentRef,
  ): Promise<ApplicationPortResult<StoredTextOutboundMessageIntent>> {
    const stored = this.records.get(String(ref));

    return Promise.resolve(
      stored === undefined ? err(portFailure("outbound_intent_not_found", false)) : ok(stored),
    );
  }

  bindingFor(ref: OutboundMessageIntentRef): OutboundMessageIntentBinding | undefined {
    const stored = this.records.get(String(ref));

    return stored?.messageId === undefined
      ? undefined
      : Object.freeze({
          outboundIntentRef: ref,
          messageId: stored.messageId,
        });
  }
}

class FakeQueueProvider implements QueueProviderPort {
  readonly enqueued: QueueWorkRequest[] = [];

  constructor(private readonly failEnqueue: boolean) {}

  enqueue(work: QueueWorkRequest): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    if (this.failEnqueue) {
      return Promise.resolve(err(portFailure("queue_enqueue_failed", true)));
    }

    this.enqueued.push(work);
    return Promise.resolve(
      ok({
        jobId: work.jobId,
        visible: true,
        queueRef: `queue:${String(work.jobId)}`,
      }),
    );
  }

  reserve(): Promise<ApplicationPortResult<QueueReservation | undefined>> {
    return Promise.resolve(ok(undefined));
  }

  acknowledge(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(queueReceipt(reservation.jobId, false));
  }

  releaseForRetry(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(queueReceipt(reservation.jobId, true));
  }

  moveToDeadLetter(
    reservation: QueueReservation,
  ): Promise<ApplicationPortResult<QueueVisibilityReceipt>> {
    return Promise.resolve(queueReceipt(reservation.jobId, false));
  }
}

class CapturingDomainEventPublisher implements DomainEventPublisher {
  readonly inputs: DomainEventPublisherInput[] = [];

  publishNewEvents(
    input: DomainEventPublisherInput,
  ): Promise<ApplicationPortResult<DomainEventPublicationReceipt>> {
    this.inputs.push(input);
    return Promise.resolve(
      ok({
        publishedEvents: Object.freeze([]),
      }),
    );
  }

  eventNames(): readonly DomainEvent["name"][] {
    return Object.freeze(
      this.inputs.flatMap((input) =>
        input.aggregateEvents.slice(input.baseEventCount).map((event) => event.name),
      ),
    );
  }
}

function queueReceipt(jobId: JobId, visible: boolean): Result<QueueVisibilityReceipt, never> {
  return ok({
    jobId,
    visible,
    queueRef: `queue:${String(jobId)}`,
  });
}

function portFailure(code: string, retryable: boolean): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: retryable ? "unavailable" : "rejected",
    code,
    message: "Safe port failure.",
    retryable,
    ownerContext: "messaging",
    failureCategory: retryable ? "queue" : "business",
    safeMetadata: {
      code,
    },
  });
}
