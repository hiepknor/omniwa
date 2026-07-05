import type {
  ApplicationPortContext,
  QueueProviderPort,
  QueueReservation,
  WebhookDeliveryEnvelope,
  WebhookTransportPort,
} from "@omniwa/application";
import type {
  WebhookDelivery,
  WebhookDeliveryId,
  WebhookDeliveryRepositoryPort,
  WebhookSubscription,
  WebhookSubscriptionRepositoryPort,
} from "@omniwa/domain";
import { createWebhookDeliveryId } from "@omniwa/domain";
import {
  RepositoryWebhookDeliveryWorkHandler,
  WebhookDispatcherRuntime,
  WebhookTransportDeliveryHandler,
  type WebhookDeliveryEnvelopeResolver,
  type WebhookDispatchAuditSink,
} from "@omniwa/infrastructure-webhook";
import type { MetricRecorder } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

export const webhookDispatcherAppActorRef = "webhook-dispatcher";

export type {
  WebhookDispatchAuditEntry,
  WebhookDispatchAuditSink,
} from "@omniwa/infrastructure-webhook";

export type WebhookDispatcherAppOptions = Readonly<{
  runtime: WebhookDispatcherRuntime;
  contextFactory?: () => ApplicationPortContext;
}>;

export type WebhookDispatcherRuntimeFactoryOptions = Readonly<{
  queueProvider: QueueProviderPort;
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  transport: WebhookTransportPort;
  envelopeResolver: WebhookDeliveryEnvelopeResolver;
  defaultRetryDelayMilliseconds?: number;
  retryDelayMilliseconds?: number;
  metricRecorder?: MetricRecorder;
  auditSink?: WebhookDispatchAuditSink;
}>;

export type RepositoryWebhookDeliveryEnvelopeResolverOptions = Readonly<{
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  webhookSubscriptionRepository: WebhookSubscriptionRepositoryPort;
  dataClassification?: WebhookDeliveryEnvelope["dataClassification"];
  deliveryIdFromReservation?: (reservationJobId: string) => WebhookDeliveryId;
  payloadRefForDelivery?: (delivery: WebhookDelivery) => string;
  signingSecretRefForDelivery?: (
    delivery: WebhookDelivery,
    subscription: WebhookSubscription,
  ) => string | undefined;
}>;

export class WebhookDispatcherApp {
  private readonly runtime: WebhookDispatcherRuntime;
  private readonly contextFactory: () => ApplicationPortContext;

  constructor(options: WebhookDispatcherAppOptions) {
    this.runtime = options.runtime;
    this.contextFactory = options.contextFactory ?? createWebhookDispatcherContext;
  }

  runOnce(context: ApplicationPortContext = this.contextFactory()) {
    return this.runtime.dispatchNext(context);
  }
}

export class RepositoryWebhookDeliveryEnvelopeResolver implements WebhookDeliveryEnvelopeResolver {
  private readonly webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  private readonly webhookSubscriptionRepository: WebhookSubscriptionRepositoryPort;
  private readonly dataClassification: WebhookDeliveryEnvelope["dataClassification"];
  private readonly deliveryIdFromReservation: (reservationJobId: string) => WebhookDeliveryId;
  private readonly payloadRefForDelivery: (delivery: WebhookDelivery) => string;
  private readonly signingSecretRefForDelivery:
    | ((delivery: WebhookDelivery, subscription: WebhookSubscription) => string | undefined)
    | undefined;

  constructor(options: RepositoryWebhookDeliveryEnvelopeResolverOptions) {
    this.webhookDeliveryRepository = options.webhookDeliveryRepository;
    this.webhookSubscriptionRepository = options.webhookSubscriptionRepository;
    this.dataClassification = options.dataClassification ?? "internal";
    this.deliveryIdFromReservation =
      options.deliveryIdFromReservation ?? ((jobId) => createWebhookDeliveryId(jobId));
    this.payloadRefForDelivery =
      options.payloadRefForDelivery ??
      ((delivery) => `payload.${delivery.sourceSignalRef}.${delivery.id}`);
    this.signingSecretRefForDelivery = options.signingSecretRefForDelivery;
  }

  async resolve(
    reservation: QueueReservation,
    context: ApplicationPortContext,
  ): Promise<WebhookDeliveryEnvelope | undefined> {
    void context;

    const delivery = await this.webhookDeliveryRepository.load(
      this.deliveryIdFromReservation(reservation.jobId.toString()),
    );

    if (delivery === undefined) {
      return undefined;
    }

    const subscription = await this.webhookSubscriptionRepository.load(delivery.webhookId);

    if (subscription === undefined || subscription.status !== "active") {
      return undefined;
    }

    return Object.freeze({
      webhookId: delivery.webhookId,
      deliveryId: delivery.id,
      targetUrl: subscription.targetUrl,
      sourceSignalRef: delivery.sourceSignalRef,
      payloadRef: this.payloadRefForDelivery(delivery),
      eventVersion: "v1",
      dataClassification: this.dataClassification,
      ...optional("signingSecretRef", this.signingSecretRefForDelivery?.(delivery, subscription)),
    });
  }
}

export function createWebhookDispatcherRuntime(
  options: WebhookDispatcherRuntimeFactoryOptions,
): WebhookDispatcherRuntime {
  const transportHandler = new WebhookTransportDeliveryHandler({
    envelopeResolver: options.envelopeResolver,
    transport: options.transport,
    ...optional("retryDelayMilliseconds", options.retryDelayMilliseconds),
  });

  return new WebhookDispatcherRuntime({
    queueProvider: options.queueProvider,
    handler: new RepositoryWebhookDeliveryWorkHandler({
      webhookDeliveryRepository: options.webhookDeliveryRepository,
      innerHandler: transportHandler,
    }),
    ...optional("defaultRetryDelayMilliseconds", options.defaultRetryDelayMilliseconds),
    ...optional("metricRecorder", options.metricRecorder),
    ...optional("auditSink", options.auditSink),
  });
}

export function createWebhookDispatcherContext(): ApplicationPortContext {
  const id = randomUUID();

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`webhook-dispatcher:${id}`),
      requestId: createRequestId(`webhook-dispatcher:${id}`),
    }),
    actorRef: webhookDispatcherAppActorRef,
    idempotencyKey: `webhook-dispatcher:${id}`,
    dataClassification: "internal",
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
