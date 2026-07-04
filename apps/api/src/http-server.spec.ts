import {
  createApplicationCommandOutcome,
  createApplicationDispatcher,
  createApplicationQueryOutcome,
  createApplicationPortFailure,
  createGroupMutationIntentRef,
  createOutboundMessageIntentRef,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
  type GroupMutationIntentInput,
  type GroupMutationIntentReceipt,
  type GroupMutationIntentRef,
  type GroupMutationIntentStorePort,
  type StoredGroupMutationIntent,
  type OutboundMessageIntentBinding,
  type OutboundMessageIntentReceipt,
  type OutboundMessageIntentRef,
  type OutboundMessageIntentStorePort,
  type StoredTextOutboundMessageIntent,
  type TextOutboundMessageIntentInput,
} from "@omniwa/application";
import type { MessageId } from "@omniwa/domain";
import {
  createInMemoryEventLogStore,
  createInMemoryRepositorySet,
} from "@omniwa/infrastructure-persistence";
import type { ApiCredential, ApplicationInterfaceDispatcher } from "@omniwa/interface-api";
import { err, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  handleApiEventStreamRequest,
  handleApiHttpRequest,
  type HttpCollectionResponseMeta,
  type ApiHttpResponse,
  type ApiKeyConfig,
} from "./http-server.js";
import { InMemoryFixedWindowRateLimiter } from "./api-rate-limiter.js";
import { InMemoryApiSecurityAuditSink } from "./api-security-audit.js";
import { ApiKeyLifecycleService, InMemoryApiKeyLifecycleStore } from "./api-key-lifecycle.js";
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
    expect("data" in response.body ? response.body.data : undefined).toEqual([]);
    expect("data" in response.body ? response.body.meta : undefined).toMatchObject({
      pagination: {
        limit: 50,
        nextCursor: null,
        previousCursor: null,
        hasMore: false,
      },
      query: {
        resourceType: "instance",
        readStatus: "result",
      },
    });
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
    const securityAuditSink = new InMemoryApiSecurityAuditSink();

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
        securityAuditSink,
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
        securityAuditSink,
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
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "rate_limit_denied",
        requestId: "req-rate-2",
        correlationId: "corr-rate-2",
        endpointClass: "read",
        keyId: "test-public-key",
        code: "rate_limit_exceeded",
        statusCode: 429,
      }),
    ]);
  });

  it("denies resource targets resolved outside the API key instance boundary", async () => {
    const dispatcher = new CapturingDispatcher();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();
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
        securityAuditSink,
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
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "authorization_denied",
        requestId: "req-owner-denied",
        correlationId: "corr-owner-denied",
        resourceType: "message",
        targetRef: "msg_1",
        code: "resource_ownership_denied",
      }),
    ]);
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

  it("audits explicit admin bypass for owned-resource checks", async () => {
    const dispatcher = new CapturingDispatcher();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();
    const resourceOwnershipResolver: ApiResourceOwnershipResolver = {
      resolve: () => {
        throw new Error("admin bypass should not call resolver");
      },
    };

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/messages/msg_1",
        headers: {
          "x-api-key": "admin-secret",
          "x-request-id": "req-admin-bypass",
          "x-correlation-id": "corr-admin-bypass",
        },
      },
      {
        dispatcher,
        apiKeys,
        resourceOwnershipResolver,
        securityAuditSink,
        now: fixedNow,
        requestRefGenerator: () => "http-admin-bypass",
      },
    );

    expect(response.statusCode).toBe(200);
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "admin_bypass",
        requestId: "req-admin-bypass",
        correlationId: "corr-admin-bypass",
        keyId: "test-admin-key",
        credentialKind: "admin_key",
        operationRef: "GetMessageStatus",
        targetRef: "msg_1",
        resourceType: "message",
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
      resourceType: "instance",
      resourceId: "inst_allowed",
      readStatus: "result",
      consistency: "strong_owner",
    });
    expect(JSON.stringify(response.body)).not.toContain("query_outcome");
  });

  it("normalizes collection query options with cursor metadata and safe criteria refs", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(
      dispatcher,
      "GET",
      "/v1/instances?limit=500&sort=-createdAt&status=connected&search=demo",
    );

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toEqual([]);
    expect("data" in response.body ? response.body.meta : undefined).toMatchObject({
      pagination: {
        limit: 200,
        previousCursor: null,
        hasMore: false,
        sort: "-createdAt",
        search: "demo",
        filters: {
          status: "connected",
        },
      },
    });
    expect(dispatcher.queryEnvelopes[0]).toMatchObject({
      safeCriteriaRef: "http:ListInstances:limit=200;sort=-createdAt;search=demo;status=connected",
    });
    expect(JSON.stringify(response.body)).not.toContain("query_outcome");
  });

  it("applies collection filters, search, sorting, and cursor pagination to public DTOs", async () => {
    const dispatcher = new CapturingDispatcher({
      ListInstances: {
        items: [
          {
            instanceId: "inst_zulu",
            status: "connected",
            displayName: "Zulu",
            createdAt: "2026-06-30T03:00:00.000Z",
          },
          {
            instanceId: "inst_beta",
            status: "connected",
            displayName: "Beta demo",
            createdAt: "2026-06-30T02:00:00.000Z",
          },
          {
            instanceId: "inst_alpha",
            status: "connected",
            displayName: "Alpha demo",
            createdAt: "2026-06-30T01:00:00.000Z",
          },
          {
            instanceId: "inst_hidden",
            status: "disconnected",
            displayName: "Demo hidden",
            createdAt: "2026-06-30T00:00:00.000Z",
          },
        ],
      },
    });
    const first = await request(
      dispatcher,
      "GET",
      "/v1/instances?limit=1&status=connected&search=demo&sort=displayName",
    );
    const firstMeta = getCollectionMeta(first);
    const nextCursor = firstMeta.pagination.nextCursor;

    expect(first.statusCode).toBe(200);
    expect("data" in first.body ? first.body.data : undefined).toEqual([
      {
        resourceType: "instance",
        id: "inst_alpha",
        status: "connected",
        displayName: "Alpha demo",
        createdAt: "2026-06-30T01:00:00.000Z",
      },
    ]);
    expect(firstMeta?.pagination).toMatchObject({
      limit: 1,
      previousCursor: null,
      hasMore: true,
      sort: "displayName",
      search: "demo",
      filters: {
        status: "connected",
      },
    });
    expect(typeof nextCursor).toBe("string");
    expect(nextCursor).toMatch(/^omniwa_cursor_v1:/u);

    const second = await request(
      dispatcher,
      "GET",
      `/v1/instances?limit=1&status=connected&search=demo&sort=displayName&cursor=${encodeURIComponent(
        nextCursor ?? "",
      )}`,
    );
    const secondMeta = getCollectionMeta(second);

    expect(second.statusCode).toBe(200);
    expect("data" in second.body ? second.body.data : undefined).toEqual([
      {
        resourceType: "instance",
        id: "inst_beta",
        status: "connected",
        displayName: "Beta demo",
        createdAt: "2026-06-30T02:00:00.000Z",
      },
    ]);
    expect(secondMeta?.pagination.hasMore).toBe(false);
    expect(secondMeta?.pagination.nextCursor).toBeNull();
    expect(secondMeta?.pagination.previousCursor).toMatch(/^omniwa_cursor_v1:/u);
  });

  it("rejects cursors from a different collection query context before dispatch", async () => {
    const dispatcher = new CapturingDispatcher({
      ListInstances: {
        items: [
          {
            instanceId: "inst_alpha",
            status: "connected",
            displayName: "Alpha demo",
          },
          {
            instanceId: "inst_beta",
            status: "connected",
            displayName: "Beta demo",
          },
        ],
      },
    });
    const first = await request(dispatcher, "GET", "/v1/instances?limit=1&status=connected");
    const nextCursor = getCollectionMeta(first).pagination.nextCursor;
    const dispatchedBeforeInvalidCursor = dispatcher.queryEnvelopes.length;
    const invalid = await request(
      dispatcher,
      "GET",
      `/v1/instances?limit=1&status=disconnected&cursor=${encodeURIComponent(nextCursor ?? "")}`,
    );

    expect(first.statusCode).toBe(200);
    expect(nextCursor).toMatch(/^omniwa_cursor_v1:/u);
    expect(invalid.statusCode).toBe(400);
    expect("error" in invalid.body ? invalid.body.error : undefined).toMatchObject({
      code: "invalid_cursor",
      details: {
        category: "validation",
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(dispatchedBeforeInvalidCursor);
  });

  it("maps collection items through stable public resource DTOs", async () => {
    const dispatcher = new CapturingDispatcher({
      ListInstances: {
        items: [
          {
            kind: "query_outcome",
            commandRef: "cmd_internal",
            queryRef: "qry_internal",
            instanceId: "inst_allowed",
            status: "connected",
            displayName: "Demo instance",
            providerPayload: {
              raw: true,
            },
            sessionSecret: "secret-material",
          },
        ],
      },
    });
    const response = await request(dispatcher, "GET", "/v1/instances");

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toEqual([
      {
        resourceType: "instance",
        id: "inst_allowed",
        status: "connected",
        displayName: "Demo instance",
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("query_outcome");
    expect(JSON.stringify(response.body)).not.toContain("cmd_internal");
    expect(JSON.stringify(response.body)).not.toContain("providerPayload");
    expect(JSON.stringify(response.body)).not.toContain("sessionSecret");
  });

  it("materializes instances from the real Application query into public collection items", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
      },
    });

    const createResponse = await handleApiHttpRequest(
      {
        method: "POST",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-create-instance",
          "x-correlation-id": "corr-create-instance",
          "idempotency-key": "idem-create-instance",
        },
        body: {},
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-create-instance",
      },
    );
    const listResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-instance",
          "x-correlation-id": "corr-list-instance",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-instance",
      },
    );

    expect(createResponse.statusCode).toBe(200);
    expect(listResponse.statusCode).toBe(200);
    expect("data" in listResponse.body ? listResponse.body.data : undefined).toEqual([
      {
        resourceType: "instance",
        id: expect.stringMatching(/^inst:/u),
        status: "created",
      },
    ]);
    expect(JSON.stringify(listResponse.body)).not.toContain("domainEvents");
  });

  it("materializes instance detail from the real Application query into public resource data", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
      },
    });

    const createResponse = await handleApiHttpRequest(
      {
        method: "POST",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-create-instance-detail",
          "x-correlation-id": "corr-create-instance-detail",
          "idempotency-key": "idem-create-instance-detail",
        },
        body: {},
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-create-instance-detail",
      },
    );
    const createdResourceId = safeResponseString(createResponse, "resultRef");

    expect(createdResourceId).toMatch(/^inst:/u);

    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: `/v1/instances/${encodeURIComponent(createdResourceId)}`,
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-instance-detail",
          "x-correlation-id": "corr-get-instance-detail",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-instance-detail",
      },
    );

    expect(createResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "instance",
      resourceId: createdResourceId,
      id: createdResourceId,
      status: "created",
      readStatus: "result",
      consistency: "strong_owner",
    });
    expect(JSON.stringify(detailResponse.body)).not.toContain("domainEvents");
  });

  it("materializes instance sessions from the real Application query into public collection items", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        sessionRepository: repositories.sessionRepository,
      },
    });

    const createResponse = await handleApiHttpRequest(
      {
        method: "POST",
        url: "/v1/instances",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-create-instance-sessions",
          "x-correlation-id": "corr-create-instance-sessions",
          "idempotency-key": "idem-create-instance-sessions",
        },
        body: {},
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-create-instance-sessions",
      },
    );
    const createdResourceId = safeResponseString(createResponse, "resultRef");

    await repositories.sessionRepository.save({
      id: "sess:demo",
      instanceId: createdResourceId,
      status: "empty",
      requiresRecovery: false,
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.sessionRepository.save>[0]);

    const sessionsResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: `/v1/instances/${encodeURIComponent(createdResourceId)}/sessions`,
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-instance-sessions",
          "x-correlation-id": "corr-list-instance-sessions",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-instance-sessions",
      },
    );

    expect(createResponse.statusCode).toBe(200);
    expect(sessionsResponse.statusCode).toBe(200);
    expect("data" in sessionsResponse.body ? sessionsResponse.body.data : undefined).toEqual([
      {
        resourceType: "session",
        id: "sess:demo",
        instanceId: createdResourceId,
        status: "empty",
      },
    ]);
    expect(JSON.stringify(sessionsResponse.body)).not.toContain("domainEvents");
  });

  it("materializes messages through the public API boundary without exposing payload internals", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        messageRepository: repositories.messageRepository,
      },
    });

    await repositories.messageRepository.save({
      id: "msg_demo",
      instanceId: "inst_allowed",
      direction: "outbound",
      type: "text",
      status: "created",
      guardrailDecisionId: "guardrail_hidden",
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.messageRepository.save>[0]);

    const listResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_allowed/messages",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-messages",
          "x-correlation-id": "corr-list-messages",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-messages",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/messages/msg_demo",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-message",
          "x-correlation-id": "corr-get-message",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-message",
      },
    );

    expect(listResponse.statusCode).toBe(200);
    expect("data" in listResponse.body ? listResponse.body.data : undefined).toEqual([
      {
        resourceType: "message",
        id: "msg_demo",
        instanceId: "inst_allowed",
        status: "created",
        type: "text",
        direction: "outbound",
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "message",
      resourceId: "msg_demo",
      id: "msg_demo",
      instanceId: "inst_allowed",
      status: "created",
      type: "text",
      direction: "outbound",
      readStatus: "result",
    });
    expect(JSON.stringify(listResponse.body)).not.toContain("guardrail_hidden");
    expect(JSON.stringify(listResponse.body)).not.toContain("domainEvents");
    expect(JSON.stringify(listResponse.body)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(listResponse.body)).not.toContain("jid");
    expect(JSON.stringify(detailResponse.body)).not.toContain("guardrail_hidden");
    expect(JSON.stringify(detailResponse.body)).not.toContain("domainEvents");
    expect(JSON.stringify(detailResponse.body)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(detailResponse.body)).not.toContain("jid");
  });

  it("materializes chats through the public API boundary without exposing JIDs", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        chatRepository: repositories.chatRepository,
      },
    });

    await repositories.chatRepository.save({
      id: "chat_demo",
      instanceId: "inst_allowed",
      jid: "12025550123@s.whatsapp.net",
      kind: "direct",
      status: "open",
      labelIds: ["label_demo"],
      unreadCount: 3,
      muted: true,
      pinned: true,
    } as unknown as Parameters<typeof repositories.chatRepository.save>[0]);

    const instanceListResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_allowed/chats",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-instance-chats",
          "x-correlation-id": "corr-list-instance-chats",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-instance-chats",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/chats/chat_demo",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-chat",
          "x-correlation-id": "corr-get-chat",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-chat",
      },
    );

    expect(instanceListResponse.statusCode).toBe(200);
    expect(
      "data" in instanceListResponse.body ? instanceListResponse.body.data : undefined,
    ).toEqual([
      {
        resourceType: "chat",
        id: "chat_demo",
        instanceId: "inst_allowed",
        status: "open",
        type: "direct",
        unreadCount: 3,
        labelIds: ["label_demo"],
        muted: true,
        pinned: true,
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "chat",
      resourceId: "chat_demo",
      id: "chat_demo",
      instanceId: "inst_allowed",
      status: "open",
      type: "direct",
      unreadCount: 3,
      labelIds: ["label_demo"],
      muted: true,
      pinned: true,
      readStatus: "result",
    });
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("12025550123");
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("jid");
    expect(JSON.stringify(detailResponse.body)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(detailResponse.body)).not.toContain("jid");
  });

  it("materializes contacts through the public API boundary without exposing JIDs or phone numbers", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        contactRepository: repositories.contactRepository,
      },
    });

    await repositories.contactRepository.save({
      id: "contact_demo",
      instanceId: "inst_allowed",
      jid: "12025550123@s.whatsapp.net",
      status: "discovered",
      displayName: "Demo Contact",
      phoneNumber: "+12025550123",
    } as unknown as Parameters<typeof repositories.contactRepository.save>[0]);

    const instanceListResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_allowed/contacts",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-instance-contacts",
          "x-correlation-id": "corr-list-instance-contacts",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-instance-contacts",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/contacts/contact_demo",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-contact",
          "x-correlation-id": "corr-get-contact",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-contact",
      },
    );

    expect(instanceListResponse.statusCode).toBe(200);
    expect(
      "data" in instanceListResponse.body ? instanceListResponse.body.data : undefined,
    ).toEqual([
      {
        resourceType: "contact",
        id: "contact_demo",
        instanceId: "inst_allowed",
        status: "discovered",
        displayName: "Demo Contact",
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "contact",
      resourceId: "contact_demo",
      id: "contact_demo",
      instanceId: "inst_allowed",
      status: "discovered",
      displayName: "Demo Contact",
      readStatus: "result",
    });
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("12025550123");
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("phoneNumber");
    expect(JSON.stringify(instanceListResponse.body)).not.toContain("jid");
    expect(JSON.stringify(detailResponse.body)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(detailResponse.body)).not.toContain("12025550123");
    expect(JSON.stringify(detailResponse.body)).not.toContain("phoneNumber");
    expect(JSON.stringify(detailResponse.body)).not.toContain("jid");
  });

  it("materializes events from the real EventLog query into public collection items", async () => {
    const repositories = createInMemoryRepositorySet();
    const eventLog = createInMemoryEventLogStore();

    eventLog.appendEvent({
      id: "event_demo",
      type: "provider.connection.updated.v1",
      timestamp: "2026-06-30T00:00:00.000Z",
      dataClassification: "internal",
      source: "provider_runtime",
      resourceRef: "inst_demo",
      correlationId: "corr_demo",
      payload: {
        raw: "hidden",
      },
    });

    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
      },
      eventLog,
    });
    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/events",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-events",
          "x-correlation-id": "corr-list-events",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-events",
      },
    );

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toEqual([
      {
        resourceType: "event",
        id: "event_demo",
        type: "provider.connection.updated.v1",
        source: "provider_runtime",
        resourceRef: "inst_demo",
        correlationId: "corr_demo",
        timestamp: "2026-06-30T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("payload");
    expect(JSON.stringify(response.body)).not.toContain("hidden");
  });

  it("materializes worker jobs through the monitoring API boundary", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        workerJobRepository: repositories.workerJobRepository,
      },
    });

    await repositories.workerJobRepository.save({
      id: "job:demo",
      ownerContext: "operations",
      workType: "outbound_message",
      safeMetadata: {
        jobKind: "outbound_message",
        instanceId: "inst_demo",
        messageId: "msg_demo",
        outboundIntentRef: "intent_hidden",
      },
      status: "queued",
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMilliseconds: 100,
        backoffMultiplier: 2,
      },
      recoveryActionRequired: false,
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.workerJobRepository.save>[0]);

    const listResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/jobs",
        headers: {
          "x-api-key": "monitoring-secret",
          "x-request-id": "req-list-jobs",
          "x-correlation-id": "corr-list-jobs",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-jobs",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: `/v1/jobs/${encodeURIComponent("job:demo")}`,
        headers: {
          "x-api-key": "monitoring-secret",
          "x-request-id": "req-get-job",
          "x-correlation-id": "corr-get-job",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-job",
      },
    );

    expect(listResponse.statusCode).toBe(200);
    expect("data" in listResponse.body ? listResponse.body.data : undefined).toEqual([
      {
        resourceType: "job",
        id: "job:demo",
        status: "queued",
        workType: "outbound_message",
        ownerContext: "operations",
        resourceRef: "msg_demo",
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "job",
      resourceId: "job:demo",
      id: "job:demo",
      status: "queued",
      workType: "outbound_message",
      ownerContext: "operations",
      resourceRef: "msg_demo",
      readStatus: "result",
    });
    expect(JSON.stringify(listResponse.body)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(listResponse.body)).not.toContain("intent_hidden");
    expect(JSON.stringify(detailResponse.body)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(detailResponse.body)).not.toContain("intent_hidden");
  });

  it("materializes queue summary through the monitoring API boundary without exposing queue internals", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        workerJobRepository: repositories.workerJobRepository,
      },
    });

    await repositories.workerJobRepository.save({
      id: "job:queue-summary",
      ownerContext: "operations",
      workType: "outbound_message",
      safeMetadata: {
        jobKind: "outbound_message",
        instanceId: "inst_queue",
        messageId: "msg_queue",
        outboundIntentRef: "intent_hidden",
      },
      status: "queued",
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMilliseconds: 100,
        backoffMultiplier: 2,
      },
      recoveryActionRequired: false,
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.workerJobRepository.save>[0]);

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/queue",
        headers: {
          "x-api-key": "monitoring-secret",
          "x-request-id": "req-get-queue",
          "x-correlation-id": "corr-get-queue",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-queue",
      },
    );

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      resourceType: "metrics",
      id: "queue",
      status: "active",
      totalJobCount: 1,
      queuedJobCount: 1,
      reservedJobCount: 0,
      runningJobCount: 0,
      retryingJobCount: 0,
      completedJobCount: 0,
      deadJobCount: 0,
      activeJobCount: 1,
      readStatus: "result",
    });
    expect(JSON.stringify(response.body)).not.toContain("outboundIntentRef");
    expect(JSON.stringify(response.body)).not.toContain("intent_hidden");
    expect(JSON.stringify(response.body)).not.toContain("safeMetadata");
    expect(JSON.stringify(response.body)).not.toContain("retryPolicy");
    expect(JSON.stringify(response.body)).not.toContain("domainEvents");
  });

  it("materializes webhooks through the public API boundary without exposing target URLs", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        webhookSubscriptionRepository: repositories.webhookSubscriptionRepository,
      },
    });

    await repositories.webhookSubscriptionRepository.save({
      id: "webhook:demo",
      targetUrl: "https://webhook.example.test/secret-path",
      status: "proposed",
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.webhookSubscriptionRepository.save>[0]);

    const listResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/webhooks",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-webhooks",
          "x-correlation-id": "corr-list-webhooks",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-webhooks",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: `/v1/webhooks/${encodeURIComponent("webhook:demo")}`,
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-webhook",
          "x-correlation-id": "corr-get-webhook",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-webhook",
      },
    );

    expect(listResponse.statusCode).toBe(200);
    expect("data" in listResponse.body ? listResponse.body.data : undefined).toEqual([
      {
        resourceType: "webhook",
        id: "webhook:demo",
        status: "proposed",
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "webhook",
      resourceId: "webhook:demo",
      id: "webhook:demo",
      status: "proposed",
      readStatus: "result",
    });
    expect(JSON.stringify(listResponse.body)).not.toContain("targetUrl");
    expect(JSON.stringify(listResponse.body)).not.toContain("secret-path");
    expect(JSON.stringify(detailResponse.body)).not.toContain("targetUrl");
    expect(JSON.stringify(detailResponse.body)).not.toContain("secret-path");
  });

  it("materializes webhook deliveries through the public API boundary without exposing retry policy internals", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        webhookDeliveryRepository: repositories.webhookDeliveryRepository,
      },
    });

    await repositories.webhookDeliveryRepository.save({
      id: "webhook-delivery:demo",
      webhookId: "webhook:demo",
      sourceSignalRef: "message.accepted.v1",
      status: "pending",
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMilliseconds: 100,
        backoffMultiplier: 2,
      },
      domainEvents: [],
    } as unknown as Parameters<typeof repositories.webhookDeliveryRepository.save>[0]);

    const listResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/webhook-deliveries",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-webhook-deliveries",
          "x-correlation-id": "corr-list-webhook-deliveries",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-webhook-deliveries",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: `/v1/webhook-deliveries/${encodeURIComponent("webhook-delivery:demo")}/history`,
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-webhook-delivery",
          "x-correlation-id": "corr-get-webhook-delivery",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-webhook-delivery",
      },
    );

    expect(listResponse.statusCode).toBe(200);
    expect("data" in listResponse.body ? listResponse.body.data : undefined).toEqual([
      {
        resourceType: "webhookDelivery",
        id: "webhook-delivery:demo",
        webhookId: "webhook:demo",
        status: "pending",
        eventType: "message.accepted.v1",
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "webhookDelivery",
      resourceId: "webhook-delivery:demo",
      id: "webhook-delivery:demo",
      webhookId: "webhook:demo",
      status: "pending",
      eventType: "message.accepted.v1",
      readStatus: "result",
    });
    expect(JSON.stringify(listResponse.body)).not.toContain("retryPolicy");
    expect(JSON.stringify(listResponse.body)).not.toContain("domainEvents");
    expect(JSON.stringify(detailResponse.body)).not.toContain("retryPolicy");
    expect(JSON.stringify(detailResponse.body)).not.toContain("domainEvents");
  });

  it("materializes groups through the public API boundary without exposing provider identifiers", async () => {
    const repositories = createInMemoryRepositorySet();
    const dispatcher = createApplicationDispatcher({
      repositories: {
        instanceRepository: repositories.instanceRepository,
        groupRepository: repositories.groupRepository,
      },
    });

    await repositories.groupRepository.save({
      id: "group_demo",
      instanceId: "inst_allowed",
      jid: "12345@g.us",
      status: "active",
      metadata: {
        subject: "Demo Group",
        description: "Demo group description",
      },
      members: [
        {
          jid: "12025550123@s.whatsapp.net",
          role: "admin",
          joinedAtEpochMilliseconds: 1_782_864_000_000,
        },
        {
          jid: "12025550124@s.whatsapp.net",
          role: "member",
        },
      ],
      actions: [
        {
          id: "group_action_secret",
          kind: "add_member",
          actorRef: "operator_secret",
          auditRequired: true,
          targetJid: "12025550124@s.whatsapp.net",
        },
      ],
      inviteLink: {
        id: "invite_secret",
        urlRef: "https://chat.whatsapp.com/secret",
        active: true,
      },
      muted: true,
      archived: false,
      pinned: true,
      domainEvents: [
        {
          eventId: "domain_event_secret",
        },
      ],
    } as unknown as Parameters<typeof repositories.groupRepository.save>[0]);

    const instanceListResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_allowed/groups",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-instance-groups",
          "x-correlation-id": "corr-list-instance-groups",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-instance-groups",
      },
    );
    const detailResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/groups/group_demo",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-get-group",
          "x-correlation-id": "corr-get-group",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-get-group",
      },
    );
    const membersResponse = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/groups/group_demo/members",
        headers: {
          "x-api-key": "test-secret",
          "x-request-id": "req-list-group-members",
          "x-correlation-id": "corr-list-group-members",
        },
      },
      {
        dispatcher,
        apiKeys,
        now: fixedNow,
        requestRefGenerator: () => "http-list-group-members",
      },
    );

    expect(instanceListResponse.statusCode).toBe(200);
    expect(
      "data" in instanceListResponse.body ? instanceListResponse.body.data : undefined,
    ).toEqual([
      {
        resourceType: "group",
        id: "group_demo",
        instanceId: "inst_allowed",
        status: "active",
        subject: "Demo Group",
        description: "Demo group description",
        memberCount: 2,
        adminCount: 1,
        muted: true,
        archived: false,
        pinned: true,
      },
    ]);
    expect(detailResponse.statusCode).toBe(200);
    expect("data" in detailResponse.body ? detailResponse.body.data : undefined).toMatchObject({
      resourceType: "group",
      resourceId: "group_demo",
      id: "group_demo",
      instanceId: "inst_allowed",
      status: "active",
      subject: "Demo Group",
      description: "Demo group description",
      memberCount: 2,
      adminCount: 1,
      muted: true,
      archived: false,
      pinned: true,
      readStatus: "result",
    });
    expect(membersResponse.statusCode).toBe(200);
    expect("data" in membersResponse.body ? membersResponse.body.data : undefined).toEqual([
      {
        resourceType: "groupMember",
        id: "group_demo:member:1",
        groupId: "group_demo",
        memberRef: "group_demo:member:1",
        role: "admin",
        status: "active",
        joinedAt: "2026-07-01T00:00:00.000Z",
      },
      {
        resourceType: "groupMember",
        id: "group_demo:member:2",
        groupId: "group_demo",
        memberRef: "group_demo:member:2",
        role: "member",
        status: "active",
      },
    ]);
    const serialized = JSON.stringify([
      instanceListResponse.body,
      detailResponse.body,
      membersResponse.body,
    ]);
    expect(serialized).not.toContain("@g.us");
    expect(serialized).not.toContain("@s.whatsapp.net");
    expect(serialized).not.toContain("12025550123");
    expect(serialized).not.toContain("chat.whatsapp.com");
    expect(serialized).not.toContain("inviteLink");
    expect(serialized).not.toContain("actions");
    expect(serialized).not.toContain("domainEvents");
  });

  it("does not expose raw group member JIDs or phone numbers in public DTOs", async () => {
    const dispatcher = new CapturingDispatcher({
      ListGroupMembers: {
        items: [
          {
            memberId: "member_public_ref",
            groupId: "group_1",
            jid: "123456789@s.whatsapp.net",
            phoneNumber: "+15551234567",
            role: "admin",
            status: "active",
            displayName: "Group admin",
          },
        ],
      },
    });
    const response = await request(dispatcher, "GET", "/v1/groups/group_1/members");

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toEqual([
      {
        resourceType: "groupMember",
        id: "member_public_ref",
        groupId: "group_1",
        role: "admin",
        status: "active",
        displayName: "Group admin",
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(response.body)).not.toContain("+15551234567");
  });

  it("rejects unsupported collection filters and sorts before Application dispatch", async () => {
    const dispatcher = new CapturingDispatcher();
    const unsupportedSort = await request(dispatcher, "GET", "/v1/instances?sort=secret");
    const unsupportedFilter = await request(dispatcher, "GET", "/v1/instances?owner=secret");

    expect(unsupportedSort.statusCode).toBe(400);
    expect("error" in unsupportedSort.body ? unsupportedSort.body.error : undefined).toMatchObject({
      code: "unsupported_sort",
      details: {
        category: "validation",
      },
    });
    expect(unsupportedFilter.statusCode).toBe(400);
    expect(
      "error" in unsupportedFilter.body ? unsupportedFilter.body.error : undefined,
    ).toMatchObject({
      code: "unsupported_filter",
      details: {
        category: "validation",
      },
    });
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
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
    const outboundMessageIntentStore = new CapturingOutboundMessageIntentStore();
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: "84999999999@s.whatsapp.net",
        text: "",
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
      outboundMessageIntentStore,
    });
    const serialized = JSON.stringify(response.body);

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
    expect(outboundMessageIntentStore.textIntents).toHaveLength(0);
    expect(serialized).not.toContain("84999999999@s.whatsapp.net");
  });

  it("maps send text message to the internal command without exposing command names in the URL", async () => {
    const dispatcher = new CapturingDispatcher();
    const outboundMessageIntentStore = new CapturingOutboundMessageIntentStore();
    const rawJid = "84999999999@s.whatsapp.net";
    const rawText = "hello from raw request";
    const response = await request(dispatcher, "POST", "/v1/instances/inst_allowed/messages/text", {
      body: {
        to: rawJid,
        text: rawText,
      },
      headers: {
        "idempotency-key": "send-text-1",
      },
      outboundMessageIntentStore,
    });
    const serialized = JSON.stringify(response.body);

    expect(response.statusCode).toBe(202);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      resourceType: "message",
      resourceId: "inst_allowed",
      operationStatus: "queued",
      accepted: true,
      retryable: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("command_outcome");
    expect(serialized).not.toContain(rawJid);
    expect(serialized).not.toContain(rawText);
    expect(outboundMessageIntentStore.textIntents).toEqual([
      {
        outboundIntentRef: expect.stringMatching(/^http\.send_text_message\.[a-f0-9]{24}$/u),
        recipientRef: rawJid,
        text: rawText,
      },
    ]);
    const storedIntentRef = outboundMessageIntentStore.textIntents[0]?.outboundIntentRef;
    expect(outboundMessageIntentStore.contexts).toEqual([
      expect.objectContaining({
        actorRef: "api_key:test-public-key",
        idempotencyKey: "send-text-1",
        dataClassification: "confidential",
      }),
    ]);
    expect(dispatcher.commandEnvelopes).toEqual([
      expect.objectContaining({
        name: "SendTextMessage",
        targetRef: "inst_allowed",
        actorRef: "api_key:test-public-key",
        idempotencyKey: "send-text-1",
        safeInputRef: storedIntentRef,
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

    const globalChatsResponse = await request(dispatcher, "GET", "/v1/chats");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/chats");
    await request(dispatcher, "GET", "/v1/chats/chat_1");
    const globalContactsResponse = await request(dispatcher, "GET", "/v1/contacts");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/contacts");
    await request(dispatcher, "GET", "/v1/contacts/contact_1");
    await request(dispatcher, "GET", "/v1/labels");
    await request(dispatcher, "GET", "/v1/instances/inst_allowed/labels");
    await request(dispatcher, "GET", "/v1/labels/label_1");

    expect(
      "error" in globalChatsResponse.body ? globalChatsResponse.body.error.code : undefined,
    ).toBe("global_chats_public_route_not_available");
    expect(
      "error" in globalContactsResponse.body ? globalContactsResponse.body.error.code : undefined,
    ).toBe("global_contacts_public_route_not_available");
    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.name)).toEqual([
      "ListInstanceChats",
      "GetChatStatus",
      "ListInstanceContacts",
      "GetContactStatus",
      "ListLabels",
      "ListInstanceLabels",
      "GetLabelStatus",
    ]);
    expect(dispatcher.queryEnvelopes.map((envelope) => envelope.targetRef)).toEqual([
      "inst_allowed",
      "chat_1",
      "inst_allowed",
      "contact_1",
      undefined,
      "inst_allowed",
      "label_1",
    ]);
  });

  it("maps group resources to approved group commands and queries", async () => {
    const dispatcher = new CapturingDispatcher();
    const groupMutationIntentStore = new CapturingGroupMutationIntentStore();

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
      groupMutationIntentStore,
    });
    await request(dispatcher, "PATCH", "/v1/groups/group_1/local-state", {
      body: { archived: true },
      headers: { "idempotency-key": "archive-group-1" },
      groupMutationIntentStore,
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members", {
      body: { jid: "12025550123@s.whatsapp.net" },
      headers: { "idempotency-key": "add-group-member-1" },
      groupMutationIntentStore,
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members/member_1/promote", {
      headers: { "idempotency-key": "promote-group-member-1" },
      groupMutationIntentStore,
    });
    await request(dispatcher, "POST", "/v1/groups/group_1/members/member_1/demote", {
      headers: { "idempotency-key": "demote-group-member-1" },
      groupMutationIntentStore,
    });
    await request(dispatcher, "DELETE", "/v1/groups/group_1/members/member_1", {
      headers: { "idempotency-key": "remove-group-member-1" },
      groupMutationIntentStore,
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
    expect(groupMutationIntentStore.intents.map((intent) => intent.kind)).toEqual([
      "metadata",
      "local_state",
      "add_member",
      "promote_member",
      "demote_member",
      "remove_member",
    ]);
    expect(groupMutationIntentStore.contexts.every((context) => context.actorRef)).toBe(true);
    expect(dispatcher.commandEnvelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "AddGroupMember",
          safeInputRef: expect.stringMatching(/^http\.add_group_member\.[a-f0-9]{24}$/u),
        }),
      ]),
    );
    expect(JSON.stringify(dispatcher.commandEnvelopes)).not.toContain("12025550123");
  });

  it("stores group member mutation input internally without leaking raw JID in the response", async () => {
    const dispatcher = new CapturingDispatcher();
    const groupMutationIntentStore = new CapturingGroupMutationIntentStore();
    const rawJid = "12025550123@s.whatsapp.net";

    const response = await request(dispatcher, "POST", "/v1/groups/group_1/members", {
      body: { jid: rawJid },
      headers: { "idempotency-key": "add-group-member-safe" },
      groupMutationIntentStore,
    });

    expect(response.statusCode).toBe(202);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      operationStatus: "accepted",
      accepted: true,
    });
    expect(groupMutationIntentStore.intents).toEqual([
      expect.objectContaining({
        kind: "add_member",
        memberJid: rawJid,
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain(rawJid);
    expect(JSON.stringify(dispatcher.commandEnvelopes)).not.toContain(rawJid);
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

  it("lists API key lifecycle records through the admin boundary without exposing key material", async () => {
    const dispatcher = new CapturingDispatcher();
    const apiKeyLifecycleService = createTestApiKeyLifecycleService();

    await apiKeyLifecycleService.provision({
      key: "managed-api-key-secret",
      credential: {
        kind: "api_key",
        keyId: "managed-api-key",
        scopes: ["instances:read"],
        allowedInstanceRefs: ["inst_allowed"],
      },
      actorRef: "test:seed",
    });

    const response = await request(dispatcher, "GET", "/v1/api-keys", {
      apiKey: "admin-secret",
      apiKeyLifecycleService,
    });
    const serialized = JSON.stringify(response.body);

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toEqual([
      {
        resourceType: "apiKey",
        id: "managed-api-key",
        kind: "api_key",
        scopes: ["instances:read"],
        allowedInstanceRefs: ["inst_allowed"],
        status: "active",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ]);
    expect(serialized).not.toContain("managed-api-key-secret");
    expect(serialized).not.toContain("sha256:");
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("requires admin scope before API key lifecycle routes can run", async () => {
    const dispatcher = new CapturingDispatcher();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();
    const apiKeyLifecycleService = createTestApiKeyLifecycleService();

    const response = await request(dispatcher, "GET", "/v1/api-keys", {
      apiKeyLifecycleService,
      securityAuditSink,
    });

    expect(response.statusCode).toBe(403);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "missing_scope",
      details: {
        category: "authorization",
        requiredScope: "admin:*",
      },
    });
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "authorization_denied",
        requestId: "req-test",
        correlationId: "corr-test",
        keyId: "test-public-key",
        credentialKind: "api_key",
        operationRef: "ListApiKeys",
        resourceType: "api_key",
      }),
    ]);
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("fails safe when API key lifecycle routes are not configured", async () => {
    const dispatcher = new CapturingDispatcher();
    const response = await request(dispatcher, "GET", "/v1/api-keys", {
      apiKey: "admin-secret",
    });

    expect(response.statusCode).toBe(501);
    expect("error" in response.body ? response.body.error : undefined).toMatchObject({
      code: "api_key_lifecycle_service_not_configured",
      details: {
        category: "not_implemented",
      },
    });
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("provisions API keys through admin lifecycle routes with safe DTOs and audit evidence", async () => {
    const dispatcher = new CapturingDispatcher();
    const apiKeyLifecycleService = createTestApiKeyLifecycleService();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();

    const response = await request(dispatcher, "POST", "/v1/api-keys", {
      apiKey: "admin-secret",
      apiKeyLifecycleService,
      securityAuditSink,
      body: {
        key: "new-managed-secret",
        keyId: "managed-provisioned-key",
        kind: "api_key",
        scopes: ["instances:read", "messages:send"],
        allowedInstanceRefs: ["inst_allowed"],
      },
    });
    const serialized = JSON.stringify(response.body);

    expect(response.statusCode).toBe(201);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      resourceType: "apiKey",
      resourceId: "managed-provisioned-key",
      operationStatus: "completed",
      accepted: true,
      async: false,
      apiKey: {
        resourceType: "apiKey",
        id: "managed-provisioned-key",
        kind: "api_key",
        scopes: ["instances:read", "messages:send"],
        allowedInstanceRefs: ["inst_allowed"],
        status: "active",
      },
    });
    expect(serialized).not.toContain("new-managed-secret");
    expect(serialized).not.toContain("sha256:");
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "admin_action",
        code: "api_key_lifecycle_admin_action",
        operationRef: "ProvisionApiKey",
        targetRef: "managed-provisioned-key",
        resourceType: "api_key",
        keyId: "test-admin-key",
        credentialKind: "admin_key",
      }),
    ]);
    expect(dispatcher.commandEnvelopes).toHaveLength(0);
    expect(dispatcher.queryEnvelopes).toHaveLength(0);
  });

  it("revokes API keys through admin lifecycle routes without exposing hashes or plaintext", async () => {
    const dispatcher = new CapturingDispatcher();
    const apiKeyLifecycleService = createTestApiKeyLifecycleService();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();

    await apiKeyLifecycleService.provision({
      key: "revoked-managed-secret",
      credential: {
        kind: "api_key",
        keyId: "managed-revoked-key",
        scopes: ["instances:read"],
      },
      actorRef: "test:seed",
    });

    const response = await request(dispatcher, "POST", "/v1/api-keys/managed-revoked-key/revoke", {
      apiKey: "admin-secret",
      apiKeyLifecycleService,
      securityAuditSink,
      body: {
        reasonCode: "operator_requested",
      },
    });
    const serialized = JSON.stringify(response.body);

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      resourceType: "apiKey",
      resourceId: "managed-revoked-key",
      operationStatus: "completed",
      apiKey: {
        resourceType: "apiKey",
        id: "managed-revoked-key",
        status: "revoked",
        revocationReasonCode: "operator_requested",
      },
    });
    expect(serialized).not.toContain("revoked-managed-secret");
    expect(serialized).not.toContain("sha256:");
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "admin_action",
        path: "/v1/api-keys/[key-id]/revoke",
        operationRef: "RevokeApiKey",
        targetRef: "managed-revoked-key",
        resourceType: "api_key",
      }),
    ]);
  });

  it("rotates API keys through admin lifecycle routes with safe replacement DTOs", async () => {
    const dispatcher = new CapturingDispatcher();
    const apiKeyLifecycleService = createTestApiKeyLifecycleService();
    const securityAuditSink = new InMemoryApiSecurityAuditSink();

    await apiKeyLifecycleService.provision({
      key: "rotation-current-secret",
      credential: {
        kind: "api_key",
        keyId: "managed-current-key",
        scopes: ["instances:read"],
      },
      actorRef: "test:seed",
    });

    const response = await request(dispatcher, "POST", "/v1/api-keys/managed-current-key/rotate", {
      apiKey: "admin-secret",
      apiKeyLifecycleService,
      securityAuditSink,
      body: {
        nextKey: "rotation-next-secret",
        nextKeyId: "managed-next-key",
        kind: "api_key",
        scopes: ["instances:read", "messages:send"],
        reasonCode: "scheduled_rotation",
      },
    });
    const serialized = JSON.stringify(response.body);

    expect(response.statusCode).toBe(200);
    expect("data" in response.body ? response.body.data : undefined).toMatchObject({
      resourceType: "apiKey",
      resourceId: "managed-next-key",
      operationStatus: "completed",
      revoked: {
        resourceType: "apiKey",
        id: "managed-current-key",
        status: "revoked",
        revocationReasonCode: "scheduled_rotation",
      },
      replacement: {
        resourceType: "apiKey",
        id: "managed-next-key",
        status: "active",
        rotatedFromKeyId: "managed-current-key",
        scopes: ["instances:read", "messages:send"],
      },
    });
    expect(serialized).not.toContain("rotation-current-secret");
    expect(serialized).not.toContain("rotation-next-secret");
    expect(serialized).not.toContain("sha256:");
    expect(securityAuditSink.snapshot()).toEqual([
      expect.objectContaining({
        eventType: "admin_action",
        path: "/v1/api-keys/[key-id]/rotate",
        operationRef: "RotateApiKey",
        targetRef: "managed-next-key",
        resourceType: "api_key",
      }),
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
    apiKeys?: readonly ApiKeyConfig[];
    apiKeyLifecycleService?: ApiKeyLifecycleService;
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
    outboundMessageIntentStore?: OutboundMessageIntentStorePort;
    groupMutationIntentStore?: GroupMutationIntentStorePort;
    securityAuditSink?: InMemoryApiSecurityAuditSink;
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
      apiKeys: input.apiKeys ?? apiKeys,
      now: fixedNow,
      requestRefGenerator: () => "http-test",
      ...optional("apiKeyLifecycleService", input.apiKeyLifecycleService),
      ...optional("outboundMessageIntentStore", input.outboundMessageIntentStore),
      ...optional("groupMutationIntentStore", input.groupMutationIntentStore),
      ...optional("securityAuditSink", input.securityAuditSink),
    },
  );
}

function fixedNow(): Date {
  return new Date("2026-06-30T00:00:00.000Z");
}

function createTestApiKeyLifecycleService(): ApiKeyLifecycleService {
  return new ApiKeyLifecycleService({
    store: new InMemoryApiKeyLifecycleStore(),
    now: fixedNow,
  });
}

function getCollectionMeta(response: ApiHttpResponse): HttpCollectionResponseMeta {
  if ("data" in response.body && "pagination" in response.body.meta) {
    return response.body.meta;
  }

  throw new Error("Expected collection response meta.");
}

function safeResponseString(response: ApiHttpResponse, key: string): string {
  if ("data" in response.body && isTestRecord(response.body.data)) {
    const value = response.body.data[key];

    if (typeof value === "string") {
      return value;
    }
  }

  throw new Error(`Expected response data string field '${key}'.`);
}

function isTestRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class CapturingDispatcher implements ApplicationInterfaceDispatcher {
  readonly commandEnvelopes: ApplicationCommandEnvelope[] = [];
  readonly queryEnvelopes: ApplicationQueryEnvelope[] = [];

  constructor(
    private readonly queryPayloads: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    > = {},
  ) {}

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    this.commandEnvelopes.push(envelope);

    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome: outcomeForCapturedCommand(envelope.name),
      accepted: true,
      retryable: false,
      resultRef: `${envelope.commandRef}:result`,
    });
  }

  executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
    this.queryEnvelopes.push(envelope);
    const payload = this.queryPayloads[envelope.name] ?? {};

    return Object.freeze({
      ...createApplicationQueryOutcome({
        queryRef: envelope.queryRef,
        outcome: "result",
        consistency: envelope.requestedConsistency ?? "strong_owner",
        freshness: {
          stale: false,
          refreshedAtEpochMilliseconds: 1,
        },
        resultRef: `${envelope.queryRef}:result`,
      }),
      ...payload,
    }) as ApplicationQueryOutcome;
  }
}

function outcomeForCapturedCommand(name: string): ApplicationCommandOutcome["outcome"] {
  if (name === "SendTextMessage") {
    return "queued";
  }

  if (
    ["AddGroupMember", "RemoveGroupMember", "PromoteGroupMember", "DemoteGroupMember"].includes(
      name,
    )
  ) {
    return "accepted";
  }

  return "completed";
}

class CapturingOutboundMessageIntentStore implements OutboundMessageIntentStorePort {
  readonly textIntents: TextOutboundMessageIntentInput[] = [];
  readonly contexts: ApplicationPortContext[] = [];
  readonly bindings: OutboundMessageIntentBinding[] = [];

  storeTextIntent(
    intent: TextOutboundMessageIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    this.textIntents.push(intent);
    this.contexts.push(context);

    return Promise.resolve(
      ok({
        outboundIntentRef:
          intent.outboundIntentRef ?? createOutboundMessageIntentRef("intent_generated"),
        kind: "text",
        createdAtEpochMilliseconds: 1,
      }),
    );
  }

  bindMessageIntent(
    binding: OutboundMessageIntentBinding,
  ): Promise<ApplicationPortResult<OutboundMessageIntentBinding>> {
    this.bindings.push(binding);
    return Promise.resolve(ok(binding));
  }

  findTextIntentByMessage(
    messageId: MessageId,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    const binding = this.bindings.find((record) => String(record.messageId) === String(messageId));

    return Promise.resolve(
      binding === undefined
        ? err(
            createApplicationPortFailure({
              category: "rejected",
              code: "outbound_intent_not_found",
              message: "Outbound message intent was not found.",
              retryable: false,
              ownerContext: "messaging",
            }),
          )
        : ok({
            outboundIntentRef: binding.outboundIntentRef,
            kind: "text",
            createdAtEpochMilliseconds: 1,
          }),
    );
  }

  verifyTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>> {
    return Promise.resolve(
      ok({
        outboundIntentRef,
        kind: "text",
        createdAtEpochMilliseconds: 1,
      }),
    );
  }

  resolveTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
  ): Promise<ApplicationPortResult<StoredTextOutboundMessageIntent>> {
    return Promise.resolve(
      ok({
        outboundIntentRef,
        kind: "text",
        recipientRef: "stored-recipient",
        text: "stored-text",
        createdAtEpochMilliseconds: 1,
      }),
    );
  }
}

class CapturingGroupMutationIntentStore implements GroupMutationIntentStorePort {
  readonly intents: GroupMutationIntentInput[] = [];
  readonly contexts: ApplicationPortContext[] = [];

  storeGroupMutationIntent(
    intent: GroupMutationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<GroupMutationIntentReceipt>> {
    this.intents.push(intent);
    this.contexts.push(context);

    return Promise.resolve(
      ok({
        groupMutationIntentRef:
          intent.groupMutationIntentRef ?? createGroupMutationIntentRef("group_intent_generated"),
        kind: intent.kind,
        createdAtEpochMilliseconds: 1,
      }),
    );
  }

  resolveGroupMutationIntent(
    groupMutationIntentRef: GroupMutationIntentRef,
  ): Promise<ApplicationPortResult<StoredGroupMutationIntent>> {
    return Promise.resolve(
      ok({
        groupMutationIntentRef,
        kind: "metadata",
        subject: "stored group mutation",
        createdAtEpochMilliseconds: 1,
      }),
    );
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
