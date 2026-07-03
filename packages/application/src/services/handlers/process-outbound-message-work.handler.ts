import {
  createMessageId,
  createProviderId,
  failMessage,
  markMessageProcessing,
  markMessageSent,
  type FailureCategory,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type ProviderId,
} from "@omniwa/domain";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type { MessagingProviderPort } from "../../ports/messaging-provider.js";
import {
  createOutboundMessageIntentRef,
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
} from "../../ports/outbound-message-intent-store.js";
import type { ActiveSessionResolver } from "../active-session-resolver.js";
import type { DomainEventPublisher } from "../domain-event-publisher.js";
import type { CommandHandler } from "./command-handler.js";

export type ProcessOutboundMessageWorkHandlerOptions = Readonly<{
  activeSessionResolver: ActiveSessionResolver;
  messageRepository: MessageRepositoryPort;
  outboundMessageIntentStore: OutboundMessageIntentStorePort;
  messagingProvider: MessagingProviderPort;
  domainEventPublisher: DomainEventPublisher;
  providerId?: ProviderId;
}>;

type ProcessOutboundMessageWorkInput = Readonly<{
  ok: true;
  messageId: MessageId;
  outboundIntentRef: OutboundMessageIntentRef;
  context: Parameters<ActiveSessionResolver["resolveActiveSession"]>[1];
}>;

const defaultProviderId = createProviderId("baileys");

export function createProcessOutboundMessageWorkHandler(
  options: ProcessOutboundMessageWorkHandlerOptions,
): CommandHandler {
  const handler = new ProcessOutboundMessageWorkHandler(options);
  return (envelope) => handler.handle(envelope);
}

class ProcessOutboundMessageWorkHandler {
  private readonly activeSessionResolver: ActiveSessionResolver;
  private readonly messageRepository: MessageRepositoryPort;
  private readonly outboundMessageIntentStore: OutboundMessageIntentStorePort;
  private readonly messagingProvider: MessagingProviderPort;
  private readonly domainEventPublisher: DomainEventPublisher;
  private readonly providerId: ProviderId;

  constructor(options: ProcessOutboundMessageWorkHandlerOptions) {
    this.activeSessionResolver = options.activeSessionResolver;
    this.messageRepository = options.messageRepository;
    this.outboundMessageIntentStore = options.outboundMessageIntentStore;
    this.messagingProvider = options.messagingProvider;
    this.domainEventPublisher = options.domainEventPublisher;
    this.providerId = options.providerId ?? defaultProviderId;
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

    const message = await this.messageRepository.load(input.messageId);

    if (message === undefined) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: "outbound_message_not_found",
      });
    }

    if (["sent", "delivered", "read"].includes(message.status)) {
      return commandOutcome(envelope, "completed", {
        accepted: true,
        retryable: false,
        resultRef: message.id,
      });
    }

    if (message.status === "failed" || message.status === "cancelled") {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        resultRef: message.id,
        reasonCode: "outbound_message_not_dispatchable",
      });
    }

    if (message.status === "created" || message.status === "evaluated") {
      return commandOutcome(envelope, "waiting", {
        accepted: false,
        retryable: true,
        resultRef: message.id,
        reasonCode: "outbound_message_not_queued",
      });
    }

    const sessionResult = await this.activeSessionResolver.resolveActiveSession(
      message.instanceId,
      input.context,
    );

    if (!sessionResult.ok) {
      if (!sessionResult.error.retryable) {
        await this.saveFailedMessage(envelope, message, "session", input.context);
      }

      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: sessionResult.error.retryable,
        resultRef: message.id,
        reasonCode: sessionResult.error.code,
      });
    }

    const intentResult = await this.outboundMessageIntentStore.verifyTextIntent(
      input.outboundIntentRef,
      input.context,
    );

    if (!intentResult.ok) {
      if (!intentResult.error.retryable) {
        await this.saveFailedMessage(envelope, message, "business", input.context);
      }

      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: intentResult.error.retryable,
        resultRef: message.id,
        reasonCode: intentResult.error.code,
      });
    }

    const processingResult = await this.ensureProcessing(envelope, message, input.context);

    if (!processingResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: processingResult.retryable,
        resultRef: message.id,
        reasonCode: processingResult.reasonCode,
      });
    }

    const providerResult = await this.messagingProvider.sendOutboundMessage(
      {
        instanceId: processingResult.message.instanceId,
        providerId: this.providerId,
        sessionId: sessionResult.value.sessionId,
        messageId: processingResult.message.id,
        messageType: processingResult.message.type,
        outboundIntentRef: String(input.outboundIntentRef),
        idempotencyKey: envelope.idempotencyKey ?? envelope.commandRef,
      },
      input.context,
    );

    if (!providerResult.ok) {
      if (!providerResult.error.retryable) {
        await this.saveFailedMessage(
          envelope,
          processingResult.message,
          providerResult.error.failureCategory ?? "provider",
          input.context,
        );
      }

      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: providerResult.error.retryable,
        resultRef: processingResult.message.id,
        reasonCode: providerResult.error.code,
      });
    }

    if (providerResult.value.status === "accepted") {
      const baseEventCount = processingResult.message.domainEvents.length;
      const sent = markMessageSent(processingResult.message);

      await this.messageRepository.save(sent);
      await this.publishMessageEvents(envelope, sent, baseEventCount, input.context, "sent");

      return commandOutcome(envelope, "completed", {
        accepted: true,
        retryable: false,
        resultRef: sent.id,
      });
    }

    if (providerResult.value.retryable) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: true,
        resultRef: processingResult.message.id,
        reasonCode: "provider_send_retryable_failure",
      });
    }

    await this.saveFailedMessage(
      envelope,
      processingResult.message,
      providerResult.value.failureCategory ?? "provider",
      input.context,
    );

    return commandOutcome(envelope, "failed", {
      accepted: false,
      retryable: false,
      resultRef: processingResult.message.id,
      reasonCode:
        providerResult.value.status === "rejected"
          ? "provider_send_rejected"
          : "provider_send_unknown_terminal",
    });
  }

  private resolveInput(
    envelope: ApplicationCommandEnvelope,
  ): ProcessOutboundMessageWorkInput | Readonly<{ ok: false; reasonCode: string }> {
    if (envelope.name !== "ProcessOutboundMessageWork") {
      return { ok: false, reasonCode: "process_outbound_message_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: "process_outbound_message_target_required" };
    }

    if (envelope.safeInputRef === undefined) {
      return { ok: false, reasonCode: "process_outbound_message_intent_ref_required" };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: "process_outbound_message_idempotency_required" };
    }

    try {
      return {
        ok: true,
        messageId: createMessageId(envelope.targetRef),
        outboundIntentRef: createOutboundMessageIntentRef(envelope.safeInputRef),
        context: commandContext(envelope),
      };
    } catch {
      return { ok: false, reasonCode: "process_outbound_message_input_invalid" };
    }
  }

  private async ensureProcessing(
    envelope: ApplicationCommandEnvelope,
    message: Message,
    context: ProcessOutboundMessageWorkInput["context"],
  ): Promise<
    | Readonly<{ ok: true; message: Message }>
    | Readonly<{ ok: false; retryable: boolean; reasonCode: string }>
  > {
    if (message.status === "processing") {
      return { ok: true, message };
    }

    const baseEventCount = message.domainEvents.length;

    try {
      const processing = markMessageProcessing(message);
      await this.messageRepository.save(processing);
      const publishResult = await this.publishMessageEvents(
        envelope,
        processing,
        baseEventCount,
        context,
        "processing",
      );

      if (!publishResult.ok) {
        return {
          ok: false,
          retryable: publishResult.retryable,
          reasonCode: publishResult.reasonCode,
        };
      }

      return { ok: true, message: processing };
    } catch {
      return {
        ok: false,
        retryable: true,
        reasonCode: "outbound_message_processing_failed",
      };
    }
  }

  private async saveFailedMessage(
    envelope: ApplicationCommandEnvelope,
    message: Message,
    failureCategory: FailureCategory,
    context: ProcessOutboundMessageWorkInput["context"],
  ): Promise<void> {
    try {
      const baseEventCount = message.domainEvents.length;
      const failed = failMessage(message, failureCategory);

      await this.messageRepository.save(failed);
      await this.publishMessageEvents(envelope, failed, baseEventCount, context, "failed");
    } catch {
      // Preserve the original safe worker outcome; retry/dead-letter is handled by WorkerRuntime.
    }
  }

  private async publishMessageEvents(
    envelope: ApplicationCommandEnvelope,
    message: Message,
    baseEventCount: number,
    context: ProcessOutboundMessageWorkInput["context"],
    phase: string,
  ): Promise<
    Readonly<{ ok: true }> | Readonly<{ ok: false; retryable: boolean; reasonCode: string }>
  > {
    const result = await this.domainEventPublisher.publishNewEvents({
      aggregateEvents: message.domainEvents,
      baseEventCount,
      executionRef: `${envelope.commandRef}:message:${phase}`,
      context,
    });

    if (!result.ok) {
      return {
        ok: false,
        retryable: result.error.retryable,
        reasonCode: result.error.code,
      };
    }

    return { ok: true };
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
