import {
  acceptMessage,
  activateSession,
  cancelMessage,
  createFailureCategory,
  createGuardrailDecisionId,
  createInstance,
  createInstanceId,
  createMessageId,
  createOutboundMessageIntent,
  createProviderId,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  markMessageProcessing,
  markMessageSent,
  queueMessage,
  startSessionPairing,
  type DomainEvent,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type MessageStatus,
  type ProviderId,
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
  err,
  ok,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  createApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
} from "../../commands/command-model.js";
import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
} from "../../ports/application-port.js";
import type {
  MessagingProviderPort,
  ProviderCapabilitySummary,
  ProviderConnectionRequest,
  ProviderConnectionResult,
  ProviderOutboundMessageRequest,
  ProviderOutboundMessageResult,
  ProviderQrPairingChallenge,
  ProviderQrPairingRequest,
} from "../../ports/messaging-provider.js";
import {
  createOutboundMessageIntentRef,
  type OutboundMessageIntentBinding,
  type OutboundMessageIntentReceipt,
  type OutboundMessageIntentStorePort,
  type StoredTextOutboundMessageIntent,
  type TextOutboundMessageIntentInput,
} from "../../ports/outbound-message-intent-store.js";
import { createActiveSessionResolver } from "../active-session-resolver.js";
import type {
  DomainEventPublicationReceipt,
  DomainEventPublisher,
  DomainEventPublisherInput,
} from "../domain-event-publisher.js";
import { createProcessOutboundMessageWorkHandler } from "./process-outbound-message-work.handler.js";

const instanceId = createInstanceId("inst_process_outbound");
const sessionId = createSessionId("session_process_outbound");
const messageId = createMessageId("msg_process_outbound");
const outboundIntentRef = createOutboundMessageIntentRef("intent_process_outbound");
const providerId = createProviderId("provider_process_outbound");
const rawRecipient = "12025550123@s.whatsapp.net";
const rawText = "private worker text";
const requestContext = createRequestContext({
  requestId: createRequestId("process-outbound-request"),
  correlationId: createCorrelationId("process-outbound-correlation"),
});

describe("process outbound message work handler", () => {
  it("sends through provider once and updates the message to sent", async () => {
    const harness = createHarness();
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-success"));

    expect(outcome).toEqual(
      commandOutcome("cmd-process-success", {
        outcome: "completed",
        accepted: true,
        retryable: false,
        resultRef: String(messageId),
      }),
    );
    expect(harness.provider.requests).toHaveLength(1);
    expect(harness.provider.requests[0]).toMatchObject({
      instanceId,
      providerId,
      sessionId,
      messageId,
      messageType: "text",
      outboundIntentRef: String(outboundIntentRef),
    });
    await expect(harness.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "sent",
    });
    expect(harness.domainEventPublisher.eventNames()).toEqual([
      "MessageProcessingStarted",
      "MessageDispatched",
    ]);
  });

  it("does not call provider when the active session is missing", async () => {
    const harness = createHarness({ sessions: [] });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-missing-session"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "active_session_not_found",
      resultRef: String(messageId),
    });
    expect(harness.provider.requests).toHaveLength(0);
    await expect(harness.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("does not call provider when the active session is inactive", async () => {
    const harness = createHarness({
      sessions: [startSessionPairing(createSession(sessionId, instanceId))],
    });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-inactive-session"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "active_session_not_usable",
      resultRef: String(messageId),
    });
    expect(harness.provider.requests).toHaveLength(0);
  });

  it("does not call provider when the outbound intent is missing", async () => {
    const harness = createHarness({ intentAvailable: false });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-missing-intent"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "outbound_intent_not_found",
      resultRef: String(messageId),
    });
    expect(harness.provider.requests).toHaveLength(0);
    expect(JSON.stringify(outcome)).not.toContain(rawRecipient);
    expect(JSON.stringify(outcome)).not.toContain(rawText);
  });

  it("returns a retryable outcome for retryable provider failure", async () => {
    const harness = createHarness({
      providerResult: err(portFailure("provider_timeout", true)),
    });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-provider-retry"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: true,
      reasonCode: "provider_timeout",
      resultRef: String(messageId),
    });
    expect(harness.provider.requests).toHaveLength(1);
    await expect(harness.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "processing",
    });
  });

  it("marks the message failed for permanent provider failure", async () => {
    const harness = createHarness({
      providerResult: ok({
        messageId,
        status: "rejected",
        retryable: false,
        failureCategory: createFailureCategory("provider"),
      }),
    });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-provider-dead"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "provider_send_rejected",
      resultRef: String(messageId),
    });
    await expect(harness.messageRepository.load(messageId)).resolves.toMatchObject({
      status: "failed",
      failureCategory: "provider",
    });
  });

  it("does not double-send when a retry observes an already sent message", async () => {
    const sentMessage = markMessageSent(markMessageProcessing(queuedMessage()));
    const harness = createHarness({ messages: [sentMessage] });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-already-sent"));

    expect(outcome).toEqual(
      commandOutcome("cmd-process-already-sent", {
        outcome: "completed",
        accepted: true,
        retryable: false,
        resultRef: String(messageId),
      }),
    );
    expect(harness.provider.requests).toHaveLength(0);
  });

  it("does not call provider when the queued message was cancelled before dispatch", async () => {
    const cancelledMessage = cancelMessage(queuedMessage());
    const harness = createHarness({ messages: [cancelledMessage] });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-cancelled"));

    expect(outcome).toMatchObject({
      outcome: "failed",
      accepted: false,
      retryable: false,
      reasonCode: "outbound_message_not_dispatchable",
      resultRef: String(messageId),
    });
    expect(harness.provider.requests).toHaveLength(0);
  });

  it("does not leak raw to/text through outcomes, provider requests, or events", async () => {
    const harness = createHarness({
      providerResult: ok({
        messageId,
        status: "rejected",
        retryable: false,
        failureCategory: createFailureCategory("provider"),
      }),
    });
    const handler = createProcessOutboundMessageWorkHandler(harness.handlerOptions);

    const outcome = await handler(processCommand("cmd-process-redaction"));
    const serialized = JSON.stringify({
      outcome,
      providerRequests: harness.provider.requests,
      events: harness.domainEventPublisher.inputs,
      messages: harness.messageRepository.list(),
    });

    expect(serialized).not.toContain(rawRecipient);
    expect(serialized).not.toContain(rawText);
    expect(serialized).not.toContain("private worker");
  });
});

function processCommand(commandRef: string) {
  return createApplicationCommandEnvelope({
    name: "ProcessOutboundMessageWork",
    commandRef,
    requestContext,
    actorRef: "worker-runtime:test",
    targetRef: String(messageId),
    safeInputRef: String(outboundIntentRef),
    idempotencyKey: `${commandRef}:idempotency`,
    dataClassification: "internal",
  });
}

function createHarness(
  options: Readonly<{
    instances?: readonly Instance[];
    sessions?: readonly Session[];
    messages?: readonly Message[];
    intentAvailable?: boolean;
    providerResult?: ApplicationPortResult<ProviderOutboundMessageResult>;
  }> = {},
) {
  const instanceRepository = new FakeInstanceRepository(
    options.instances ?? [
      markInstanceConnected(markInstanceConnecting(createInstance(instanceId)), sessionId),
    ],
  );
  const sessionRepository = new FakeSessionRepository(
    options.sessions ?? [
      activateSession(startSessionPairing(createSession(sessionId, instanceId))),
    ],
  );
  const messageRepository = new FakeMessageRepository(options.messages ?? [queuedMessage()]);
  const intentStore = new FakeOutboundMessageIntentStore(options.intentAvailable !== false);
  const provider = new FakeMessagingProvider(
    options.providerResult ??
      ok({
        messageId,
        status: "accepted",
        retryable: false,
        providerReceiptRef: "provider_receipt_process_outbound",
      }),
  );
  const domainEventPublisher = new CapturingDomainEventPublisher();

  return {
    instanceRepository,
    sessionRepository,
    messageRepository,
    intentStore,
    provider,
    domainEventPublisher,
    handlerOptions: {
      activeSessionResolver: createActiveSessionResolver({
        instanceRepository,
        sessionRepository,
      }),
      messageRepository,
      outboundMessageIntentStore: intentStore,
      messagingProvider: provider,
      domainEventPublisher,
      providerId,
    },
  };
}

function queuedMessage(): Message {
  return queueMessage(
    acceptMessage(
      createOutboundMessageIntent({
        id: messageId,
        instanceId,
        type: "text",
      }),
      createGuardrailDecisionId("guardrail_process_outbound"),
    ),
  );
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
    return Promise.resolve(this.list().filter((instance) => instance.status === status));
  }

  findNonTerminal(): Promise<readonly Instance[]> {
    return Promise.resolve(this.list().filter((instance) => instance.status !== "destroyed"));
  }

  getCurrentSessionId(id: InstanceId): Promise<SessionId | undefined> {
    return Promise.resolve(this.records.get(String(id))?.currentSessionId);
  }

  list(): readonly Instance[] {
    return Object.freeze([...this.records.values()]);
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
      this.list().filter((session) => String(session.instanceId) === String(ownerInstanceId)),
    );
  }

  findByStatusForInstance(
    ownerInstanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return Promise.resolve(
      this.list().filter(
        (session) =>
          String(session.instanceId) === String(ownerInstanceId) && session.status === status,
      ),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(this.list().filter((session) => session.requiresRecovery));
  }

  list(): readonly Session[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeMessageRepository implements MessageRepositoryPort {
  private readonly records = new Map<string, Message>();

  constructor(initialRecords: readonly Message[] = []) {
    for (const record of initialRecords) {
      this.records.set(String(record.id), record);
    }
  }

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

  findByIdempotencyKey(): Promise<Message | undefined> {
    return Promise.resolve(undefined);
  }

  findRecoverableByOwner(): Promise<readonly Message[]> {
    return Promise.resolve(
      this.list().filter((message) => ["queued", "processing", "failed"].includes(message.status)),
    );
  }

  list(): readonly Message[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeOutboundMessageIntentStore implements OutboundMessageIntentStorePort {
  constructor(private readonly available: boolean) {}

  storeTextIntent(
    intent: TextOutboundMessageIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    void intent;
    void context;

    return Promise.resolve(ok(intentReceipt()));
  }

  bindMessageIntent(
    binding: OutboundMessageIntentBinding,
  ): Promise<ApplicationPortResult<OutboundMessageIntentBinding>> {
    return Promise.resolve(ok(binding));
  }

  findTextIntentByMessage(): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      this.available ? ok(intentReceipt()) : err(portFailure("outbound_intent_not_found", false)),
    );
  }

  verifyTextIntent(): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      this.available ? ok(intentReceipt()) : err(portFailure("outbound_intent_not_found", false)),
    );
  }

  resolveTextIntent(): Promise<ApplicationPortResult<StoredTextOutboundMessageIntent>> {
    if (!this.available) {
      return Promise.resolve(err(portFailure("outbound_intent_not_found", false)));
    }

    return Promise.resolve(
      ok({
        outboundIntentRef,
        kind: "text",
        recipientRef: rawRecipient,
        text: rawText,
        createdAtEpochMilliseconds: 1,
      }),
    );
  }
}

class FakeMessagingProvider implements MessagingProviderPort {
  readonly requests: ProviderOutboundMessageRequest[] = [];

  constructor(private readonly result: ApplicationPortResult<ProviderOutboundMessageResult>) {}

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
        challengeRef: "qr-process-outbound",
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
    return Promise.resolve(this.result);
  }

  getCapabilitySummary(id: ProviderId): Promise<ApplicationPortResult<ProviderCapabilitySummary>> {
    return Promise.resolve(
      ok({
        providerId: id,
        supportedMessageTypes: ["text"],
        degraded: false,
      }),
    );
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
      this.inputs
        .flatMap((input) => input.aggregateEvents.slice(input.baseEventCount))
        .map((event) => event.name),
    );
  }
}

function intentReceipt(): OutboundMessageIntentReceipt {
  return {
    outboundIntentRef,
    kind: "text",
    createdAtEpochMilliseconds: 1,
  };
}

function portFailure(code: string, retryable: boolean) {
  return createApplicationPortFailure({
    category: retryable ? "unavailable" : "rejected",
    code,
    message: "Safe port failure.",
    retryable,
    ownerContext: "messaging",
    failureCategory: retryable ? "provider" : "business",
    safeMetadata: { code },
  });
}

function commandOutcome(
  commandRef: string,
  input: Readonly<{
    outcome: ApplicationCommandOutcome["outcome"];
    accepted: boolean;
    retryable: boolean;
    resultRef?: string;
    reasonCode?: string;
  }>,
): ApplicationCommandOutcome {
  return {
    kind: "command_outcome",
    commandRef,
    outcome: input.outcome,
    accepted: input.accepted,
    retryable: input.retryable,
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
  };
}
