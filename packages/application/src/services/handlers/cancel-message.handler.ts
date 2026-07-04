import {
  cancelMessage,
  createIdempotencyKey,
  createMessageId,
  type IdempotencyKey,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
} from "@omniwa/domain";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type { ApplicationPortContext } from "../../ports/application-port.js";
import type { DomainEventPublisher } from "../domain-event-publisher.js";
import type { CommandHandler } from "./command-handler.js";

type IdempotencyAwareMessageRepository = MessageRepositoryPort &
  Partial<{
    recordIdempotencyKey(
      idempotencyKey: IdempotencyKey,
      messageId: MessageId,
    ): Promise<void> | void;
  }>;

export type CancelMessageHandlerOptions = Readonly<{
  messageRepository: IdempotencyAwareMessageRepository;
  domainEventPublisher: DomainEventPublisher;
}>;

type CancelMessageInput = Readonly<{
  ok: true;
  messageId: MessageId;
  idempotencyKey: IdempotencyKey;
  context: ApplicationPortContext;
}>;

export function createCancelMessageHandler(options: CancelMessageHandlerOptions): CommandHandler {
  const handler = new CancelMessageHandler(options);
  return (envelope) => handler.handle(envelope);
}

class CancelMessageHandler {
  private readonly messageRepository: IdempotencyAwareMessageRepository;
  private readonly domainEventPublisher: DomainEventPublisher;

  constructor(options: CancelMessageHandlerOptions) {
    this.messageRepository = options.messageRepository;
    this.domainEventPublisher = options.domainEventPublisher;
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
      return outcomeForCancelledMessage(envelope, existing);
    }

    const message = await this.messageRepository.load(input.messageId);

    if (message === undefined) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: "cancel_message_not_found",
      });
    }

    if (message.status === "cancelled") {
      await this.messageRepository.recordIdempotencyKey?.(input.idempotencyKey, message.id);
      return outcomeForCancelledMessage(envelope, message);
    }

    if (!isCancellableMessage(message)) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: false,
        resultRef: message.id,
        reasonCode: "cancel_message_not_allowed",
      });
    }

    const baseEventCount = message.domainEvents.length;
    let cancelled: Message;

    try {
      cancelled = cancelMessage(message);
      await this.messageRepository.save(cancelled);
      await this.messageRepository.recordIdempotencyKey?.(input.idempotencyKey, cancelled.id);
    } catch {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: true,
        resultRef: message.id,
        reasonCode: "cancel_message_save_failed",
      });
    }

    const publishResult = await this.domainEventPublisher.publishNewEvents({
      aggregateEvents: cancelled.domainEvents,
      baseEventCount,
      executionRef: `${envelope.commandRef}:cancel-message`,
      context: input.context,
    });

    if (!publishResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: true,
        retryable: publishResult.error.retryable,
        resultRef: cancelled.id,
        reasonCode: publishResult.error.code,
      });
    }

    return outcomeForCancelledMessage(envelope, cancelled);
  }

  private resolveInput(
    envelope: ApplicationCommandEnvelope,
  ): CancelMessageInput | Readonly<{ ok: false; reasonCode: string }> {
    if (envelope.name !== "CancelMessage") {
      return { ok: false, reasonCode: "cancel_message_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: "cancel_message_target_required" };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: "cancel_message_idempotency_required" };
    }

    try {
      return {
        ok: true,
        messageId: createMessageId(envelope.targetRef),
        idempotencyKey: createIdempotencyKey(`cancel_message:${envelope.idempotencyKey}`),
        context: commandContext(envelope),
      };
    } catch {
      return { ok: false, reasonCode: "cancel_message_input_invalid" };
    }
  }
}

function isCancellableMessage(message: Message): boolean {
  return (
    message.direction === "outbound" &&
    (message.status === "created" ||
      message.status === "evaluated" ||
      message.status === "queued" ||
      message.status === "processing")
  );
}

function outcomeForCancelledMessage(
  envelope: ApplicationCommandEnvelope,
  message: Message,
): ApplicationCommandOutcome {
  return commandOutcome(envelope, "accepted", {
    accepted: true,
    retryable: false,
    resultRef: message.id,
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
