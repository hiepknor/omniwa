import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortFailureCategory,
  type ApplicationPortResult,
  type WebhookDeliveryEnvelope,
  type WebhookTransportOutcome,
  type WebhookTransportPort,
  type WebhookTransportReceipt,
} from "@omniwa/application";
import { createFailureCategory, type FailureCategory } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

export type WebhookOutboundRequest = Readonly<{
  method: "POST";
  targetUrl: string;
  headers: Readonly<Record<string, string>>;
  body: WebhookOutboundBody;
  timeoutMilliseconds: number;
}>;

export type WebhookOutboundBody = Readonly<{
  deliveryId: string;
  webhookId: string;
  sourceSignalRef: string;
  payloadRef: string;
  eventVersion: "v1";
  dataClassification: WebhookDeliveryEnvelope["dataClassification"];
  correlationId: string;
}>;

export type WebhookOutboundResult = Readonly<{
  statusCode: number;
  receiverRef?: string;
  failureReasonCode?: string;
}>;

export type WebhookHttpGateway = Readonly<{
  sendWebhook(
    request: WebhookOutboundRequest,
    context: ApplicationPortContext,
  ): Promise<WebhookOutboundResult> | WebhookOutboundResult;
}>;

export type WebhookSignatureInput = Readonly<{
  deliveryId: string;
  webhookId: string;
  payloadRef: string;
  signingSecretRef: string;
  correlationId: string;
  body: WebhookOutboundBody;
}>;

export type WebhookSignatureResult = Readonly<{
  scheme: "v1";
  signature: string;
  timestamp: string;
}>;

export type WebhookSignatureProvider = Readonly<{
  createSignature(
    input: WebhookSignatureInput,
  ): Promise<WebhookSignatureResult> | WebhookSignatureResult;
}>;

export type HttpWebhookTransportAdapterOptions = Readonly<{
  gateway: WebhookHttpGateway;
  signatureProvider?: WebhookSignatureProvider;
  timeoutMilliseconds?: number;
}>;

export class WebhookTransportAdapterError extends Error {
  readonly code: string;
  readonly category: ApplicationPortFailureCategory;
  readonly failureCategory: FailureCategory;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    category: ApplicationPortFailureCategory;
    failureCategory: FailureCategory;
    retryable: boolean;
    message: string;
  }) {
    super(input.message);
    this.name = "WebhookTransportAdapterError";
    this.code = input.code;
    this.category = input.category;
    this.failureCategory = input.failureCategory;
    this.retryable = input.retryable;
  }
}

export class HttpWebhookTransportAdapter implements WebhookTransportPort {
  private readonly gateway: WebhookHttpGateway;
  private readonly signatureProvider: WebhookSignatureProvider | undefined;
  private readonly timeoutMilliseconds: number;

  constructor(options: HttpWebhookTransportAdapterOptions) {
    this.gateway = options.gateway;
    this.signatureProvider = options.signatureProvider;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
    assertPositiveInteger(this.timeoutMilliseconds, "timeoutMilliseconds");
  }

  async deliver(
    envelope: WebhookDeliveryEnvelope,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WebhookTransportReceipt>> {
    try {
      assertEnvelopeSafe(envelope);

      const body = freezeWebhookOutboundBody({
        deliveryId: String(envelope.deliveryId),
        webhookId: String(envelope.webhookId),
        sourceSignalRef: envelope.sourceSignalRef,
        payloadRef: envelope.payloadRef,
        eventVersion: envelope.eventVersion,
        dataClassification: envelope.dataClassification,
        correlationId: String(context.requestContext.correlationId),
      });
      const headers = await this.createHeaders(envelope, context, body);
      const result = await this.gateway.sendWebhook(
        {
          method: "POST",
          targetUrl: String(envelope.targetUrl),
          headers,
          body,
          timeoutMilliseconds: this.timeoutMilliseconds,
        },
        context,
      );

      const outcome = classifyStatusCode(result.statusCode);
      const receipt = freezeWebhookTransportReceipt({
        deliveryId: envelope.deliveryId,
        outcome,
        ...optional("receiverRef", result.receiverRef),
        ...optional("failureReasonCode", result.failureReasonCode ?? failureReasonFor(outcome)),
      });

      return ok(receipt);
    } catch (error) {
      return err(webhookTransportErrorToPortFailure(error, "deliver"));
    }
  }

  private async createHeaders(
    envelope: WebhookDeliveryEnvelope,
    context: ApplicationPortContext,
    body: WebhookOutboundBody,
  ): Promise<Readonly<Record<string, string>>> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-omniwa-correlation-id": String(context.requestContext.correlationId),
      "x-omniwa-delivery-id": String(envelope.deliveryId),
      "x-omniwa-event-version": envelope.eventVersion,
      "x-omniwa-payload-ref": envelope.payloadRef,
      "x-omniwa-webhook-id": String(envelope.webhookId),
    };

    if (envelope.signingSecretRef === undefined) {
      return Object.freeze(headers);
    }

    if (this.signatureProvider === undefined) {
      throw new WebhookTransportAdapterError({
        category: "rejected",
        code: "webhook_signature_provider_missing",
        message: "Webhook signing secret reference requires a signature provider.",
        retryable: false,
        failureCategory: createFailureCategory("configuration"),
      });
    }

    const signature = await this.signatureProvider.createSignature({
      deliveryId: String(envelope.deliveryId),
      webhookId: String(envelope.webhookId),
      payloadRef: envelope.payloadRef,
      signingSecretRef: envelope.signingSecretRef,
      correlationId: String(context.requestContext.correlationId),
      body,
    });

    assertSafeReference(signature.signature, envelope.signingSecretRef, "signature");
    assertReferencePresent(signature.timestamp, "signatureTimestamp");
    headers["x-omniwa-signature"] = signature.signature;
    headers["x-omniwa-signature-scheme"] = signature.scheme;
    headers["x-omniwa-signature-timestamp"] = signature.timestamp;

    return Object.freeze(headers);
  }
}

function assertEnvelopeSafe(envelope: WebhookDeliveryEnvelope): void {
  assertReferencePresent(envelope.sourceSignalRef, "sourceSignalRef");
  assertReferencePresent(envelope.payloadRef, "payloadRef");
}

function assertReferencePresent(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new WebhookTransportAdapterError({
      category: "unsafe_payload",
      code: "webhook_unsafe_reference",
      message: `${label} must be non-empty.`,
      retryable: false,
      failureCategory: createFailureCategory("webhook"),
    });
  }
}

function assertSafeReference(value: string, forbiddenValue: string, label: string): void {
  assertReferencePresent(value, label);

  if (value.includes(forbiddenValue)) {
    throw new WebhookTransportAdapterError({
      category: "unsafe_payload",
      code: "webhook_unsafe_reference",
      message: `${label} must not expose sensitive material.`,
      retryable: false,
      failureCategory: createFailureCategory("webhook"),
    });
  }
}

function classifyStatusCode(statusCode: number): WebhookTransportOutcome {
  if (statusCode >= 200 && statusCode < 300) {
    return "delivered";
  }

  if (statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429) {
    return "retryable_failure";
  }

  if (statusCode >= 500 && statusCode < 600) {
    return "retryable_failure";
  }

  return "terminal_failure";
}

function failureReasonFor(outcome: WebhookTransportOutcome): string | undefined {
  switch (outcome) {
    case "delivered":
      return undefined;
    case "retryable_failure":
      return "receiver_retryable_failure";
    case "terminal_failure":
      return "receiver_terminal_failure";
  }
}

function webhookTransportErrorToPortFailure(
  error: unknown,
  operation: string,
): ApplicationPortFailure {
  if (error instanceof WebhookTransportAdapterError) {
    return webhookTransportPortFailure({
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      failureCategory: error.failureCategory,
      operation,
    });
  }

  return webhookTransportPortFailure({
    category: "unavailable",
    code: "webhook_transport_failure",
    message: "Webhook transport failed with a sanitized transport error.",
    retryable: true,
    failureCategory: createFailureCategory("network"),
    operation,
  });
}

function webhookTransportPortFailure(input: {
  category: ApplicationPortFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  failureCategory: FailureCategory;
  operation: string;
}): ApplicationPortFailure {
  return createApplicationPortFailure({
    category: input.category,
    code: input.code,
    message: input.message,
    retryable: input.retryable,
    ownerContext: "webhook_delivery",
    failureCategory: input.failureCategory,
    safeMetadata: {
      operation: input.operation,
    },
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

function freezeWebhookOutboundBody(body: WebhookOutboundBody): WebhookOutboundBody {
  return Object.freeze(body);
}

function freezeWebhookTransportReceipt(receipt: WebhookTransportReceipt): WebhookTransportReceipt {
  return Object.freeze(receipt);
}
