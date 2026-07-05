import {
  createIdempotencyKey,
  createJobId,
  createWebhookDeliveryId,
  scheduleWebhookDelivery,
  type IdempotencyKey,
  type WebhookDelivery,
  type WebhookDeliveryId,
  type WebhookDeliveryRepositoryPort,
} from "@omniwa/domain";

import {
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  createApplicationCommandOutcome,
} from "../../commands/command-model.js";
import type {
  ApplicationPortContext,
  ApplicationPortResult,
} from "../../ports/application-port.js";
import type { QueueProviderPort } from "../../ports/queue-provider.js";
import type { CommandHandler } from "./command-handler.js";

export type RetryWebhookDeliveryHandlerOptions = Readonly<{
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  queueProvider: QueueProviderPort;
}>;

type RetryWebhookDeliveryInput = Readonly<{
  ok: true;
  mode: "retry" | "redrive";
  deliveryId: WebhookDeliveryId;
  idempotencyKey: IdempotencyKey;
  context: ApplicationPortContext;
}>;

type IdempotencyAwareWebhookDeliveryRepository = WebhookDeliveryRepositoryPort &
  Partial<{
    recordIdempotencyKey(
      idempotencyKey: IdempotencyKey,
      deliveryId: WebhookDeliveryId,
    ): Promise<void> | void;
  }>;

export function createRetryWebhookDeliveryHandler(
  options: RetryWebhookDeliveryHandlerOptions,
): CommandHandler {
  const handler = new RetryWebhookDeliveryHandler(options);
  return (envelope) => handler.handle(envelope);
}

class RetryWebhookDeliveryHandler {
  private readonly webhookDeliveryRepository: IdempotencyAwareWebhookDeliveryRepository;
  private readonly queueProvider: QueueProviderPort;

  constructor(options: RetryWebhookDeliveryHandlerOptions) {
    this.webhookDeliveryRepository = options.webhookDeliveryRepository;
    this.queueProvider = options.queueProvider;
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

    const delivery = await this.webhookDeliveryRepository.load(input.deliveryId);

    if (delivery === undefined) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: false,
        reasonCode: "webhook_delivery_not_found",
      });
    }

    if (!isDeliveryStateAllowed(delivery, input.mode)) {
      return commandOutcome(envelope, "rejected", {
        accepted: false,
        retryable: false,
        resultRef: delivery.id,
        reasonCode:
          input.mode === "retry"
            ? "webhook_delivery_retry_not_allowed"
            : "webhook_delivery_redrive_not_allowed",
      });
    }

    const queueDelivery =
      input.mode === "redrive" ? await this.resolveRedriveDelivery(delivery, input) : delivery;

    const queueResult = await this.queueWebhookDelivery(queueDelivery, input);

    if (!queueResult.ok) {
      return commandOutcome(envelope, "failed", {
        accepted: false,
        retryable: queueResult.error.retryable,
        resultRef: queueDelivery.id,
        reasonCode: queueResult.error.code,
      });
    }

    return commandOutcome(envelope, "queued", {
      accepted: true,
      retryable: false,
      resultRef: queueDelivery.id,
    });
  }

  private async resolveRedriveDelivery(
    delivery: WebhookDelivery,
    input: RetryWebhookDeliveryInput,
  ): Promise<WebhookDelivery> {
    const existing = await this.webhookDeliveryRepository.findByIdempotencyKey(
      input.idempotencyKey,
    );

    if (existing !== undefined) {
      return existing;
    }

    const redriveDelivery = scheduleWebhookDelivery(
      createWebhookDeliveryId(`${delivery.id}:redrive:${input.idempotencyKey}`),
      delivery.webhookId,
      delivery.sourceSignalRef,
      delivery.retryPolicy,
    );

    await this.webhookDeliveryRepository.save(redriveDelivery);
    await this.webhookDeliveryRepository.recordIdempotencyKey?.(
      input.idempotencyKey,
      redriveDelivery.id,
    );

    return redriveDelivery;
  }

  private queueWebhookDelivery(
    delivery: WebhookDelivery,
    input: RetryWebhookDeliveryInput,
  ): Promise<ApplicationPortResult<unknown>> {
    return this.queueProvider.enqueue(
      {
        jobId: createJobId(String(delivery.id)),
        ownerContext: "webhook_delivery",
        ownerRef: String(delivery.id),
        workType: "webhook_delivery",
        retryPolicy: delivery.retryPolicy,
        idempotencyKey: String(input.idempotencyKey),
      },
      input.context,
    );
  }

  private resolveInput(
    envelope: ApplicationCommandEnvelope,
  ): RetryWebhookDeliveryInput | Readonly<{ ok: false; reasonCode: string }> {
    const mode = retryModeForCommand(envelope.name);

    if (mode === undefined) {
      return { ok: false, reasonCode: "webhook_delivery_operation_wrong_command" };
    }

    if (envelope.targetRef === undefined) {
      return { ok: false, reasonCode: `${mode}_webhook_delivery_target_required` };
    }

    if (envelope.idempotencyKey === undefined) {
      return { ok: false, reasonCode: `${mode}_webhook_delivery_idempotency_required` };
    }

    try {
      return {
        ok: true,
        mode,
        deliveryId: createWebhookDeliveryId(envelope.targetRef),
        idempotencyKey: createIdempotencyKey(`${mode}_webhook_delivery:${envelope.idempotencyKey}`),
        context: commandContext(envelope),
      };
    } catch {
      return { ok: false, reasonCode: `${mode}_webhook_delivery_input_invalid` };
    }
  }
}

function retryModeForCommand(commandName: string): RetryWebhookDeliveryInput["mode"] | undefined {
  switch (commandName) {
    case "RetryWebhookDelivery":
      return "retry";
    case "RedriveWebhookDelivery":
      return "redrive";
    default:
      return undefined;
  }
}

function isDeliveryStateAllowed(
  delivery: WebhookDelivery,
  mode: RetryWebhookDeliveryInput["mode"],
): boolean {
  if (mode === "redrive") {
    return delivery.status === "dead_letter";
  }

  return delivery.status === "pending" || delivery.status === "retrying";
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
