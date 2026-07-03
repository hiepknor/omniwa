import {
  createGuardrailDecisionId,
  createIdempotencyKey,
  createInstanceId,
  createJobId,
  createMessageId,
  createOutboundMessageIntent,
  createRetryPolicy,
  failMessage,
  queueMessage,
  type GuardrailDecision,
  type IdempotencyKey,
  type InstanceId,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, ok, type UUIDGenerator } from "@omniwa/shared";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type { ApplicationPortResult } from "../../ports/application-port.js";
import {
  createOutboundMessageIntentRef,
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
} from "../../ports/outbound-message-intent-store.js";
import type { QueueProviderPort } from "../../ports/queue-provider.js";
import type { ActiveSessionResolver } from "../active-session-resolver.js";
import type { DomainEventPublisher } from "../domain-event-publisher.js";
import type { MinimalMessageGuardrailService } from "../minimal-message-guardrail.js";
import type { CommandHandler } from "./command-handler.js";

export type SendTextMessageHandlerOptions = Readonly<{
  activeSessionResolver: ActiveSessionResolver;
  messageRepository: MessageRepositoryPort;
  outboundMessageIntentStore: OutboundMessageIntentStorePort;
  guardrailService: MinimalMessageGuardrailService;
  queueProvider: QueueProviderPort;
  domainEventPublisher: DomainEventPublisher;
  uuidGenerator?: UUIDGenerator;
}>;

type IdempotencyAwareMessageRepository = MessageRepositoryPort &
  Partial<{
    recordIdempotencyKey(
      idempotencyKey: IdempotencyKey,
      messageId: MessageId,
    ): Promise<void> | void;
  }>;

type SendTextMessageInput = Readonly<{
  ok: true;
  instanceId: InstanceId;
  idempotencyKey: IdempotencyKey;
  outboundIntentRef: OutboundMessageIntentRef;
  context: Parameters<ActiveSessionResolver["resolveActiveSession"]>[1];
}>;

export function createSendTextMessageHandler(
  options: SendTextMessageHandlerOptions,
): CommandHandler {
  const handler = new SendTextMessageHandler(options);
  return (envelope) => handler.handle(envelope);
}

class SendTextMessageHandler {
  private readonly activeSessionResolver: ActiveSessionResolver;
  private readonly messageRepository: IdempotencyAwareMessageRepository;
  private readonly outboundMessageIntentStore: OutboundMessageIntentStorePort;
  private readonly guardrailService: MinimalMessageGuardrailService;
  private readonly queueProvider: QueueProviderPort;
  private readonly domainEventPublisher: DomainEventPublisher;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: SendTextMessageHandlerOptions) {
    this.activeSessionResolver = options.activeSessionResolver;
    this.messageRepository = options.messageRepository;
    this.outboundMessageIntentStore = options.outboundMessageIntentStore;
    this.guardrailService = options.guardrailService;
    this.queueProvider = options.queueProvider;
    this.domainEventPublisher = options.domainEventPublisher;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
  }

  async handle(envelope: ApplicationCommandEnvelope): Promise<ApplicationCommandOutcome> {
    const input = this.resolveInput(envelope);

    if (!input.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: input.reasonCode,
      });
    }

    const existing = await this.messageRepository.findByIdempotencyKey(input.idempotencyKey);

    if (existing !== undefined) {
      return outcomeForExistingMessage(envelope, existing);
    }

    const sessionResult = await this.activeSessionResolver.resolveActiveSession(
      input.instanceId,
      input.context,
    );

    if (!sessionResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: sessionResult.error.retryable,
        reasonCode: sessionResult.error.code,
      });
    }

    const intentResult = await this.outboundMessageIntentStore.resolveTextIntent(
      input.outboundIntentRef,
      input.context,
    );

    if (!intentResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: intentResult.error.retryable,
        reasonCode: intentResult.error.code,
      });
    }

    const guardrailResult = await this.guardrailService.createDecision(
      {
        guardrailDecisionId: createGuardrailDecisionId(`guardrail:${this.uuidGenerator.random()}`),
        outboundIntentRef: input.outboundIntentRef,
      },
      input.context,
    );

    if (!guardrailResult.ok) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: guardrailResult.error.retryable,
        reasonCode: guardrailResult.error.code,
      });
    }

    const message = createOutboundMessageIntent({
      id: createMessageId(`msg:${this.uuidGenerator.random()}`),
      instanceId: sessionResult.value.instance.id,
      type: "text",
    });

    try {
      await this.messageRepository.save(message);
      await this.messageRepository.recordIdempotencyKey?.(input.idempotencyKey, message.id);
    } catch {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: true,
        reasonCode: "send_text_message_save_failed",
      });
    }

    const bindResult = await this.outboundMessageIntentStore.bindMessageIntent(
      {
        outboundIntentRef: input.outboundIntentRef,
        messageId: message.id,
      },
      input.context,
    );

    if (!bindResult.ok) {
      await this.saveFailedMessage(message);
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: bindResult.error.retryable,
        reasonCode: bindResult.error.code,
        resultRef: message.id,
      });
    }

    const queueResult = await this.queueProvider.enqueue(
      {
        jobId: createJobId(`job:${this.uuidGenerator.random()}`),
        ownerContext: "messaging",
        ownerRef: String(message.id),
        workType: "outbound_message",
        retryPolicy: createRetryPolicy({
          maxAttempts: 3,
          initialDelayMilliseconds: 1_000,
          backoffMultiplier: 2,
        }),
        idempotencyKey: `send_text:${String(input.idempotencyKey)}`,
      },
      input.context,
    );

    if (!queueResult.ok) {
      await this.saveFailedMessage(message);
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: queueResult.error.retryable,
        reasonCode: queueResult.error.code,
        resultRef: message.id,
      });
    }

    const accepted = this.guardrailService.acceptMessageAfterGuardrailPass(
      message,
      guardrailResult.value,
      input.outboundIntentRef,
      input.context,
    );

    if (!accepted.ok) {
      await this.saveFailedMessage(message);
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: accepted.error.retryable,
        reasonCode: accepted.error.code,
        resultRef: message.id,
      });
    }

    const queued = queueMessage(accepted.value);

    await this.messageRepository.save(queued);
    const publishResult = await this.publishDomainEvents(envelope, guardrailResult.value, queued);

    if (!publishResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: true,
        retryable: publishResult.error.retryable,
        reasonCode: publishResult.error.code,
        resultRef: queued.id,
      });
    }

    return commandOutcome(envelope, "queued", {
      accepted: true,
      retryable: false,
      resultRef: queued.id,
    });
  }

  private resolveInput(
    envelope: ApplicationCommandEnvelope,
  ): SendTextMessageInput | Readonly<{ ok: false; reasonCode: string }> {
    if (envelope.name !== "SendTextMessage") {
      return { ok: false, reasonCode: "send_text_message_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: "send_text_message_instance_required" };
    }

    if (envelope.safeInputRef === undefined) {
      return { ok: false, reasonCode: "send_text_message_input_ref_required" };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: "send_text_message_idempotency_required" };
    }

    try {
      const context = {
        requestContext: envelope.requestContext,
        ...(envelope.actorRef === undefined ? {} : { actorRef: envelope.actorRef }),
        idempotencyKey: envelope.idempotencyKey,
        ...(envelope.dataClassification === undefined
          ? {}
          : { dataClassification: envelope.dataClassification }),
      };

      return {
        ok: true,
        instanceId: createInstanceId(envelope.targetRef),
        idempotencyKey: createIdempotencyKey(envelope.idempotencyKey),
        outboundIntentRef: createOutboundMessageIntentRef(envelope.safeInputRef),
        context,
      };
    } catch {
      return { ok: false, reasonCode: "send_text_message_input_invalid" };
    }
  }

  private async saveFailedMessage(message: Message): Promise<void> {
    try {
      await this.messageRepository.save(failMessage(message, "queue"));
    } catch {
      // Preserve the original application failure; persistence retry is handled by the caller.
    }
  }

  private async publishDomainEvents(
    envelope: ApplicationCommandEnvelope,
    guardrailDecision: GuardrailDecision,
    message: Message,
  ): Promise<ApplicationPortResult<void>> {
    const guardrailPublish = await this.domainEventPublisher.publishNewEvents({
      aggregateEvents: guardrailDecision.domainEvents,
      baseEventCount: 0,
      executionRef: `${envelope.commandRef}:guardrail`,
      context: commandContext(envelope),
    });

    if (!guardrailPublish.ok) {
      return guardrailPublish;
    }

    const messagePublish = await this.domainEventPublisher.publishNewEvents({
      aggregateEvents: message.domainEvents,
      baseEventCount: 0,
      executionRef: `${envelope.commandRef}:message`,
      context: commandContext(envelope),
    });

    if (!messagePublish.ok) {
      return messagePublish;
    }

    return ok(undefined);
  }
}

function commandContext(
  envelope: ApplicationCommandEnvelope,
): Parameters<DomainEventPublisher["publishNewEvents"]>[0]["context"] {
  return {
    requestContext: envelope.requestContext,
    ...(envelope.actorRef === undefined ? {} : { actorRef: envelope.actorRef }),
    ...(envelope.idempotencyKey === undefined ? {} : { idempotencyKey: envelope.idempotencyKey }),
    ...(envelope.dataClassification === undefined
      ? {}
      : { dataClassification: envelope.dataClassification }),
  };
}

function outcomeForExistingMessage(
  envelope: ApplicationCommandEnvelope,
  message: Message,
): ApplicationCommandOutcome {
  if (["queued", "processing", "sent", "delivered", "read"].includes(message.status)) {
    return commandOutcome(envelope, "queued", {
      accepted: true,
      retryable: false,
      resultRef: message.id,
    });
  }

  if (message.status === "evaluated") {
    return commandOutcome(envelope, "accepted", {
      accepted: true,
      retryable: false,
      resultRef: message.id,
    });
  }

  return commandOutcome(envelope, message.status === "created" ? "waiting" : "failed", {
    accepted: false,
    retryable: message.status === "created",
    resultRef: message.id,
    reasonCode:
      message.status === "created"
        ? "send_text_message_previously_started"
        : "send_text_message_previously_failed",
  });
}

function commandOutcome(
  envelope: ApplicationCommandEnvelope,
  outcome: ApplicationCommandOutcome["outcome"],
  input: Readonly<{
    accepted: boolean;
    retryable: boolean;
    resultRef?: string;
    reasonCode?: string;
  }>,
): ApplicationCommandOutcome {
  return createApplicationCommandOutcome({
    commandRef: envelope.commandRef,
    outcome,
    accepted: input.accepted,
    retryable: input.retryable,
    ...(input.resultRef === undefined ? {} : { resultRef: input.resultRef }),
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
  });
}
