import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
} from "@omniwa/application";
import { createInMemoryEventLogStore } from "@omniwa/infrastructure-persistence";
import type { ApiCredential, ApplicationInterfaceDispatcher } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import {
  handleApiEventStreamRequest,
  handleApiHttpRequest,
  type ApiHttpResponse,
  type ApiKeyConfig,
} from "./http-server.js";
import { InMemoryFixedWindowRateLimiter } from "./api-rate-limiter.js";
import {
  createEventLogRealtimeEventSource,
  createRealtimeEventEnvelope,
  createStaticRealtimeEventSource,
} from "./realtime-event-stream.js";
import type { ApiResourceOwnershipResolver } from "./resource-ownership.js";

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
    "chats:read",
    "contacts:read",
    "labels:read",
    "groups:read",
    "groups:write",
    "groups:message",
    "groups:admin",
    "webhooks:write",
    "webhooks:read",
    "webhooks:retry",
    "health:read",
    "events:read",
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

  it("rate limits authenticated requests before dispatching to Application", async () => {
    const dispatcher = new CapturingDispatcher();
    const rateLimiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 1,
      windowMilliseconds: 60_000,
    });

    const first = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-rate-1",
          "x-correlation-id": "corr-rate-1",
        },
      },
      {
        dispatcher,
        apiKeys,
        rateLimiter,
        now: fixedNow,
        requestRefGenerator: () => "http-rate-1",
      },
    );
    const second = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-rate-2",
          "x-correlation-id": "corr-rate-2",
        },
      },
      {
        dispatcher,
        apiKeys,
        rateLimiter,
        now: fixedNow,
        requestRefGenerator: () => "http-rate-2",
      },
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect("error" in second.body ? second.body.error : undefined).toMatchObject({
      code: "rate_limit_exceeded",
      details: {
        category: "rate_limit",
        endpointClass: "read",
        limit: 1,
        remaining: 0,
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(1);
  });

  it("denies resource targets resolved outside the API key instance boundary", async () => {
    const dispatcher = new CapturingDispatcher();
    const resourceOwnershipResolver: ApiResourceOwnershipResolver = {
      resolve: () => Promise.resolve({ status: "resolved", instanceRef: "inst_denied" }),
    };

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/messages/msg_1",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-owner-denied",
          "x-correlation-id": "corr-owner-denied",
        },
      },
      {
        dispatcher,
        apiKeys,
        resourceOwnershipResolver,
        now: fixedNow,
        requestRefGenerator: () => "http-owner-denied",
      },
    );

    expect(response.statusCode).toBe(403);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "resource_ownership_denied",
      details: {
        category: "authorization",
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("allows resource targets resolved inside the API key instance boundary", async () => {
    const dispatcher = new CapturingDispatcher();
    const resourceOwnershipResolver: ApiResourceOwnershipResolver = {
      resolve: () => Promise.resolve({ status: "resolved", instanceRef: "inst_allowed" }),
    };

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/messages/msg_1",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-owner-allowed",
          "x-correlation-id": "corr-owner-allowed",
        },
      },
      {
        dispatcher,
        apiKeys,
        resourceOwnershipResolver,
        now: fixedNow,
        requestRefGenerator: () => "http-owner-allowed",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(dispatcher.queryEnvelopes).toEqual([
      expect.objectContaining({
        name: "GetMessageStatus",
        targetRef: "msg_1",
      }),
    ]);
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
    await request(dispatcher, "GET", "/v1/events");
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
      "ListEvents",
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

  it("serves safe SSE event stream snapshots with cursor resume", async () => {
    const eventSource = createStaticRealtimeEventSource([
      createRealtimeEventEnvelope({
        id: "evt_1",
        cursor: "cursor_1",
        type: "message.delivered.v1",
        timestamp: "2026-06-30T00:00:00.000Z",
        dataClassification: "internal",
        source: "messaging",
        resourceRef: "msg_1",
        correlationId: "corr-event-1",
        payload: {
          messageId: "msg_1",
          status: "delivered",
        },
      }),
      createRealtimeEventEnvelope({
        id: "evt_2",
        cursor: "cursor_2",
        type: "worker.job.completed.v1",
        timestamp: "2026-06-30T00:00:01.000Z",
        dataClassification: "internal",
        source: "operations",
        resourceRef: "job_1",
        payload: {
          jobId: "job_1",
          status: "completed",
        },
      }),
    ]);

    const response = await handleApiEventStreamRequest(
      {
        method: "GET",
        url: "/v1/events/stream?cursor=cursor_1",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-stream",
          "x-correlation-id": "corr-stream",
        },
      },
      {
        apiKeys,
        eventSource,
        now: fixedNow,
        requestRefGenerator: () => "http-stream",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "x-request-id": "req-stream",
      "x-correlation-id": "corr-stream",
    });
    expect(typeof response.body === "string" ? response.body : "").toContain("id: cursor_2");
    expect(typeof response.body === "string" ? response.body : "").toContain(
      "event: worker.job.completed.v1",
    );
    expect(typeof response.body === "string" ? response.body : "").not.toContain("cursor_1");
    expect(typeof response.body === "string" ? response.body : "").toContain(": heartbeat");
  });

  it("serves durable EventLog-backed SSE streams with deterministic expired cursor metadata", async () => {
    const eventLog = createInMemoryEventLogStore({ retentionLimit: 1 });
    eventLog.appendEvent({
      id: "evt_1",
      type: "message.accepted.v1",
      timestamp: "2026-06-30T00:00:00.000Z",
      dataClassification: "internal",
      source: "messaging",
      resourceRef: "msg_1",
      payload: {
        messageId: "msg_1",
      },
    });
    eventLog.appendEvent({
      id: "evt_2",
      type: "message.delivered.v1",
      timestamp: "2026-06-30T00:00:01.000Z",
      dataClassification: "internal",
      source: "messaging",
      resourceRef: "msg_1",
      payload: {
        messageId: "msg_1",
      },
    });

    const response = await handleApiEventStreamRequest(
      {
        method: "GET",
        url: "/v1/events/stream?cursor=eventlog:1",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-stream-expired",
          "x-correlation-id": "corr-stream-expired",
        },
      },
      {
        apiKeys,
        eventSource: createEventLogRealtimeEventSource(eventLog),
        now: fixedNow,
        requestRefGenerator: () => "http-stream-expired",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "x-omniwa-cursor-status": "expired",
    });
    expect(typeof response.body === "string" ? response.body : "").not.toContain("evt_1");
    expect(typeof response.body === "string" ? response.body : "").not.toContain("evt_2");
    expect(typeof response.body === "string" ? response.body : "").toContain(": heartbeat");
  });

  it("requires events read scope for SSE streams", async () => {
    const response = await handleApiEventStreamRequest(
      {
        method: "GET",
        url: "/v1/events/stream",
        headers: {
          "x-api-key": "limited-secret",
          "x-request-id": "req-stream-denied",
          "x-correlation-id": "corr-stream-denied",
        },
      },
      {
        apiKeys: [
          {
            key: "limited-secret",
            credential: {
              kind: "api_key",
              keyId: "limited",
              scopes: ["instances:read"],
            },
          },
        ],
        now: fixedNow,
        requestRefGenerator: () => "http-stream-denied",
      },
    );

    expect(response.statusCode).toBe(403);
    expect(
      typeof response.body !== "string" && "error" in response.body
        ? response.body.error
        : undefined,
    ).toMatchObject({
      code: "missing_scope",
      details: {
        category: "authorization",
      },
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

  it("maps chat, contact, and label resources to navigation queries", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/chats");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/chats");
    await request(dispatcher, "GET", "/v1/chats/chat_1");
    await request(dispatcher, "GET", "/v1/contacts");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/contacts");
    await request(dispatcher, "GET", "/v1/contacts/contact_1");
    await request(dispatcher, "GET", "/v1/labels");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/labels");
    await request(dispatcher, "GET", "/v1/labels/label_1");

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ListChats",
      "ListInstanceChats",
      "GetChatStatus",
      "ListContacts",
      "ListInstanceContacts",
      "GetContactStatus",
      "ListLabels",
      "ListInstanceLabels",
      "GetLabelStatus",
    ]);
    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.targetRef)).toEqual([
      undefined,
      "inst_allowed",
      "chat_1",
      undefined,
      "inst_allowed",
      "contact_1",
      undefined,
      "inst_allowed",
      "label_1",
    ]);
  });

  it("maps group resources to approved group commands and queries", async () => {
    const dispatcher = new CapturingDispatcher();

    await request(dispatcher, "GET", "/v1/instances/inst_allowed/groups");
    await request(dispatcher, "POST", "/v1/instances/inst_allowed/groups/refresh", {
      headers: { "idempotency-key": "refresh-groups-1" },
    });
    await request(dispatcher, "GET", "/v1/groups/group_1");
    await request(dispatcher, "GET", "/v1/groups/group_1/members");
    await request(dispatcher, "POST", "/v1/groups/group_1/messages/text", {
      body: { text: "hello group" },
      headers: { "idempotency-key": "send-group-text-1" },
    });
    await request(dispatcher, "PATCH", "/v1/groups/group_1", {
      body: { subject: "New subject" },
      headers: { "idempotency-key": "update-group-metadata-1" },
    });
    await request(dispatcher, "PATCH", "/v1/groups/group_1/local-state", {
      body: { archived: true },
      headers: { "idempotency-key": "archive-group-1" },
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members", {
      body: { jid: "12025550123@s.whatsapp.net" },
      headers: { "idempotency-key": "add-group-member-1" },
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members/member_1/promote", {
      headers: { "idempotency-key": "promote-group-member-1" },
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members/member_1/demote", {
      headers: { "idempotency-key": "demote-group-member-1" },
    });
    await request(dispatcher, "DELETE", "/v1/groups/group_1/members/member_1", {
      headers: { "idempotency-key": "remove-group-member-1" },
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/invite-link/refresh", {
      headers: { "idempotency-key": "refresh-group-invite-1" },
    });

    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ListInstanceGroups",
      "GetGroupStatus",
      "ListGroupMembers",
    ]);
    expect(dispatcher.commandEnvelopes.map((envelope) => envelope.name)).toEqual([
      "RefreshGroupList",
      "SendGroupTextMessage",
      "UpdateGroupMetadata",
      "UpdateGroupLocalState",
      "AddGroupMember",
      "PromoteGroupMember",
      "DemoteGroupMember",
      "RemoveGroupMember",
      "RefreshGroupInviteLink",
    ]);
    expect(dispatcher.commandEnvelopes.every((envelope) => envelope.targetRef)).toBe(true);
  });

  it("requires group admin scope for member administration", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await handleApiHttpRequest(
      {
        method: "POST",
        url: "/v1/groups/group_1/members",
        headers: {
          "x-api-key": "limited-groups-secret",
          "x-request-id": "req-groups-denied",
          "x-correlation-id": "corr-groups-denied",
          "idempotency-key": "add-group-member-denied",
        },
        body: {
          jid: "12025550123@s.whatsapp.net",
        },
      },
      {
        dispatcher,
        apiKeys: [
          {
            key: "limited-groups-secret",
            credential: {
              kind: "api_key",
              keyId: "limited-groups",
              scopes: ["groups:read"],
            },
          },
        ],
        now: fixedNow,
        requestRefGenerator: () => "http-groups-denied",
      },
    );

    expect(response.statusCode).toBe(403);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "missing_scope",
      details: {
        category: "authorization",
      },
    });
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
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
