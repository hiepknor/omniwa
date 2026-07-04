import {
  createGuardrailDecisionId,
  createIdempotencyKey,
  createJobId,
  createMessageId,
  createOutboundMessageIntent,
  createRetryPolicy,
  failMessage,
  queueMessage,
  type IdempotencyKey,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, type UUIDGenerator } from "@omniwa/shared";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type { QueueProviderPort } from "../../ports/queue-provider.js";
import {
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
} from "../../ports/outbound-message-intent-store.js";
import type {
  ApplicationPortContext,
  ApplicationPortResult,
} from "../../ports/application-port.js";
import type { ActiveSessionResolver } from "../active-session-resolver.js";
import type { DomainEventPublisher } from "../domain-event-publisher.js";
import type { MinimalMessageGuardrailService } from "../minimal-message-guardrail.js";
import type { CommandHandler } from "./command-handler.js";

type IdempotencyAwareMessageRepository = MessageRepositoryPort &
  Partial<{
    recordIdempotencyKey(
      idempotencyKey: IdempotencyKey,
      messageId: MessageId,
    ): Promise<void> | void;
  }>;

export type RetryMessageSendHandlerOptions = Readonly<{
  activeSessionResolver: ActiveSessionResolver;
  messageRepository: IdempotencyAwareMessageRepository;
  outboundMessageIntentStore: OutboundMessageIntentStorePort;
  guardrailService: MinimalMessageGuardrailService;
  queueProvider: QueueProviderPort;
  domainEventPublisher: DomainEventPublisher;
  uuidGenerator?: UUIDGenerator;
}>;

type RetryMessageSendInput = Readonly<{
  ok: true;
  messageId: MessageId;
  idempotencyKey: IdempotencyKey;
  context: ApplicationPortContext;
}>;

export function createRetryMessageSendHandler(
  options: RetryMessageSendHandlerOptions,
): CommandHandler {
  const handler = new RetryMessageSendHandler(options);
  return (envelope) => handler.handle(envelope);
}

class RetryMessageSendHandler {
  private readonly activeSessionResolver: ActiveSessionResolver;
  private readonly messageRepository: IdempotencyAwareMessageRepository;
  private readonly outboundMessageIntentStore: OutboundMessageIntentStorePort;
  private readonly guardrailService: MinimalMessageGuardrailService;
  private readonly queueProvider: QueueProviderPort;
  private readonly domainEventPublisher: DomainEventPublisher;
  private readonly uuidGenerator: UUIDGenerator;

  constructor(options: RetryMessageSendHandlerOptions) {
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
      return outcomeForExistingRetryMessage(envelope, existing);
    }

    const original = await this.messageRepository.load(input.messageId);

    if (original === undefined) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: "retry_message_not_found",
      });
    }

    if (!isRetryableOriginalMessage(original)) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: false,
        resultRef: original.id,
        reasonCode: "retry_message_not_allowed",
      });
    }

    const sessionResult = await this.activeSessionResolver.resolveActiveSession(
      original.instanceId,
      input.context,
    );

    if (!sessionResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: sessionResult.error.retryable,
        resultRef: original.id,
        reasonCode: sessionResult.error.code,
      });
    }

    const intentResult = await this.outboundMessageIntentStore.findTextIntentByMessage(
      original.id,
      input.context,
    );

    if (!intentResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: intentResult.error.retryable,
        resultRef: original.id,
        reasonCode: intentResult.error.code,
      });
    }

    const guardrailResult = await this.guardrailService.createDecision(
      {
        guardrailDecisionId: createGuardrailDecisionId(`guardrail:${this.uuidGenerator.random()}`),
        outboundIntentRef: intentResult.value.outboundIntentRef,
      },
      input.context,
    );

    if (!guardrailResult.ok) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: guardrailResult.error.retryable,
        resultRef: original.id,
        reasonCode: guardrailResult.error.code,
      });
    }

    const retryMessage = createOutboundMessageIntent({
      id: createMessageId(`msg:${this.uuidGenerator.random()}`),
      instanceId: sessionResult.value.instance.id,
      type: original.type,
    });

    try {
      await this.messageRepository.save(retryMessage);
      await this.messageRepository.recordIdempotencyKey?.(input.idempotencyKey, retryMessage.id);
    } catch {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: true,
        reasonCode: "retry_message_save_failed",
      });
    }

    const bindResult = await this.outboundMessageIntentStore.bindMessageIntent(
      {
        outboundIntentRef: intentResult.value.outboundIntentRef,
        messageId: retryMessage.id,
      },
      input.context,
    );

    if (!bindResult.ok) {
      await this.saveFailedMessage(retryMessage);
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: bindResult.error.retryable,
        reasonCode: bindResult.error.code,
        resultRef: retryMessage.id,
      });
    }

    const queueResult = await this.queueRetryMessage(
      envelope,
      retryMessage,
      intentResult.value.outboundIntentRef,
      input,
    );

    if (!queueResult.ok) {
      await this.saveFailedMessage(retryMessage);
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: queueResult.error.retryable,
        reasonCode: queueResult.error.code,
        resultRef: retryMessage.id,
      });
    }

    const accepted = this.guardrailService.acceptMessageAfterGuardrailPass(
      retryMessage,
      guardrailResult.value,
      intentResult.value.outboundIntentRef,
      input.context,
    );

    if (!accepted.ok) {
      await this.saveFailedMessage(retryMessage);
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: accepted.error.retryable,
        reasonCode: accepted.error.code,
        resultRef: retryMessage.id,
      });
    }

    const queued = queueMessage(accepted.value);

    await this.messageRepository.save(queued);
    const publishResult = await this.publishMessageEvents(envelope, queued, 0, input.context);

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

  private async queueRetryMessage(
    envelope: ApplicationCommandEnvelope,
    message: Message,
    outboundIntentRef: OutboundMessageIntentRef,
    input: RetryMessageSendInput,
  ): Promise<ApplicationPortResult<unknown>> {
    return this.queueProvider.enqueue(
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
        idempotencyKey: String(input.idempotencyKey),
        safeInputRef: String(outboundIntentRef),
        safeMetadata: {
          jobKind: "outbound_message",
          instanceId: String(message.instanceId),
          messageId: String(message.id),
          outboundIntentRef: String(outboundIntentRef),
        },
      },
      commandContext(envelope),
    );
  }

  private resolveInput(
    envelope: ApplicationCommandEnvelope,
  ): RetryMessageSendInput | Readonly<{ ok: false; reasonCode: string }> {
    if (envelope.name !== "RetryMessageSend") {
      return { ok: false, reasonCode: "retry_message_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: "retry_message_target_required" };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: "retry_message_idempotency_required" };
    }

    try {
      return {
        ok: true,
        messageId: createMessageId(envelope.targetRef),
        idempotencyKey: createIdempotencyKey(`retry_message:${envelope.idempotencyKey}`),
        context: commandContext(envelope),
      };
    } catch {
      return { ok: false, reasonCode: "retry_message_input_invalid" };
    }
  }

  private async saveFailedMessage(message: Message): Promise<void> {
    try {
      await this.messageRepository.save(failMessage(message, "queue"));
    } catch {
      // Preserve the original application failure; persistence retry is handled by the caller.
    }
  }

  private async publishMessageEvents(
    envelope: ApplicationCommandEnvelope,
    message: Message,
    baseEventCount: number,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<unknown>> {
    return this.domainEventPublisher.publishNewEvents({
      aggregateEvents: message.domainEvents,
      baseEventCount,
      executionRef: `${envelope.commandRef}:retry-message`,
      context,
    });
  }
}

function isRetryableOriginalMessage(message: Message): boolean {
  return (
    message.direction === "outbound" &&
    message.type === "text" &&
    message.status === "failed" &&
    message.guardrailDecisionId !== undefined
  );
}

function outcomeForExistingRetryMessage(
  envelope: ApplicationCommandEnvelope,
  message: Message,
): ApplicationCommandOutcome {
  if (message.status === "sent" || message.status === "delivered" || message.status === "read") {
    return commandOutcome(envelope, "completed", {
      accepted: true,
      retryable: false,
      resultRef: message.id,
    });
  }

  if (message.status === "queued" || message.status === "processing") {
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
        ? "retry_message_previously_started"
        : "retry_message_previously_failed",
  });
}

function commandContext(envelope: ApplicationCommandEnvelope): ApplicationPortContext {
  return {
    requestContext: envelope.requestContext,
    ...(envelope.actorRef === undefined ? {} : { actorRef: envelope.actorRef }),
    ...(envelope.idempotencyKey === undefined ? {} : { idempotencyKey: envelope.idempotencyKey }),
    ...(envelope.dataClassification === undefined
      ? {}
      : { dataClassification: envelope.dataClassification }),
  };
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
