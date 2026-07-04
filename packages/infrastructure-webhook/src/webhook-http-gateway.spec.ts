import type { WebhookOutboundRequest } from "./webhook-transport.adapter.js";
import {
  FetchWebhookHttpGateway,
  type WebhookFetch,
  type WebhookFetchRequestInit,
  type WebhookFetchResponse,
} from "./webhook-http-gateway.js";
import { describe, expect, it } from "vitest";

const request: WebhookOutboundRequest = {
  method: "POST",
  targetUrl: "https://receiver.example.test/webhooks",
  timeoutMilliseconds: 50,
  headers: {
    "content-type": "application/json",
    "x-omniwa-delivery-id": "webhook_delivery_gateway_1",
  },
  body: {
    deliveryId: "webhook_delivery_gateway_1",
    webhookId: "webhook_gateway_1",
    sourceSignalRef: "message.delivered.v1",
    payloadRef: "payload.ref.gateway.1",
    eventVersion: "v1",
    dataClassification: "internal",
    correlationId: "webhook-gateway-correlation",
  },
};

describe("FetchWebhookHttpGateway", () => {
  it("posts a JSON webhook request through injected fetch", async () => {
    const fetch = new RecordingFetch({
      status: 202,
      headers: headers({ "x-omniwa-receiver-ref": "receiver.ack.gateway.1" }),
    });
    const gateway = new FetchWebhookHttpGateway({ fetch: fetch.fetch });

    const result = await gateway.sendWebhook(request);

    expect(result).toEqual({
      statusCode: 202,
      receiverRef: "receiver.ack.gateway.1",
    });
    expect(fetch.calls).toEqual([
      {
        url: "https://receiver.example.test/webhooks",
        init: expect.objectContaining({
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
        }) as WebhookFetchRequestInit,
      },
    ]);
    expect(fetch.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("captures safe failure reason headers and ignores unsafe response headers", async () => {
    const gateway = new FetchWebhookHttpGateway({
      fetch: new RecordingFetch({
        status: 409,
        headers: headers({
          "x-omniwa-failure-reason": "receiver_conflict",
          "x-omniwa-receiver-ref": "raw\nreceiver-secret",
        }),
      }).fetch,
    });

    const result = await gateway.sendWebhook(request);

    expect(result).toEqual({
      statusCode: 409,
      failureReasonCode: "receiver_conflict",
    });
    expect(JSON.stringify(result)).not.toContain("receiver-secret");
  });

  it("maps aborts to a safe retryable timeout failure", async () => {
    const gateway = new FetchWebhookHttpGateway({
      fetch: () => {
        const error = new Error("raw timeout body secret");
        error.name = "AbortError";
        throw error;
      },
    });

    await expect(gateway.sendWebhook(request)).rejects.toMatchObject({
      code: "receiver_timeout",
      retryable: true,
    });
  });

  it("maps raw network failures to a safe retryable unavailable failure", async () => {
    const gateway = new FetchWebhookHttpGateway({
      fetch: () => {
        throw new Error("raw webhook receiver response secret");
      },
    });

    await expect(gateway.sendWebhook(request)).rejects.toMatchObject({
      code: "webhook_receiver_unavailable",
      retryable: true,
    });
  });

  it("rejects non-http target URLs without calling fetch", async () => {
    const fetch = new RecordingFetch({ status: 200 });
    const gateway = new FetchWebhookHttpGateway({ fetch: fetch.fetch });

    await expect(
      gateway.sendWebhook({
        ...request,
        targetUrl: "file:///tmp/raw-secret",
      }),
    ).rejects.toMatchObject({
      code: "webhook_invalid_target_url",
      retryable: false,
    });
    expect(fetch.calls).toHaveLength(0);
  });
});

class RecordingFetch {
  readonly calls: Array<{ url: string; init: WebhookFetchRequestInit }> = [];

  constructor(private readonly response: WebhookFetchResponse) {}

  readonly fetch: WebhookFetch = (url, init) => {
    this.calls.push({ url, init });
    return this.response;
  };
}

function headers(
  values: Readonly<Record<string, string>>,
): NonNullable<WebhookFetchResponse["headers"]> {
  return {
    get(name) {
      return values[name] ?? null;
    },
  };
}
