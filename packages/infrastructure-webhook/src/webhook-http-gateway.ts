import { createFailureCategory } from "@omniwa/domain";

import {
  WebhookTransportAdapterError,
  type WebhookHttpGateway,
  type WebhookOutboundRequest,
  type WebhookOutboundResult,
} from "./webhook-transport.adapter.js";

export type WebhookFetchResponse = Readonly<{
  status: number;
  headers?: Readonly<{
    get(name: string): string | null;
  }>;
}>;

export type WebhookFetchRequestInit = Readonly<{
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}>;

export type WebhookFetch = (
  url: string,
  init: WebhookFetchRequestInit,
) => Promise<WebhookFetchResponse> | WebhookFetchResponse;

export type FetchWebhookHttpGatewayOptions = Readonly<{
  fetch?: WebhookFetch;
}>;

export class FetchWebhookHttpGateway implements WebhookHttpGateway {
  private readonly fetch: WebhookFetch;

  constructor(options: FetchWebhookHttpGatewayOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }

  async sendWebhook(request: WebhookOutboundRequest): Promise<WebhookOutboundResult> {
    assertHttpTargetUrl(request.targetUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMilliseconds);

    try {
      const response = await this.fetch(request.targetUrl, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });

      return Object.freeze({
        statusCode: response.status,
        ...optional("receiverRef", readSafeHeader(response, "x-omniwa-receiver-ref")),
        ...optional("failureReasonCode", readSafeHeader(response, "x-omniwa-failure-reason")),
      });
    } catch (error) {
      throw mapFetchFailure(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function defaultFetch(url: string, init: WebhookFetchRequestInit): Promise<WebhookFetchResponse> {
  if (typeof globalThis.fetch !== "function") {
    throw new WebhookTransportAdapterError({
      category: "rejected",
      code: "webhook_fetch_unavailable",
      message: "Webhook HTTP fetch runtime is unavailable.",
      retryable: false,
      failureCategory: createFailureCategory("configuration"),
    });
  }

  return globalThis.fetch(url, init);
}

function assertHttpTargetUrl(targetUrl: string): void {
  let parsed: URL;

  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new WebhookTransportAdapterError({
      category: "rejected",
      code: "webhook_invalid_target_url",
      message: "Webhook target URL is invalid.",
      retryable: false,
      failureCategory: createFailureCategory("configuration"),
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new WebhookTransportAdapterError({
      category: "rejected",
      code: "webhook_invalid_target_url",
      message: "Webhook target URL must use HTTP or HTTPS.",
      retryable: false,
      failureCategory: createFailureCategory("configuration"),
    });
  }
}

function mapFetchFailure(error: unknown): WebhookTransportAdapterError {
  if (error instanceof WebhookTransportAdapterError) {
    return error;
  }

  if (isAbortError(error)) {
    return new WebhookTransportAdapterError({
      category: "timeout",
      code: "receiver_timeout",
      message: "Webhook receiver timed out.",
      retryable: true,
      failureCategory: createFailureCategory("network"),
    });
  }

  return new WebhookTransportAdapterError({
    category: "unavailable",
    code: "webhook_receiver_unavailable",
    message: "Webhook receiver is unavailable.",
    retryable: true,
    failureCategory: createFailureCategory("network"),
  });
}

function readSafeHeader(response: WebhookFetchResponse, name: string): string | undefined {
  const value = response.headers?.get(name)?.trim();

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  if (value.length > 128 || /[\r\n]/u.test(value)) {
    return undefined;
  }

  return value;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
