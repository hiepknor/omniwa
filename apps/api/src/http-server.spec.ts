import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
} from "@omniwa/application";
import type { ApiCredential, ApplicationInterfaceDispatcher } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import { handleApiHttpRequest, type ApiHttpResponse, type ApiKeyConfig } from "./http-server.js";

const publicCredential: ApiCredential = {
  kind: "api_key",
  keyId: "test-public-key",
  scopes: [
    "instances:read",
    "instances:write",
    "instances:connect",
    "messages:send",
    "messages:read",
    "messages:retry",
    "messages:cancel",
    "media:write",
    "media:read",
    "webhooks:write",
    "webhooks:read",
    "webhooks:retry",
    "health:read",
  ],
  allowedInstanceRefs: ["inst_allowed"],
};

const monitoringCredential: ApiCredential = {
  kind: "monitoring_key",
  keyId: "test-monitoring-key",
  scopes: ["health:read", "metrics:read", "jobs:read"],
};

const adminCredential: ApiCredential = {
  kind: "admin_key",
  keyId: "test-admin-key",
  scopes: ["admin:*"],
};

const apiKey: ApiKeyConfig = {
  key: "test-secret",
  credential: publicCredential,
};

const monitoringApiKey: ApiKeyConfig = {
  key: "monitoring-secret",
  credential: monitoringCredential,
};

const adminApiKey: ApiKeyConfig = {
  key: "admin-secret",
  credential: adminCredential,
};

const apiKeys = [apiKey, monitoringApiKey, adminApiKey] as const;

describe("API HTTP transport", () => {
  it("serves health through the interface adapter", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/health");

    expect(response.statusCode).toBe(200);
    expect(dispatcher.queryEnvelopes).toEqual([
      expect.objectContaining({
        name: "GetHealthStatus",
        kind: "query",
      }),
    ]);
  });

  it("rejects requests with a missing API key", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-request-id": "req-missing-auth",
          "x-correlation-id": "corr-missing-auth",
        },
      },
      {
        dispatcher,
        apiKeys: [apiKey],
        now: fixedNow,
        requestRefGenerator: () => "http-missing-auth",
      },
    );

    expect(response.statusCode).toBe(401);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "missing_or_invalid_api_key",
      details: {
        category: "authentication",
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("accepts a valid API key and maps instance list to a query", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/instances");

    expect(response.statusCode).toBe(200);
    expect(dispatcher.queryEnvelopes[0]).toMatchObject({
      name: "ListInstances",
      actorRef: "api_key:test-public-key",
      requestedConsistency: "eventual_projection",
    });
  });

  it("maps health readiness and action-required resources to health queries", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/health/readiness");
    await request(dispatcher, "GET", "/v1/action-required");

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "GetHealthStatus",
      "GetActionRequiredItems",
    ]);
  });

  it("maps monitoring metrics and queue resources through the monitoring boundary", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/metrics", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/dashboard", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/metrics/queue", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/metrics/messages", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/metrics/webhooks", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/metrics/media", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/queue", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/jobs", { apiKey: "monitoring-secret" });
    await request(dispatcher, "GET", "/v1/jobs/job_1", { apiKey: "monitoring-secret" });

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "GetOperationalMetricsSnapshot",
      "GetDashboardSummary",
      "GetQueueMetricsSnapshot",
      "GetMessageMetricsSnapshot",
      "GetWebhookMetricsSnapshot",
      "GetMediaMetricsSnapshot",
      "GetQueueMetricsSnapshot",
      "ListWorkerJobs",
      "GetWorkerJobStatus",
    ]);
  });

  it("wraps success responses in the public envelope", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/instances/inst_allowed");

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "req-test",
      "x-correlation-id": "corr-test",
    });
    expect("data" in response.body ? response.body.meta : undefined).toEqual({
      requestId: "req-test",
      correlationId: "corr-test",
      timestamp: "2026-06-30T00:00:00.000Z",
    });
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      kind: "query_outcome",
      outcome: "result",
    });
  });

  it("wraps validation failures in the public error envelope", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "12025550123",
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
    });

    expect(response.statusCode).toBe(400);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "invalid_body",
      message: "Request body requires non-empty string field 'text'.",
      details: {
        category: "validation",
      },
    });
    expect("error" in response.body ? response.body.meta.requestId : undefined).toBe("req-test");
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
  });

  it("maps send text message to the internal command without exposing command names in the URL", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "12025550123",
        text: "hello",
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(dispatcher.commandEnvelopes).toEqual([
      expect.objectContaining({
        name: "SendTextMessage",
        targetRef: "inst_allowed",
        actorRef: "api_key:test-public-key",
        idempotencyKey: "send-text-1",
        safeInputRef: "http:SendTextMessage:http-test",
      }),
    ]);
  });

  it("maps the generic message resource to text or media commands by validated body type", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages", {
      body: {
        type: "text",
        to: "12025550123",
        text: "hello",
      },
      headers: {
        "idempotency-key": "send-generic-text-1",
      },
    });
    await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages", {
      body: {
        type: "image",
        to: "12025550123",
        mediaId: "media_1",
      },
      headers: {
        "idempotency-key": "send-generic-media-1",
      },
    });

    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.name)).toEqual([
      "SendTextMessage",
      "SendMediaMessage",
    ]);
  });

  it("maps message, media, and webhook resource routes to existing commands and queries", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/instances/inst_allowed/messages");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/sessions");
    await request(dispatcher, "GET", "/v1/messages/msg_1");
    await request(dispatcher, "GET", "/v1/messages/msg_1/delivery-history");
    await request(dispatcher, "POST", "/v1/messages/msg_1/retry", {
      headers: { "idempotency-key": "retry-message-1" },
    });
    await request(dispatcher, "POST", "/v1/messages/msg_1/cancel", {
      headers: { "idempotency-key": "cancel-message-1" },
    });
    await request(dispatcher, "POST", "/v1/media", {
      body: { mediaRef: "upload-ref-1" },
      headers: { "idempotency-key": "register-media-1" },
    });
    await request(dispatcher, "GET", "/v1/media/media_1");
    await request(dispatcher, "GET", "/v1/webhooks");
    await request(dispatcher, "GET", "/v1/webhooks/wh_1");
    await request(dispatcher, "PATCH", "/v1/webhooks/wh_1", {
      body: { url: "https://example.test/webhook" },
      headers: { "idempotency-key": "update-webhook-1" },
    });
    await request(dispatcher, "POST", "/v1/webhooks/wh_1/activate", {
      headers: { "idempotency-key": "activate-webhook-1" },
    });
    await request(dispatcher, "POST", "/v1/webhook-deliveries/whd_1/retry", {
      headers: { "idempotency-key": "retry-webhook-delivery-1" },
    });
    await request(dispatcher, "GET", "/v1/webhook-deliveries");
    await request(dispatcher, "GET", "/v1/webhook-deliveries/whd_1/history");

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ListInstanceMessages",
      "ListInstanceSessions",
      "GetMessageStatus",
      "GetMessageDeliveryHistory",
      "GetMediaStatus",
      "ListWebhookSubscriptions",
      "GetWebhookStatus",
      "ListWebhookDeliveries",
      "GetWebhookDeliveryHistory",
    ]);
    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.name)).toEqual([
      "RetryMessageSend",
      "CancelMessage",
      "RegisterMedia",
      "UpdateWebhookSubscription",
      "ActivateWebhookSubscription",
      "RetryWebhookDelivery",
    ]);
  });

  it("maps admin settings, audit, provider, and destroy routes through the admin boundary", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/settings", { apiKey: "admin-secret" });
    await request(dispatcher, "POST", "/v1/settings/validate", {
      apiKey: "admin-secret",
      body: { snapshotRef: "cfg_candidate" },
      headers: { "idempotency-key": "validate-settings-1" },
    });
    await request(dispatcher, "POST", "/v1/settings/activate", {
      apiKey: "admin-secret",
      body: { snapshotRef: "cfg_candidate" },
      headers: { "idempotency-key": "activate-settings-1" },
    });
    await request(dispatcher, "GET", "/v1/audit-records", { apiKey: "admin-secret" });
    await request(dispatcher, "GET", "/v1/provider/capabilities", { apiKey: "admin-secret" });
    await request(dispatcher, "DELETE", "/v1/instances/inst_allowed", {
      apiKey: "admin-secret",
    });

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "GetConfigurationStatus",
      "QueryAuditRecords",
      "GetProviderCapabilityStatus",
    ]);
    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ValidateConfigurationSnapshot",
      "ActivateConfigurationSnapshot",
      "DestroyInstance",
    ]);
    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.actorRef)).toEqual([
      "admin_key:test-admin-key",
      "admin_key:test-admin-key",
      "admin_key:test-admin-key",
    ]);
  });

  it("keeps scheduler-owned routes explicitly partial", async () => {
    const dispatcher = new CapturingDispatcher();
    const reconnectResponse = await request(
      dispatcher,
      "POST",
      "/v1/instances/inst_allowed/reconnect",
    );
    const providerRefreshResponse = await request(
      dispatcher,
      "POST",
      "/v1/provider/capabilities/refresh",
      { apiKey: "admin-secret" },
    );

    expect("error" in reconnectResponse.body ? reconnectResponse.body.error.code : undefined).toBe(
      "reconnect_public_route_not_available",
    );
    expect(
      "error" in providerRefreshResponse.body ? providerRefreshResponse.body.error.code : undefined,
    ).toBe("provider_refresh_public_route_not_available");
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });
});

function request(
  dispatcher: CapturingDispatcher,
  method: string,
  url: string,
  input: Readonly<{
    apiKey?: string;
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
  }> = {},
): Promise<ApiHttpResponse> {
  return handleApiHttpRequest(
    {
      method,
      url,
      headers: {
        "x-api-key": input.apiKey ?? "test-secret",
        "x-request-id": "req-test",
        "x-correlation-id": "corr-test",
        ...(input.headers ?? {}),
      },
      ...optional("body", input.body),
    },
    {
      dispatcher,
      apiKeys,
      now: fixedNow,
      requestRefGenerator: () => "http-test",
    },
  );
}

function fixedNow(): Date {
  return new Date("2026-06-30T00:00:00.000Z");
}

class CapturingDispatcher implements ApplicationInterfaceDispatcher {
  readonly commandEnvelopes: ApplicationCommandEnvelope[] = [];
  readonly queryEnvelopes: ApplicationQueryEnvelope[] = [];

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    this.commandEnvelopes.push(envelope);

    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome: envelope.name === "SendTextMessage" ? "queued" : "completed",
      accepted: true,
      retryable: false,
      resultRef: `${envelope.commandRef}:result`,
    });
  }

  executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
    this.queryEnvelopes.push(envelope);

    return createApplicationQueryOutcome({
      queryRef: envelope.queryRef,
      outcome: "result",
      consistency: envelope.requestedConsistency ?? "strong_owner",
      freshness: {
        stale: false,
        refreshedAtEpochMilliseconds: 1,
      },
      resultRef: `${envelope.queryRef}:result`,
    });
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
