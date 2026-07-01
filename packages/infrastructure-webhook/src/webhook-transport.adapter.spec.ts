import type { ApplicationPortContext, WebhookDeliveryEnvelope } from "@omniwa/application";
import {
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookUrl,
  type WebhookDeliveryId,
  type WebhookId,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  HttpWebhookTransportAdapter,
  WebhookTransportAdapterError,
  type WebhookHttpGateway,
  type WebhookOutboundRequest,
  type WebhookOutboundResult,
  type WebhookSignatureInput,
  type WebhookSignatureProvider,
  type WebhookSignatureResult,
} from "./webhook-transport.adapter.js";

const webhookId = createWebhookId("webhook_transport_1");
const deliveryId = createWebhookDeliveryId("webhook_delivery_transport_1");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("webhook-transport-correlation"),
    requestId: createRequestId("webhook-transport-request"),
  }),
  actorRef: "webhook.dispatcher",
  dataClassification: "internal",
};

describe("HttpWebhookTransportAdapter", () => {
  it("delivers a sanitized webhook envelope through the gateway", async () => {
    const gateway = new FakeWebhookHttpGateway({
      result: {
        statusCode: 202,
        receiverRef: "receiver.ack.1",
      },
    });
    const adapter = new HttpWebhookTransportAdapter({ gateway });

    const result = await adapter.deliver(createEnvelope(), context);

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value).toEqual({
      deliveryId,
      outcome: "delivered",
      receiverRef: "receiver.ack.1",
    });
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toMatchObject({
      method: "POST",
      targetUrl: "https://receiver.example.test/webhooks",
      timeoutMilliseconds: 10_000,
      body: {
        deliveryId: "webhook_delivery_transport_1",
        webhookId: "webhook_transport_1",
        payloadRef: "payload.ref.1",
        eventVersion: "v1",
        dataClassification: "internal",
        correlationId: "webhook-transport-correlation",
      },
    });
    expect(gateway.requests[0]?.headers).toMatchObject({
      "content-type": "application/json",
      "x-omniwa-correlation-id": "webhook-transport-correlation",
      "x-omniwa-delivery-id": "webhook_delivery_transport_1",
      "x-omniwa-event-version": "v1",
      "x-omniwa-payload-ref": "payload.ref.1",
      "x-omniwa-webhook-id": "webhook_transport_1",
    });
  });

  it("classifies retryable and terminal receiver responses as transport receipts", async () => {
    const retryableGateway = new FakeWebhookHttpGateway({ result: { statusCode: 503 } });
    const terminalGateway = new FakeWebhookHttpGateway({
      result: {
        statusCode: 404,
        failureReasonCode: "subscription_not_found",
      },
    });
    const retryable = await new HttpWebhookTransportAdapter({
      gateway: retryableGateway,
    }).deliver(
      createEnvelope({ deliveryId: createWebhookDeliveryId("webhook_retryable_1") }),
      context,
    );
    const terminal = await new HttpWebhookTransportAdapter({
      gateway: terminalGateway,
    }).deliver(
      createEnvelope({ deliveryId: createWebhookDeliveryId("webhook_terminal_1") }),
      context,
    );

    expect(retryable.ok ? retryable.value : undefined).toMatchObject({
      outcome: "retryable_failure",
      failureReasonCode: "receiver_retryable_failure",
    });
    expect(terminal.ok ? terminal.value : undefined).toMatchObject({
      outcome: "terminal_failure",
      failureReasonCode: "subscription_not_found",
    });
  });

  it("uses an injected signature provider without exposing signing secret material", async () => {
    const gateway = new FakeWebhookHttpGateway({ result: { statusCode: 200 } });
    const signer = new FakeSignatureProvider();
    const adapter = new HttpWebhookTransportAdapter({ gateway, signatureProvider: signer });

    const result = await adapter.deliver(
      createEnvelope({
        signingSecretRef: "secret-ref-not-plaintext",
      }),
      context,
    );

    expect(result.ok).toBe(true);
    expect(signer.inputs).toEqual([
      {
        deliveryId: "webhook_delivery_transport_1",
        webhookId: "webhook_transport_1",
        payloadRef: "payload.ref.1",
        signingSecretRef: "secret-ref-not-plaintext",
        correlationId: "webhook-transport-correlation",
        body: {
          deliveryId: "webhook_delivery_transport_1",
          webhookId: "webhook_transport_1",
          sourceSignalRef: "source.signal.1",
          payloadRef: "payload.ref.1",
          eventVersion: "v1",
          dataClassification: "internal",
          correlationId: "webhook-transport-correlation",
        },
      },
    ]);
    expect(gateway.requests[0]?.headers).toMatchObject({
      "x-omniwa-signature": "v1=fake-signature",
      "x-omniwa-signature-scheme": "v1",
      "x-omniwa-signature-timestamp": "1234567890000",
    });
    expect(JSON.stringify(gateway.requests[0])).not.toContain("secret-ref-not-plaintext");
  });

  it("rejects signed deliveries when no signature provider is configured", async () => {
    const gateway = new FakeWebhookHttpGateway({ result: { statusCode: 200 } });
    const adapter = new HttpWebhookTransportAdapter({ gateway });

    const result = await adapter.deliver(
      createEnvelope({
        signingSecretRef: "secret-ref-not-plaintext",
      }),
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "webhook_signature_provider_missing",
      retryable: false,
      ownerContext: "webhook_delivery",
      failureCategory: "configuration",
    });
    expect(gateway.requests).toHaveLength(0);
  });

  it("sanitizes raw gateway failures before crossing the WebhookTransport port", async () => {
    const gateway = new FakeWebhookHttpGateway({
      error: new Error("raw webhook secret and receiver response body"),
    });
    const adapter = new HttpWebhookTransportAdapter({ gateway });

    const result = await adapter.deliver(createEnvelope(), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unavailable",
      code: "webhook_transport_failure",
      retryable: true,
      ownerContext: "webhook_delivery",
      failureCategory: "network",
    });
    expect(JSON.stringify(result.ok ? undefined : result.error)).not.toContain("secret");
  });

  it("maps explicit transport errors safely", async () => {
    const gateway = new FakeWebhookHttpGateway({
      error: new WebhookTransportAdapterError({
        category: "timeout",
        code: "receiver_timeout",
        message: "Webhook receiver timed out.",
        retryable: true,
        failureCategory: "network",
      }),
    });
    const adapter = new HttpWebhookTransportAdapter({ gateway });

    const result = await adapter.deliver(createEnvelope(), context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "timeout",
      code: "receiver_timeout",
      message: "Webhook receiver timed out.",
      retryable: true,
      ownerContext: "webhook_delivery",
      failureCategory: "network",
    });
  });
});

function createEnvelope(overrides: Partial<WebhookDeliveryEnvelope> = {}): WebhookDeliveryEnvelope {
  return {
    webhookId: (overrides.webhookId ?? webhookId) as WebhookId,
    deliveryId: (overrides.deliveryId ?? deliveryId) as WebhookDeliveryId,
    targetUrl: overrides.targetUrl ?? createWebhookUrl("https://receiver.example.test/webhooks"),
    sourceSignalRef: overrides.sourceSignalRef ?? "source.signal.1",
    payloadRef: overrides.payloadRef ?? "payload.ref.1",
    eventVersion: "v1",
    dataClassification: overrides.dataClassification ?? "internal",
    ...optional("signingSecretRef", overrides.signingSecretRef),
  };
}

class FakeWebhookHttpGateway implements WebhookHttpGateway {
  readonly requests: WebhookOutboundRequest[] = [];

  constructor(
    private readonly options: Readonly<{
      result?: WebhookOutboundResult;
      error?: unknown;
    }>,
  ) {}

  sendWebhook(request: WebhookOutboundRequest): WebhookOutboundResult {
    this.requests.push(request);

    if (this.options.error !== undefined) {
      throw this.options.error;
    }

    return (
      this.options.result ?? {
        statusCode: 200,
      }
    );
  }
}

class FakeSignatureProvider implements WebhookSignatureProvider {
  readonly inputs: WebhookSignatureInput[] = [];

  createSignature(input: WebhookSignatureInput): WebhookSignatureResult {
    this.inputs.push(input);
    return {
      scheme: "v1",
      signature: "v1=fake-signature",
      timestamp: "1234567890000",
    };
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
