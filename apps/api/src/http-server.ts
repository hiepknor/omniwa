import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  createOutboundMessageIntentRef,
  type ApplicationPortContext,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
  type OutboundMessageIntentStorePort,
} from "@omniwa/application";
import {
  ApiInterfaceAdapter,
  type ApiBoundary,
  type ApiCommandRequest,
  type ApiCredential,
  type ApiCredentialKind,
  type ApiQueryRequest,
  type ApiRequest,
  type ApiResponse,
  type ApiScope,
  type ApplicationInterfaceDispatcher,
} from "@omniwa/interface-api";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createTraceId,
} from "@omniwa/shared";

import {
  createApiKeyVerifierFromPlaintext,
  type ApiKeyConfig,
  type ApiKeyVerifier,
} from "./api-key-auth.js";
import {
  classifyRateLimitEndpoint,
  type ApiRateLimiter,
  type ApiRateLimitEndpointClass,
} from "./api-rate-limiter.js";
import {
  createEmptyRealtimeEventSource,
  encodeServerSentEvents,
  type RealtimeEventSource,
} from "./realtime-event-stream.js";
import type { ApiSecurityAuditSink } from "./api-security-audit.js";
import {
  authorizeApiResourceOwnership,
  inferApiResourceOwnershipResourceType,
  type ApiResourceOwnershipDecision,
  type ApiResourceOwnershipResolver,
} from "./resource-ownership.js";
import {
  paginationMetaFromOptions,
  publicCollectionPage,
  publicResourceData,
  type PublicCollectionQueryOptions,
  type PublicPaginationMeta,
} from "./public-resource-dto.js";

export type { ApiKeyConfig, ApiKeyVerifier } from "./api-key-auth.js";
export type { ApiRateLimiter } from "./api-rate-limiter.js";
export type { ApiSecurityAuditEvent, ApiSecurityAuditSink } from "./api-security-audit.js";
export type { PublicPaginationMeta } from "./public-resource-dto.js";
export type { ApiResourceOwnershipResolver } from "./resource-ownership.js";

const apiPrefix = "v1";
const jsonContentType = "application/json; charset=utf-8";
const eventStreamContentType = "text/event-stream; charset=utf-8";
const maxRequestBodyBytes = 1_000_000;
const defaultSseReplayLimit = 100;

export type ApiHttpServerOptions = Readonly<{
  dispatcher?: ApplicationInterfaceDispatcher;
  adapter?: ApiInterfaceAdapter;
  apiKeys?: readonly ApiKeyConfig[];
  apiKeyVerifier?: ApiKeyVerifier;
  rateLimiter?: ApiRateLimiter;
  resourceOwnershipResolver?: ApiResourceOwnershipResolver;
  securityAuditSink?: ApiSecurityAuditSink;
  eventSource?: RealtimeEventSource;
  outboundMessageIntentStore?: OutboundMessageIntentStorePort;
  sseReplayLimit?: number;
  now?: () => Date;
  requestRefGenerator?: () => string;
}>;

export type ApiHttpRequest = Readonly<{
  method: string;
  url: string;
  headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  body?: unknown;
}>;

export type ApiHttpResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: SuccessEnvelope | CollectionEnvelope | ErrorEnvelope;
}>;

export type ApiSseResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

export type ApiEventStreamResponse = ApiSseResponse | ApiHttpResponse;

export type SuccessEnvelope = Readonly<{
  data: unknown;
  meta: HttpResponseMeta;
}>;

export type CollectionEnvelope = Readonly<{
  data: readonly unknown[];
  meta: HttpCollectionResponseMeta;
}>;

export type ErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    details: Readonly<Record<string, unknown>>;
  }>;
  meta: HttpResponseMeta;
}>;

export type HttpResponseMeta = Readonly<{
  requestId: string;
  correlationId: string;
  timestamp: string;
}>;

export type HttpCollectionResponseMeta = HttpResponseMeta &
  Readonly<{
    pagination: PublicPaginationMeta;
    query: PublicQueryMeta;
  }>;

export type PublicQueryMeta = Readonly<{
  resourceType: string;
  readStatus: string;
  consistency?: string;
  freshness?: unknown;
  resultRef?: string;
}>;

type PublicResponseContract =
  | Readonly<{
      shape: "operation";
      resourceType: string;
      resourceId?: string;
    }>
  | Readonly<{
      shape: "resource";
      resourceType: string;
      resourceId?: string;
    }>
  | Readonly<{
      shape: "collection";
      resourceType: string;
      queryOptions: PublicCollectionQueryOptions;
    }>;

type HttpFailureCategory =
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "business"
  | "conflict"
  | "infrastructure"
  | "validation"
  | "not_found"
  | "not_implemented"
  | "internal";

type HttpFailure = Readonly<{
  category: HttpFailureCategory;
  code: string;
  message: string;
  statusCode: number;
  details?: Readonly<Record<string, unknown>>;
}>;

type RouteMatch =
  | Readonly<{
      kind: "adapter";
      request: ApiRequest;
      responseContract: PublicResponseContract;
      bodyValidation?: BodyValidation;
    }>
  | Readonly<{
      kind: "partial";
      bodyValidation?: BodyValidation;
      failure: HttpFailure;
    }>;

type BodyValidation = Readonly<{
  required: boolean;
  validate(body: unknown): HttpFailure | undefined;
}>;

type RouteContext = Readonly<{
  requestRef: string;
  requestId: string;
  correlationId: string;
  searchParams: URLSearchParams;
  traceId?: string;
  credential: ApiCredential;
  idempotencyKey?: string;
}>;

export async function handleApiHttpRequest(
  request: ApiHttpRequest,
  options: ApiHttpServerOptions = {},
): Promise<ApiHttpResponse> {
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const requestRef = options.requestRefGenerator?.() ?? `http:${randomUUID()}`;
  const headers = normalizeHeaders(request.headers ?? {});
  const requestId = getHeader(headers, "x-request-id") ?? requestRef;
  const correlationId = getHeader(headers, "x-correlation-id") ?? `corr:${requestId}`;
  const traceId = getHeader(headers, "x-trace-id");
  const metaBase = createMeta(requestId, correlationId, timestamp);
  const parsedRequestUrl = parseUrl(request.url);
  const route = matchRoute(request.method, request.url);

  if (route === undefined) {
    return createErrorHttpResponse(
      notFound("route_not_found", "Route is not part of the public API surface."),
      metaBase,
    );
  }

  const credential = authenticateHeader(
    headers,
    options.apiKeyVerifier,
    options.apiKeys ?? readApiKeysFromEnv(),
  );

  if (credential === undefined) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "authentication_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: "missing_or_invalid_api_key",
      statusCode: 401,
    });

    return createErrorHttpResponse(
      {
        category: "authentication",
        code: "missing_or_invalid_api_key",
        message: "API request requires a valid x-api-key header.",
        statusCode: 401,
      },
      metaBase,
    );
  }

  const validationFailure = route.bodyValidation?.validate(request.body);

  if (validationFailure !== undefined) {
    return createErrorHttpResponse(validationFailure, metaBase);
  }

  const context: RouteContext = {
    requestRef,
    requestId,
    correlationId,
    searchParams: parsedRequestUrl?.searchParams ?? new URLSearchParams(),
    credential,
    ...optional("traceId", traceId),
    ...optional("idempotencyKey", getHeader(headers, "idempotency-key")),
  };
  const match = route.build(context, request.body);

  if (match.bodyValidation !== undefined) {
    const bodyFailure = match.bodyValidation.validate(request.body);

    if (bodyFailure !== undefined) {
      return createErrorHttpResponse(bodyFailure, metaBase);
    }
  }

  if (match.kind === "partial") {
    return createErrorHttpResponse(match.failure, metaBase);
  }

  const ownership = await checkResourceOwnership(match.request, options.resourceOwnershipResolver);

  if (ownership.decision?.allowed === true && ownership.decision.bypass === "admin_scope") {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "admin_bypass",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: "admin_scope_bypass",
      statusCode: 200,
      keyId: credential.keyId,
      credentialKind: credential.kind,
      operationRef: match.request.name,
      ...optional("targetRef", match.request.targetRef),
      ...optional("instanceRef", ownership.decision.instanceRef),
      resourceType: ownership.decision.resourceType,
    });
  }

  if (ownership.failure !== undefined) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "authorization_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: ownership.failure.code,
      statusCode: ownership.failure.statusCode,
      keyId: credential.keyId,
      credentialKind: credential.kind,
      operationRef: match.request.name,
      ...optional("targetRef", match.request.targetRef),
      ...optional("resourceType", ownership.decision?.resourceType),
    });

    return createErrorHttpResponse(ownership.failure, metaBase);
  }

  const rateLimit = checkRateLimit(
    credential,
    request.method,
    request.url,
    ownership.decision?.allowed === true ? ownership.decision.instanceRef : undefined,
    match.request.targetRef,
    options.rateLimiter,
  );

  if (rateLimit.failure !== undefined) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "rate_limit_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: rateLimit.failure.code,
      statusCode: rateLimit.failure.statusCode,
      keyId: credential.keyId,
      credentialKind: credential.kind,
      operationRef: match.request.name,
      ...optional("targetRef", match.request.targetRef),
      ...optional(
        "instanceRef",
        ownership.decision?.allowed ? ownership.decision.instanceRef : undefined,
      ),
      ...optional("endpointClass", rateLimit.endpointClass),
      ...optional("rateLimitBucketKey", rateLimit.bucketKey),
    });

    return createErrorHttpResponse(rateLimit.failure, metaBase);
  }

  const outboundIntentFailure = await storeOutboundIntentForAdapterRequest(
    match,
    request.body,
    context,
    options.outboundMessageIntentStore,
  );

  if (outboundIntentFailure !== undefined) {
    return createErrorHttpResponse(outboundIntentFailure, metaBase);
  }

  const adapter =
    options.adapter ??
    new ApiInterfaceAdapter({
      dispatcher: options.dispatcher ?? createUnavailableDispatcher(),
    });
  const adapterResponse = await adapter.handle(match.request);
  await recordAdapterSecurityAudit(options.securityAuditSink, adapterResponse, match.request, {
    requestId,
    correlationId,
    timestamp,
    method: request.method,
    url: request.url,
  });

  return mapAdapterResponse(adapterResponse, timestamp, match.request, match.responseContract);
}

export async function handleApiEventStreamRequest(
  request: ApiHttpRequest,
  options: ApiHttpServerOptions = {},
): Promise<ApiEventStreamResponse> {
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const requestRef = options.requestRefGenerator?.() ?? `http:${randomUUID()}`;
  const headers = normalizeHeaders(request.headers ?? {});
  const requestId = getHeader(headers, "x-request-id") ?? requestRef;
  const correlationId = getHeader(headers, "x-correlation-id") ?? `corr:${requestId}`;
  const metaBase = createMeta(requestId, correlationId, timestamp);
  const parsedUrl = parseUrl(request.url);
  const segments = parsedUrl === undefined ? undefined : splitPath(parsedUrl.pathname);

  if (
    request.method.toUpperCase() !== "GET" ||
    parsedUrl === undefined ||
    segments === undefined ||
    !matches(segments, ["v1", "events", "stream"])
  ) {
    return createErrorHttpResponse(
      notFound("route_not_found", "Route is not part of the public API surface."),
      metaBase,
    );
  }

  const credential = authenticateHeader(
    headers,
    options.apiKeyVerifier,
    options.apiKeys ?? readApiKeysFromEnv(),
  );

  if (credential === undefined) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "authentication_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: "missing_or_invalid_api_key",
      statusCode: 401,
    });

    return createErrorHttpResponse(
      {
        category: "authentication",
        code: "missing_or_invalid_api_key",
        message: "API request requires a valid x-api-key header.",
        statusCode: 401,
      },
      metaBase,
    );
  }

  const rateLimit = checkRateLimit(
    credential,
    request.method,
    request.url,
    undefined,
    undefined,
    options.rateLimiter,
  );

  if (rateLimit.failure !== undefined) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "rate_limit_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: rateLimit.failure.code,
      statusCode: rateLimit.failure.statusCode,
      keyId: credential.keyId,
      credentialKind: credential.kind,
      ...optional("endpointClass", rateLimit.endpointClass),
      ...optional("rateLimitBucketKey", rateLimit.bucketKey),
    });

    return createErrorHttpResponse(rateLimit.failure, metaBase);
  }

  if (!credential.scopes.includes("admin:*") && !credential.scopes.includes("events:read")) {
    await recordSecurityAudit(options.securityAuditSink, {
      eventType: "authorization_denied",
      requestId,
      correlationId,
      timestamp,
      method: request.method,
      url: request.url,
      code: "missing_scope",
      statusCode: 403,
      keyId: credential.keyId,
      credentialKind: credential.kind,
      operationRef: "ListEvents",
      resourceType: "event",
    });

    return createErrorHttpResponse(
      {
        category: "authorization",
        code: "missing_scope",
        message: "API credential is missing required scope.",
        statusCode: 403,
      },
      metaBase,
    );
  }

  const cursor = parsedUrl.searchParams.get("cursor") ?? getHeader(headers, "last-event-id");
  const eventSource = options.eventSource ?? createEmptyRealtimeEventSource();
  const replayRequest = {
    ...(cursor === null || cursor === undefined || cursor.trim().length === 0
      ? {}
      : { cursor: cursor.trim() }),
    limit: options.sseReplayLimit ?? defaultSseReplayLimit,
  };
  const events = eventSource.replay(replayRequest);
  const cursorInspection = eventSource.inspectCursor?.(replayRequest);

  return Object.freeze({
    statusCode: 200,
    headers: createSseHeaders(metaBase, cursorInspection),
    body: encodeServerSentEvents({
      events,
      requestId,
      correlationId,
      timestamp,
    }),
  });
}

export function createApiHttpServer(options: ApiHttpServerOptions = {}): Server {
  return createServer(async (request, response) => {
    if (isEventStreamIncomingRequest(request)) {
      const apiResponse = await handleIncomingEventStreamRequest(request, options);

      writeEventStreamResponse(response, apiResponse);
      return;
    }

    const apiResponse = await handleIncomingRequest(request, options);

    writeHttpResponse(response, apiResponse);
  });
}

export function readApiKeysFromEnv(env: NodeJS.ProcessEnv = process.env): readonly ApiKeyConfig[] {
  const key = env.OMNIWA_API_KEY?.trim();

  if (key === undefined || key.length === 0) {
    return [];
  }

  return Object.freeze([
    Object.freeze({
      key,
      credential: Object.freeze({
        kind: parseCredentialKind(env.OMNIWA_API_KEY_KIND),
        keyId: env.OMNIWA_API_KEY_ID?.trim() || "env-api-key",
        scopes: parseScopes(env.OMNIWA_API_KEY_SCOPES),
        ...optional("allowedInstanceRefs", parseCsv(env.OMNIWA_API_KEY_ALLOWED_INSTANCES)),
      }),
    }),
  ]);
}

function matchRoute(
  methodInput: string,
  urlInput: string,
):
  | Readonly<{
      build(context: RouteContext, body: unknown): RouteMatch;
      bodyValidation?: BodyValidation;
    }>
  | undefined {
  const method = methodInput.toUpperCase();
  const parsedUrl = parseUrl(urlInput);

  if (parsedUrl === undefined) {
    return {
      build: () => ({
        kind: "partial",
        failure: validation("invalid_url", "Request URL is invalid."),
      }),
    };
  }

  const segments = splitPath(parsedUrl.pathname);

  if (segments === undefined || segments[0] !== apiPrefix) {
    return undefined;
  }

  if (method === "GET" && matches(segments, ["v1", "health"])) {
    return adapterQuery("health", "GetHealthStatus", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "health", "readiness"])) {
    return adapterQuery("health", "GetHealthStatus", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "action-required"])) {
    return adapterQuery("health", "GetActionRequiredItems", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "events"])) {
    return adapterQuery("public", "ListEvents", undefined, "retention_bound");
  }

  if (method === "GET" && matches(segments, ["v1", "metrics"])) {
    return adapterQuery(
      "monitoring",
      "GetOperationalMetricsSnapshot",
      undefined,
      "eventual_projection",
    );
  }

  if (method === "GET" && matches(segments, ["v1", "dashboard"])) {
    return adapterQuery("monitoring", "GetDashboardSummary", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "metrics", "queue"])) {
    return adapterQuery("monitoring", "GetQueueMetricsSnapshot", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "metrics", "messages"])) {
    return adapterQuery(
      "monitoring",
      "GetMessageMetricsSnapshot",
      undefined,
      "eventual_projection",
    );
  }

  if (method === "GET" && matches(segments, ["v1", "metrics", "webhooks"])) {
    return adapterQuery(
      "monitoring",
      "GetWebhookMetricsSnapshot",
      undefined,
      "eventual_projection",
    );
  }

  if (method === "GET" && matches(segments, ["v1", "metrics", "media"])) {
    return adapterQuery("monitoring", "GetMediaMetricsSnapshot", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "instances"])) {
    return adapterQuery("public", "ListInstances", undefined, "eventual_projection");
  }

  if (method === "POST" && matches(segments, ["v1", "instances"])) {
    return adapterCommand("public", "CreateInstance", undefined, validateCreateInstanceBody);
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId"])) {
    return adapterQuery("public", "GetInstanceStatus", segments[2], "strong_owner");
  }

  if (method === "PATCH" && matches(segments, ["v1", "instances", ":instanceId"])) {
    return adapterCommand("public", "UpdateInstanceMetadata", segments[2], validateObjectBody);
  }

  if (method === "DELETE" && matches(segments, ["v1", "instances", ":instanceId"])) {
    return adapterCommand("admin", "DestroyInstance", segments[2], validateOptionalObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "instances", ":instanceId", "connect"])) {
    return adapterCommand("public", "ConnectInstance", segments[2], validateObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "instances", ":instanceId", "disconnect"])) {
    return adapterCommand("public", "DisconnectInstance", segments[2], validateObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "instances", ":instanceId", "qr", "refresh"])) {
    return adapterCommand("public", "RefreshQrPairing", segments[2], validateObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "instances", ":instanceId", "reconnect"])) {
    return partialRoute(
      "reconnect_public_route_not_available",
      "Reconnect is currently scheduler-owned in the Application catalog and is not exposed through the public API boundary.",
    );
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "sessions"])) {
    return adapterQuery("public", "ListInstanceSessions", segments[2], "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "messages"])) {
    return adapterQuery("public", "ListInstanceMessages", segments[2], "retention_bound");
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "chats"])) {
    return adapterQuery("public", "ListInstanceChats", segments[2], "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "contacts"])) {
    return adapterQuery("public", "ListInstanceContacts", segments[2], "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "labels"])) {
    return adapterQuery("public", "ListInstanceLabels", segments[2], "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "instances", ":instanceId", "groups"])) {
    return adapterQuery("public", "ListInstanceGroups", segments[2], "eventual_projection");
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "instances", ":instanceId", "groups", "refresh"])
  ) {
    return adapterCommand("public", "RefreshGroupList", segments[2], validateOptionalObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "instances", ":instanceId", "messages"])) {
    return sendMessageRoute(segments[2]);
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "instances", ":instanceId", "messages", "text"])
  ) {
    return adapterCommand("public", "SendTextMessage", segments[2], validateSendTextBody);
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "instances", ":instanceId", "messages", "media"])
  ) {
    return adapterCommand("public", "SendMediaMessage", segments[2], validateSendMediaBody);
  }

  if (method === "GET" && matches(segments, ["v1", "messages", ":messageId"])) {
    return adapterQuery("public", "GetMessageStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "messages", ":messageId", "delivery-history"])) {
    return adapterQuery("public", "GetMessageDeliveryHistory", segments[2], "retention_bound");
  }

  if (method === "POST" && matches(segments, ["v1", "messages", ":messageId", "retry"])) {
    return adapterCommand("public", "RetryMessageSend", segments[2], validateOptionalObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "messages", ":messageId", "cancel"])) {
    return adapterCommand("public", "CancelMessage", segments[2], validateOptionalObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "media"])) {
    return adapterCommand("public", "RegisterMedia", undefined, validateMediaRegistrationBody);
  }

  if (method === "GET" && matches(segments, ["v1", "media", ":mediaId"])) {
    return adapterQuery("public", "GetMediaStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "chats"])) {
    return adapterQuery("public", "ListChats", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "chats", ":chatId"])) {
    return adapterQuery("public", "GetChatStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "contacts"])) {
    return adapterQuery("public", "ListContacts", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "contacts", ":contactId"])) {
    return adapterQuery("public", "GetContactStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "labels"])) {
    return adapterQuery("public", "ListLabels", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "labels", ":labelId"])) {
    return adapterQuery("public", "GetLabelStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "groups", ":groupId"])) {
    return adapterQuery("public", "GetGroupStatus", segments[2], "strong_owner");
  }

  if (method === "PATCH" && matches(segments, ["v1", "groups", ":groupId"])) {
    return adapterCommand("public", "UpdateGroupMetadata", segments[2], validateGroupMetadataBody);
  }

  if (method === "PATCH" && matches(segments, ["v1", "groups", ":groupId", "local-state"])) {
    return adapterCommand(
      "public",
      "UpdateGroupLocalState",
      segments[2],
      validateGroupLocalStateBody,
    );
  }

  if (method === "GET" && matches(segments, ["v1", "groups", ":groupId", "members"])) {
    return adapterQuery("public", "ListGroupMembers", segments[2], "eventual_projection");
  }

  if (method === "POST" && matches(segments, ["v1", "groups", ":groupId", "messages", "text"])) {
    return adapterCommand("public", "SendGroupTextMessage", segments[2], validateGroupTextBody);
  }

  if (method === "POST" && matches(segments, ["v1", "groups", ":groupId", "members"])) {
    return adapterCommand("public", "AddGroupMember", segments[2], validateGroupMemberBody);
  }

  if (
    method === "DELETE" &&
    matches(segments, ["v1", "groups", ":groupId", "members", ":memberJid"])
  ) {
    return adapterCommand("public", "RemoveGroupMember", segments[2], validateOptionalObjectBody);
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "groups", ":groupId", "members", ":memberJid", "promote"])
  ) {
    return adapterCommand("public", "PromoteGroupMember", segments[2], validateOptionalObjectBody);
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "groups", ":groupId", "members", ":memberJid", "demote"])
  ) {
    return adapterCommand("public", "DemoteGroupMember", segments[2], validateOptionalObjectBody);
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "groups", ":groupId", "invite-link", "refresh"])
  ) {
    return adapterCommand(
      "public",
      "RefreshGroupInviteLink",
      segments[2],
      validateOptionalObjectBody,
    );
  }

  if (method === "GET" && matches(segments, ["v1", "jobs"])) {
    return adapterQuery("monitoring", "ListWorkerJobs", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "jobs", ":jobId"])) {
    return adapterQuery("monitoring", "GetWorkerJobStatus", segments[2], "strong_owner");
  }

  if (method === "GET" && matches(segments, ["v1", "queue"])) {
    return adapterQuery("monitoring", "GetQueueMetricsSnapshot", undefined, "eventual_projection");
  }

  if (method === "GET" && matches(segments, ["v1", "webhooks"])) {
    return adapterQuery("public", "ListWebhookSubscriptions", undefined, "eventual_projection");
  }

  if (method === "POST" && matches(segments, ["v1", "webhooks"])) {
    return adapterCommand("public", "RegisterWebhookSubscription", undefined, validateWebhookBody);
  }

  if (method === "GET" && matches(segments, ["v1", "webhooks", ":webhookId"])) {
    return adapterQuery("public", "GetWebhookStatus", segments[2], "strong_owner");
  }

  if (method === "PATCH" && matches(segments, ["v1", "webhooks", ":webhookId"])) {
    return adapterCommand("public", "UpdateWebhookSubscription", segments[2], validateObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "webhooks", ":webhookId", "activate"])) {
    return adapterCommand(
      "public",
      "ActivateWebhookSubscription",
      segments[2],
      validateOptionalObjectBody,
    );
  }

  if (method === "POST" && matches(segments, ["v1", "webhooks", ":webhookId", "suspend"])) {
    return adapterCommand(
      "public",
      "SuspendWebhookSubscription",
      segments[2],
      validateOptionalObjectBody,
    );
  }

  if (method === "DELETE" && matches(segments, ["v1", "webhooks", ":webhookId"])) {
    return adapterCommand(
      "public",
      "RetireWebhookSubscription",
      segments[2],
      validateOptionalObjectBody,
    );
  }

  if (method === "GET" && matches(segments, ["v1", "webhook-deliveries"])) {
    return adapterQuery("public", "ListWebhookDeliveries", undefined, "retention_bound");
  }

  if (
    method === "GET" &&
    matches(segments, ["v1", "webhook-deliveries", ":deliveryId", "history"])
  ) {
    return adapterQuery("public", "GetWebhookDeliveryHistory", segments[2], "retention_bound");
  }

  if (
    method === "POST" &&
    matches(segments, ["v1", "webhook-deliveries", ":deliveryId", "retry"])
  ) {
    return adapterCommand(
      "public",
      "RetryWebhookDelivery",
      segments[2],
      validateOptionalObjectBody,
    );
  }

  if (method === "GET" && matches(segments, ["v1", "provider", "capabilities"])) {
    return adapterQuery("admin", "GetProviderCapabilityStatus", undefined, "strong_owner");
  }

  if (method === "POST" && matches(segments, ["v1", "provider", "capabilities", "refresh"])) {
    return partialRoute(
      "provider_refresh_public_route_not_available",
      "Provider capability refresh is currently scheduler-owned in the Application catalog and is not exposed through the public API boundary.",
    );
  }

  if (method === "GET" && matches(segments, ["v1", "settings"])) {
    return adapterQuery("admin", "GetConfigurationStatus", undefined, "strong_owner");
  }

  if (method === "POST" && matches(segments, ["v1", "settings", "validate"])) {
    return adapterCommand("admin", "ValidateConfigurationSnapshot", undefined, validateObjectBody);
  }

  if (method === "POST" && matches(segments, ["v1", "settings", "activate"])) {
    return adapterCommand("admin", "ActivateConfigurationSnapshot", undefined, validateObjectBody);
  }

  if (method === "GET" && matches(segments, ["v1", "audit-records"])) {
    return adapterQuery("admin", "QueryAuditRecords", undefined, "retention_bound");
  }

  return undefined;
}

function adapterCommand(
  boundary: ApiBoundary,
  name: ApiCommandRequest["name"],
  targetRef: string | undefined,
  validateBody: (body: unknown) => HttpFailure | undefined,
): Readonly<{
  build(context: RouteContext, body: unknown): RouteMatch;
  bodyValidation: BodyValidation;
}> {
  return {
    bodyValidation: {
      required: true,
      validate: validateBody,
    },
    build: (context) => ({
      kind: "adapter",
      request: createCommandRequest(boundary, name, targetRef, context),
      responseContract: createOperationResponseContract(name, targetRef),
    }),
  };
}

function adapterQuery(
  boundary: ApiBoundary,
  name: ApiQueryRequest["name"],
  targetRef: string | undefined,
  requestedConsistency: ApiQueryRequest["requestedConsistency"],
): Readonly<{
  build(context: RouteContext, body: unknown): RouteMatch;
}> {
  return {
    build: (context) => {
      const responseContract = createQueryResponseContract(name, targetRef, context.searchParams);

      if (!responseContract.ok) {
        return {
          kind: "partial",
          failure: responseContract.failure,
        };
      }

      return {
        kind: "adapter",
        request: createQueryRequest(
          boundary,
          name,
          targetRef,
          requestedConsistency,
          context,
          responseContract.value.shape === "collection"
            ? responseContract.value.queryOptions
            : undefined,
        ),
        responseContract: responseContract.value,
      };
    },
  };
}

function partialRoute(
  code: string,
  message: string,
): Readonly<{
  build(context: RouteContext, body: unknown): RouteMatch;
}> {
  return {
    build: () => ({
      kind: "partial",
      failure: {
        category: "not_implemented",
        code,
        message,
        statusCode: 501,
      },
    }),
  };
}

function sendMessageRoute(targetRef: string | undefined): Readonly<{
  build(context: RouteContext, body: unknown): RouteMatch;
  bodyValidation: BodyValidation;
}> {
  return {
    bodyValidation: {
      required: true,
      validate: validateSendMessageBody,
    },
    build: (context, body) => ({
      kind: "adapter",
      request: createCommandRequest("public", getSendMessageCommandName(body), targetRef, context),
      responseContract: createOperationResponseContract(getSendMessageCommandName(body), targetRef),
    }),
  };
}

function createCommandRequest(
  boundary: ApiBoundary,
  name: string,
  targetRef: string | undefined,
  context: RouteContext,
): ApiCommandRequest {
  return Object.freeze({
    kind: "command",
    boundary,
    name,
    requestRef: context.requestRef,
    credential: context.credential,
    requestId: context.requestId,
    correlationId: context.correlationId,
    safeInputRef: `http:${name}:${context.requestRef}`,
    dataClassification: "confidential",
    ...optional("targetRef", targetRef),
    ...optional("traceId", context.traceId),
    ...optional("idempotencyKey", context.idempotencyKey),
  });
}

async function storeOutboundIntentForAdapterRequest(
  match: Extract<RouteMatch, { kind: "adapter" }>,
  body: unknown,
  context: RouteContext,
  outboundMessageIntentStore: OutboundMessageIntentStorePort | undefined,
): Promise<HttpFailure | undefined> {
  if (
    outboundMessageIntentStore === undefined ||
    match.request.kind !== "command" ||
    match.request.name !== "SendTextMessage"
  ) {
    return undefined;
  }

  if (!isPlainObject(body) || typeof body.to !== "string" || typeof body.text !== "string") {
    return validation("invalid_body", "Send text request body must contain safe text input.");
  }

  if (match.request.safeInputRef === undefined) {
    return {
      category: "internal",
      code: "outbound_intent_ref_missing",
      message: "Send text request could not be mapped to a safe outbound intent reference.",
      statusCode: 500,
    };
  }

  try {
    const outboundIntentRef = createOutboundMessageIntentRef(match.request.safeInputRef);
    const result = await outboundMessageIntentStore.storeTextIntent(
      {
        outboundIntentRef,
        recipientRef: body.to,
        text: body.text,
      },
      createHttpApplicationPortContext(match.request, context),
    );

    if (!result.ok) {
      return {
        category: result.error.category === "unsafe_payload" ? "validation" : "infrastructure",
        code: result.error.code,
        message: "Outbound message intent could not be accepted.",
        statusCode: result.error.category === "unsafe_payload" ? 400 : 503,
        details: {
          retryable: result.error.retryable,
        },
      };
    }

    return undefined;
  } catch {
    return {
      category: "validation",
      code: "outbound_intent_ref_invalid",
      message: "Send text request could not be mapped to a safe outbound intent reference.",
      statusCode: 400,
    };
  }
}

function createHttpApplicationPortContext(
  request: ApiCommandRequest,
  context: RouteContext,
): ApplicationPortContext {
  return {
    requestContext: createRequestContext({
      requestId: createRequestId(request.requestId ?? context.requestId),
      correlationId: createCorrelationId(request.correlationId ?? context.correlationId),
      ...optional(
        "traceId",
        request.traceId === undefined ? undefined : createTraceId(request.traceId),
      ),
    }),
    actorRef: `api_key:${context.credential.keyId}`,
    ...optional("idempotencyKey", request.idempotencyKey),
    ...optional("dataClassification", request.dataClassification),
  };
}

function createQueryRequest(
  boundary: ApiBoundary,
  name: string,
  targetRef: string | undefined,
  requestedConsistency: ApiQueryRequest["requestedConsistency"],
  context: RouteContext,
  queryOptions?: PublicCollectionQueryOptions,
): ApiQueryRequest {
  return Object.freeze({
    kind: "query",
    boundary,
    name,
    requestRef: context.requestRef,
    credential: context.credential,
    requestId: context.requestId,
    correlationId: context.correlationId,
    requestedConsistency,
    safeCriteriaRef: createSafeCriteriaRef(name, targetRef, queryOptions),
    dataClassification: "internal",
    ...optional("targetRef", targetRef),
    ...optional("traceId", context.traceId),
  });
}

function createOperationResponseContract(
  name: string,
  targetRef: string | undefined,
): PublicResponseContract {
  return Object.freeze({
    shape: "operation",
    resourceType: resourceTypeForOperation(name),
    ...optional("resourceId", targetRef),
  });
}

function createQueryResponseContract(
  name: string,
  targetRef: string | undefined,
  searchParams: URLSearchParams,
): { ok: true; value: PublicResponseContract } | { ok: false; failure: HttpFailure } {
  const resourceType = resourceTypeForQuery(name);

  if (!isCollectionQuery(name)) {
    return {
      ok: true,
      value: Object.freeze({
        shape: "resource",
        resourceType,
        ...optional("resourceId", targetRef),
      }),
    };
  }

  const queryOptions = normalizeCollectionQueryOptions(name, searchParams);

  if (!queryOptions.ok) {
    return queryOptions;
  }

  return {
    ok: true,
    value: Object.freeze({
      shape: "collection",
      resourceType,
      queryOptions: queryOptions.value,
    }),
  };
}

function normalizeCollectionQueryOptions(
  queryName: string,
  searchParams: URLSearchParams,
): { ok: true; value: PublicCollectionQueryOptions } | { ok: false; failure: HttpFailure } {
  const filters: Record<string, string> = {};
  let cursor: string | undefined;
  let limit = defaultCollectionLimit;
  let sort: string | undefined;
  let search: string | undefined;
  const allowedFilters = allowedFilterFieldsForQuery(queryName);

  for (const [key, value] of searchParams.entries()) {
    if (key === "cursor") {
      const cursorFailure = validateSafeQueryValue(value, "cursor", 256);

      if (cursorFailure !== undefined) {
        return { ok: false, failure: cursorFailure };
      }

      cursor = value;
      continue;
    }

    if (key === "limit") {
      const parsedLimit = parseLimit(value);

      if (!parsedLimit.ok) {
        return parsedLimit;
      }

      limit = Math.min(parsedLimit.value, maxCollectionLimit);
      continue;
    }

    if (key === "sort") {
      const sortFailure = validateSortExpression(queryName, value);

      if (sortFailure !== undefined) {
        return { ok: false, failure: sortFailure };
      }

      sort = value;
      continue;
    }

    if (key === "search") {
      const searchFailure = validateSafeQueryValue(value, "search", 100);

      if (searchFailure !== undefined) {
        return { ok: false, failure: searchFailure };
      }

      search = value;
      continue;
    }

    if (!allowedFilters.includes(key)) {
      return {
        ok: false,
        failure: validation(
          "unsupported_filter",
          `Query parameter '${key}' is not supported for this collection resource.`,
        ),
      };
    }

    const filterFailure = validateSafeQueryValue(value, key, 120);

    if (filterFailure !== undefined) {
      return { ok: false, failure: filterFailure };
    }

    filters[key] = value;
  }

  const cursorContext = createCollectionCursorContext({
    queryName,
    limit,
    filters,
    sort,
    search,
  });
  const cursorOffset = cursor === undefined ? 0 : decodeCollectionCursor(cursor, cursorContext);

  if (cursorOffset === undefined) {
    return {
      ok: false,
      failure: validation(
        "invalid_cursor",
        "Query parameter 'cursor' is invalid for this collection query.",
      ),
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      limit,
      cursorOffset,
      cursorContext,
      filters: Object.freeze(filters),
      ...optional("cursor", cursor),
      ...optional("sort", sort),
      ...optional("search", search),
    }),
  };
}

function createSafeCriteriaRef(
  name: string,
  targetRef: string | undefined,
  queryOptions: PublicCollectionQueryOptions | undefined,
): string {
  const base = targetRef === undefined ? `http:${name}` : `http:${name}:${targetRef}`;

  if (queryOptions === undefined) {
    return base;
  }

  const parts = [`limit=${queryOptions.limit}`];

  if (queryOptions.cursor !== undefined) {
    parts.push(`cursor=${queryOptions.cursor}`);
  }

  if (queryOptions.sort !== undefined) {
    parts.push(`sort=${queryOptions.sort}`);
  }

  if (queryOptions.search !== undefined) {
    parts.push(`search=${queryOptions.search}`);
  }

  for (const [key, value] of Object.entries(queryOptions.filters).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    parts.push(`${key}=${value}`);
  }

  return `${base}:${parts.join(";")}`;
}

function createCollectionCursorContext(input: {
  queryName: string;
  limit: number;
  filters: Readonly<Record<string, string>>;
  sort: string | undefined;
  search: string | undefined;
}): string {
  const parts = [`query=${input.queryName}`, `limit=${input.limit}`];

  if (input.sort !== undefined) {
    parts.push(`sort=${input.sort}`);
  }

  if (input.search !== undefined) {
    parts.push(`search=${input.search}`);
  }

  for (const [key, value] of Object.entries(input.filters).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    parts.push(`filter:${key}=${value}`);
  }

  return parts.join("|");
}

const collectionCursorPrefix = "omniwa_cursor_v1";

function encodeCollectionCursor(offset: number, context: string): string {
  const digest = createHash("sha256").update(context).digest("hex").slice(0, 16);

  return `${collectionCursorPrefix}:${offset}:${digest}`;
}

function decodeCollectionCursor(cursor: string, expectedContext: string): number | undefined {
  const [prefix, rawOffset, digest, ...extraParts] = cursor.split(":");

  if (
    prefix !== collectionCursorPrefix ||
    rawOffset === undefined ||
    digest === undefined ||
    extraParts.length > 0
  ) {
    return undefined;
  }

  const parsedOffset = Number.parseInt(rawOffset, 10);

  if (!/^\d+$/u.test(rawOffset) || !Number.isSafeInteger(parsedOffset)) {
    return undefined;
  }

  const expectedDigest = createHash("sha256").update(expectedContext).digest("hex").slice(0, 16);

  return digest === expectedDigest ? parsedOffset : undefined;
}

const defaultCollectionLimit = 50;
const maxCollectionLimit = 200;

const collectionQueryNames = new Set([
  "ListInstances",
  "ListInstanceSessions",
  "ListInstanceMessages",
  "ListChats",
  "ListInstanceChats",
  "ListContacts",
  "ListInstanceContacts",
  "ListLabels",
  "ListInstanceLabels",
  "ListInstanceGroups",
  "ListGroupMembers",
  "ListEvents",
  "ListWorkerJobs",
  "ListWebhookSubscriptions",
  "ListWebhookDeliveries",
  "QueryAuditRecords",
]);

const allowedSortFieldsByQueryName: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ListInstances: ["id", "status", "createdAt", "updatedAt", "displayName"],
  ListInstanceSessions: ["id", "status", "createdAt", "updatedAt"],
  ListInstanceMessages: ["id", "status", "type", "direction", "createdAt", "updatedAt"],
  ListChats: ["id", "status", "updatedAt", "displayName"],
  ListInstanceChats: ["id", "status", "updatedAt", "displayName"],
  ListContacts: ["id", "status", "updatedAt", "displayName"],
  ListInstanceContacts: ["id", "status", "updatedAt", "displayName"],
  ListLabels: ["id", "status", "updatedAt", "name"],
  ListInstanceLabels: ["id", "status", "updatedAt", "name"],
  ListInstanceGroups: ["id", "status", "updatedAt", "subject"],
  ListGroupMembers: ["jid", "role", "joinedAt"],
  ListEvents: ["timestamp", "type", "source"],
  ListWorkerJobs: ["id", "status", "workType", "createdAt", "updatedAt"],
  ListWebhookSubscriptions: ["id", "status", "updatedAt"],
  ListWebhookDeliveries: ["id", "status", "createdAt", "updatedAt"],
  QueryAuditRecords: ["id", "status", "category", "createdAt"],
});

const allowedFilterFieldsByQueryName: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ListInstances: ["status"],
  ListInstanceSessions: ["status"],
  ListInstanceMessages: ["status", "type", "direction"],
  ListChats: ["status", "labelId"],
  ListInstanceChats: ["status", "labelId"],
  ListContacts: ["status"],
  ListInstanceContacts: ["status"],
  ListLabels: ["status"],
  ListInstanceLabels: ["status"],
  ListInstanceGroups: ["status"],
  ListGroupMembers: ["role", "status"],
  ListEvents: ["type", "source", "resourceRef"],
  ListWorkerJobs: ["status", "workType", "ownerContext"],
  ListWebhookSubscriptions: ["status"],
  ListWebhookDeliveries: ["status", "webhookId"],
  QueryAuditRecords: ["category", "status"],
});

function isCollectionQuery(name: string): boolean {
  return collectionQueryNames.has(name);
}

function allowedFilterFieldsForQuery(queryName: string): readonly string[] {
  return allowedFilterFieldsByQueryName[queryName] ?? [];
}

function validateSortExpression(queryName: string, value: string): HttpFailure | undefined {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 80) {
    return validation("invalid_sort", "Query parameter 'sort' must be a non-empty safe value.");
  }

  const field = trimmed.startsWith("-") ? trimmed.slice(1) : trimmed;
  const allowedFields = allowedSortFieldsByQueryName[queryName] ?? [];

  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(field) || !allowedFields.includes(field)) {
    return validation(
      "unsupported_sort",
      "Query parameter 'sort' is not supported for this collection resource.",
    );
  }

  return undefined;
}

function validateSafeQueryValue(
  value: string,
  label: string,
  maxLength: number,
): HttpFailure | undefined {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > maxLength || hasControlCharacter(trimmed)) {
    return validation("invalid_query_parameter", `Query parameter '${label}' is invalid.`);
  }

  if (!/^[A-Za-z0-9_.:@/ -]+$/u.test(trimmed)) {
    return validation("invalid_query_parameter", `Query parameter '${label}' is invalid.`);
  }

  return undefined;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint <= 0x1f;
  });
}

function parseLimit(
  value: string,
): { ok: true; value: number } | { ok: false; failure: HttpFailure } {
  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);

  if (!/^\d+$/u.test(trimmed) || !Number.isSafeInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      failure: validation("invalid_limit", "Query parameter 'limit' must be a positive integer."),
    };
  }

  return { ok: true, value: parsed };
}

function resourceTypeForOperation(name: string): string {
  if (name.includes("WebhookDelivery")) return "webhookDelivery";
  if (name.includes("Webhook")) return "webhook";
  if (name.includes("GroupMember")) return "groupMember";
  if (name.includes("Group")) return "group";
  if (name.includes("Message")) return "message";
  if (name.includes("Media")) return "media";
  if (name.includes("Instance") || name.includes("Qr")) return "instance";
  if (name.includes("Configuration")) return "settings";
  if (name.includes("Provider")) return "provider";
  return "operation";
}

function resourceTypeForQuery(name: string): string {
  if (name.includes("WebhookDelivery")) return "webhookDelivery";
  if (name.includes("Webhook")) return "webhook";
  if (name.includes("WorkerJob")) return "job";
  if (name.includes("GroupMember")) return "groupMember";
  if (name.includes("Instance")) return "instance";
  if (name.includes("Session")) return "session";
  if (name.includes("Message")) return "message";
  if (name.includes("Media")) return "media";
  if (name.includes("Chat")) return "chat";
  if (name.includes("Contact")) return "contact";
  if (name.includes("Label")) return "label";
  if (name.includes("Group")) return "group";
  if (name.includes("Events")) return "event";
  if (name.includes("Audit")) return "auditRecord";
  if (name.includes("Dashboard")) return "dashboard";
  if (name.includes("Metrics") || name.includes("Queue")) return "metrics";
  if (name.includes("Health") || name.includes("ActionRequired")) return "health";
  if (name.includes("Configuration")) return "settings";
  if (name.includes("Provider")) return "provider";
  return "resource";
}

function checkRateLimit(
  credential: ApiCredential,
  method: string,
  url: string,
  instanceRef: string | undefined,
  targetRef: string | undefined,
  rateLimiter: ApiRateLimiter | undefined,
): Readonly<{
  failure?: HttpFailure;
  endpointClass?: ApiRateLimitEndpointClass;
  bucketKey?: string;
}> {
  if (rateLimiter === undefined) {
    return Object.freeze({});
  }

  const endpointClass = classifyRateLimitEndpoint(method, url);
  const decision = rateLimiter.check({
    credential,
    method,
    url,
    endpointClass,
    ...optional("instanceRef", instanceRef),
    ...optional("targetRef", targetRef),
  });

  if (decision.allowed) {
    return Object.freeze({
      endpointClass,
      bucketKey: decision.bucketKey,
    });
  }

  const failure: HttpFailure = {
    category: "rate_limit",
    code: "rate_limit_exceeded",
    message: "API rate limit exceeded.",
    statusCode: 429,
    details: Object.freeze({
      endpointClass,
      limit: decision.limit,
      remaining: decision.remaining,
      resetAtEpochMilliseconds: decision.resetAtEpochMilliseconds,
      retryAfterMilliseconds: decision.retryAfterMilliseconds,
    }),
  };

  return Object.freeze({
    endpointClass,
    bucketKey: decision.bucketKey,
    failure,
  });
}

async function checkResourceOwnership(
  request: ApiRequest,
  resolver: ApiResourceOwnershipResolver | undefined,
): Promise<
  Readonly<{
    decision?: ApiResourceOwnershipDecision;
    failure?: HttpFailure;
  }>
> {
  const resourceType = inferApiResourceOwnershipResourceType(request.name, request.targetRef);

  if (request.credential === undefined) {
    return Object.freeze({
      failure: {
        category: "authentication",
        code: "missing_credential",
        message: "API request is missing authentication.",
        statusCode: 401,
      },
    });
  }

  const decision = await authorizeApiResourceOwnership({
    credential: request.credential,
    resourceType,
    operationRef: request.name,
    ...optional("targetRef", request.targetRef),
    ...optional("resolver", resolver),
  });

  if (decision.allowed) {
    return Object.freeze({ decision });
  }

  return Object.freeze({
    decision,
    failure: {
      category: "authorization",
      code: decision.code,
      message: decision.message,
      statusCode: 403,
    },
  });
}

async function recordAdapterSecurityAudit(
  sink: ApiSecurityAuditSink | undefined,
  response: ApiResponse,
  request: ApiRequest,
  context: Readonly<{
    requestId: string;
    correlationId: string;
    timestamp: string;
    method: string;
    url: string;
  }>,
): Promise<void> {
  if (
    response.ok ||
    (response.error.category !== "authentication" && response.error.category !== "authorization")
  ) {
    return;
  }

  await recordSecurityAudit(sink, {
    eventType:
      response.error.category === "authentication"
        ? "authentication_denied"
        : "authorization_denied",
    requestId: context.requestId,
    correlationId: context.correlationId,
    timestamp: context.timestamp,
    method: context.method,
    url: context.url,
    code: response.error.code,
    statusCode: statusCodeForApiError(response.error.category),
    ...optional("keyId", request.credential?.keyId),
    ...optional("credentialKind", request.credential?.kind),
    operationRef: request.name,
    ...optional("targetRef", request.targetRef),
    resourceType: inferApiResourceOwnershipResourceType(request.name, request.targetRef),
  });
}

async function recordSecurityAudit(
  sink: ApiSecurityAuditSink | undefined,
  event: Omit<Parameters<ApiSecurityAuditSink["record"]>[0], "path"> & Readonly<{ url: string }>,
): Promise<void> {
  if (sink === undefined) {
    return;
  }

  const { url, ...eventWithoutUrl } = event;

  try {
    await sink.record(
      Object.freeze({
        ...eventWithoutUrl,
        path: safeAuditPath(url),
      }),
    );
  } catch {
    return;
  }
}

function safeAuditPath(url: string): string {
  return parseUrl(url)?.pathname ?? "/";
}

function mapAdapterResponse(
  response: ApiResponse,
  timestamp: string,
  request: ApiRequest,
  contract: PublicResponseContract,
): ApiHttpResponse {
  const meta = createMeta(response.meta.requestId, response.meta.correlationId, timestamp);

  if (!response.ok) {
    return createErrorHttpResponse(
      {
        category: response.error.category,
        code: response.error.code,
        message: response.error.message,
        statusCode: statusCodeForApiError(response.error.category),
        details: Object.freeze({
          category: response.error.category,
          retryable: response.error.retryable,
        }),
      },
      meta,
    );
  }

  if (contract.shape === "collection") {
    const queryMeta = publicQueryMeta(response.data, contract.resourceType);
    const collectionPage = publicCollectionPage(
      response.data,
      contract.resourceType,
      contract.queryOptions,
      encodeCollectionCursor,
    );
    const collectionMeta = Object.freeze({
      ...meta,
      query: queryMeta,
      pagination: paginationMetaFromOptions(contract.queryOptions, collectionPage),
    });

    return Object.freeze({
      statusCode: statusCodeForApiSuccess(response),
      headers: createJsonHeaders(meta),
      body: Object.freeze({
        data: collectionPage.items,
        meta: collectionMeta,
      }),
    });
  }

  return Object.freeze({
    statusCode: statusCodeForApiSuccess(response),
    headers: createJsonHeaders(meta),
    body: Object.freeze({
      data:
        contract.shape === "operation"
          ? publicOperationData(response.data, request, contract)
          : publicQueryData(response.data, contract),
      meta,
    }),
  });
}

function publicOperationData(
  data: unknown,
  request: ApiRequest,
  contract: Extract<PublicResponseContract, { shape: "operation" }>,
): Readonly<Record<string, unknown>> {
  const record = asRecord(data);

  return Object.freeze({
    resourceType: contract.resourceType,
    ...optional("resourceId", contract.resourceId),
    operationStatus: safeString(record.outcome, "completed"),
    accepted: typeof record.accepted === "boolean" ? record.accepted : true,
    retryable: typeof record.retryable === "boolean" ? record.retryable : false,
    async:
      request.kind === "command" ? isAsyncHttpStatusCandidate(safeString(record.outcome)) : false,
    ...optional("resultRef", safeOptionalString(record.resultRef)),
    ...optional("reasonCode", safeOptionalString(record.reasonCode)),
  });
}

function publicQueryData(
  data: unknown,
  contract: Extract<PublicResponseContract, { shape: "resource" }>,
): Readonly<Record<string, unknown>> {
  const queryMeta = publicQueryMeta(data, contract.resourceType);
  const resourceData = publicResourceData(
    contract.resourceType,
    queryResourceData(data),
    contract.resourceId,
  );

  return Object.freeze({
    ...queryMeta,
    ...resourceData,
    ...optional("resourceId", contract.resourceId),
  });
}

function queryResourceData(data: unknown): unknown {
  const record = asRecord(data);

  return isPlainObject(record.resource) ? record.resource : data;
}

function publicQueryMeta(data: unknown, resourceType: string): PublicQueryMeta {
  const record = asRecord(data);

  return Object.freeze({
    resourceType,
    readStatus: safeString(record.outcome, "result"),
    ...optional("consistency", safeOptionalString(record.consistency)),
    ...optional(
      "freshness",
      isPlainObject(record.freshness) ? Object.freeze(record.freshness) : undefined,
    ),
    ...optional("resultRef", safeOptionalString(record.resultRef)),
    ...optional("reasonCode", safeOptionalString(record.reasonCode)),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

function safeString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function safeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isAsyncHttpStatusCandidate(outcome: string): boolean {
  return outcome === "accepted" || outcome === "queued";
}

function statusCodeForApiSuccess(response: Extract<ApiResponse, { ok: true }>): number {
  if (response.status === "accepted" || response.status === "queued" || response.meta.async) {
    return 202;
  }

  if (response.status === "failed" || response.status === "unavailable") {
    return 503;
  }

  return 200;
}

function statusCodeForApiError(category: string): number {
  switch (category) {
    case "authentication":
      return 401;
    case "authorization":
      return 403;
    case "validation":
      return 400;
    case "conflict":
      return 409;
    case "business":
      return 422;
    case "infrastructure":
      return 503;
    case "internal":
    default:
      return 500;
  }
}

async function handleIncomingRequest(
  request: IncomingMessage,
  options: ApiHttpServerOptions,
): Promise<ApiHttpResponse> {
  const now = options.now ?? (() => new Date());
  const headers = normalizeIncomingHeaders(request);
  const requestRef = options.requestRefGenerator?.() ?? `http:${randomUUID()}`;
  const requestId = getHeader(headers, "x-request-id") ?? requestRef;
  const correlationId = getHeader(headers, "x-correlation-id") ?? `corr:${requestId}`;
  const meta = createMeta(requestId, correlationId, now().toISOString());

  let apiRequest: ApiHttpRequest;

  try {
    apiRequest = await readIncomingRequest(request);
  } catch {
    return createErrorHttpResponse(
      validation("invalid_json_body", "Request body must be valid JSON within the size limit."),
      meta,
    );
  }

  return handleApiHttpRequest(apiRequest, {
    ...options,
    requestRefGenerator: () => requestRef,
    now,
  });
}

async function handleIncomingEventStreamRequest(
  request: IncomingMessage,
  options: ApiHttpServerOptions,
): Promise<ApiEventStreamResponse> {
  const now = options.now ?? (() => new Date());
  const headers = normalizeIncomingHeaders(request);
  const requestRef = options.requestRefGenerator?.() ?? `http:${randomUUID()}`;

  return handleApiEventStreamRequest(
    {
      method: request.method ?? "GET",
      url: request.url ?? "/",
      headers,
    },
    {
      ...options,
      requestRefGenerator: () => requestRef,
      now,
    },
  );
}

function createErrorHttpResponse(error: HttpFailure, meta: HttpResponseMeta): ApiHttpResponse {
  return Object.freeze({
    statusCode: error.statusCode,
    headers: createJsonHeaders(meta),
    body: Object.freeze({
      error: Object.freeze({
        code: error.code,
        message: error.message,
        details: Object.freeze({
          category: error.category,
          ...(error.details ?? {}),
        }),
      }),
      meta,
    }),
  });
}

function createMeta(requestId: string, correlationId: string, timestamp: string): HttpResponseMeta {
  return Object.freeze({
    requestId,
    correlationId,
    timestamp,
  });
}

function createJsonHeaders(meta: HttpResponseMeta): Readonly<Record<string, string>> {
  return Object.freeze({
    "content-type": jsonContentType,
    "x-request-id": meta.requestId,
    "x-correlation-id": meta.correlationId,
  });
}

function createSseHeaders(
  meta: HttpResponseMeta,
  cursorInspection?: Readonly<{ status: string }>,
): Readonly<Record<string, string>> {
  return Object.freeze({
    "content-type": eventStreamContentType,
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": meta.requestId,
    "x-correlation-id": meta.correlationId,
    ...(cursorInspection === undefined
      ? {}
      : { "x-omniwa-cursor-status": cursorInspection.status }),
  });
}

async function readIncomingRequest(request: IncomingMessage): Promise<ApiHttpRequest> {
  const body = await readJsonBody(request);

  return Object.freeze({
    method: request.method ?? "GET",
    url: request.url ?? "/",
    headers: normalizeIncomingHeaders(request),
    ...optional("body", body),
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;

    if (totalBytes > maxRequestBodyBytes) {
      throw new Error("Request body is too large.");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (rawBody.length === 0) {
    return undefined;
  }

  return JSON.parse(rawBody) as unknown;
}

function writeHttpResponse(response: ServerResponse, apiResponse: ApiHttpResponse): void {
  response.writeHead(apiResponse.statusCode, apiResponse.headers);
  response.end(JSON.stringify(apiResponse.body));
}

function writeEventStreamResponse(
  response: ServerResponse,
  apiResponse: ApiEventStreamResponse,
): void {
  response.writeHead(apiResponse.statusCode, apiResponse.headers);

  if (typeof apiResponse.body === "string") {
    response.end(apiResponse.body);
    return;
  }

  response.end(JSON.stringify(apiResponse.body));
}

function normalizeIncomingHeaders(
  request: IncomingMessage,
): Readonly<Record<string, string | undefined>> {
  const normalized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(request.headers)) {
    normalized[key] = Array.isArray(value) ? value.join(",") : value;
  }

  return Object.freeze(normalized);
}

function isEventStreamIncomingRequest(request: IncomingMessage): boolean {
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    return false;
  }

  const parsedUrl = parseUrl(request.url ?? "/");
  const segments = parsedUrl === undefined ? undefined : splitPath(parsedUrl.pathname);

  return segments !== undefined && matches(segments, ["v1", "events", "stream"]);
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const normalized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = normalizeHeaderValue(value);
  }

  return Object.freeze(normalized);
}

function normalizeHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string" || value === undefined) {
    return value;
  }

  return value.join(",");
}

function getHeader(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function authenticateHeader(
  headers: Readonly<Record<string, string | undefined>>,
  apiKeyVerifier: ApiKeyVerifier | undefined,
  apiKeys: readonly ApiKeyConfig[],
): ApiCredential | undefined {
  const providedKey = getHeader(headers, "x-api-key");

  return (apiKeyVerifier ?? createApiKeyVerifierFromPlaintext(apiKeys)).verify(providedKey);
}

function parseCredentialKind(value: string | undefined): ApiCredentialKind {
  switch (value?.trim()) {
    case "admin_key":
      return "admin_key";
    case "monitoring_key":
      return "monitoring_key";
    case "internal_runtime":
      return "internal_runtime";
    case "api_key":
    default:
      return "api_key";
  }
}

function parseScopes(value: string | undefined): readonly ApiScope[] {
  const scopes = parseCsv(value);

  if (scopes === undefined) {
    return Object.freeze([
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
    ]);
  }

  return Object.freeze(scopes.filter(isApiScope));
}

function isApiScope(value: string): value is ApiScope {
  return [
    "instances:read",
    "instances:write",
    "instances:connect",
    "instances:destroy",
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
    "metrics:read",
    "config:read",
    "config:write",
    "audit:read",
    "provider:read",
    "provider:refresh",
    "jobs:read",
    "admin:*",
    "internal:runtime",
  ].includes(value);
}

function parseCsv(value: string | undefined): readonly string[] | undefined {
  const items = value
    ?.split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items === undefined || items.length === 0 ? undefined : Object.freeze(items);
}

function splitPath(pathname: string): readonly string[] | undefined {
  const trimmed = pathname.replace(/^\/+|\/+$/gu, "");

  if (trimmed.length === 0) {
    return [];
  }

  try {
    return Object.freeze(trimmed.split("/").map((segment) => decodeURIComponent(segment)));
  } catch {
    return undefined;
  }
}

function parseUrl(urlInput: string): URL | undefined {
  try {
    return new URL(urlInput, "http://omniwa.local");
  } catch {
    return undefined;
  }
}

function matches(actual: readonly string[], pattern: readonly string[]): boolean {
  if (actual.length !== pattern.length) {
    return false;
  }

  return pattern.every((segment, index) => {
    const actualSegment = actual[index];

    if (actualSegment === undefined) {
      return false;
    }

    return segment.startsWith(":") ? isSafePathSegment(actualSegment) : actualSegment === segment;
  });
}

function isSafePathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/u.test(value);
}

function validateObjectBody(body: unknown): HttpFailure | undefined {
  if (isPlainObject(body)) {
    return undefined;
  }

  return validation("invalid_body", "Request body must be a JSON object.");
}

function validateOptionalObjectBody(body: unknown): HttpFailure | undefined {
  return body === undefined ? undefined : validateObjectBody(body);
}

function validateCreateInstanceBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return optionalStringField(body, "displayName");
}

function validateSendMessageBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  const type = body.type;

  if (type === "text") {
    return validateSendTextBody(body);
  }

  if (
    type === "media" ||
    type === "image" ||
    type === "video" ||
    type === "document" ||
    type === "audio"
  ) {
    return validateSendMediaBody(body);
  }

  return validation(
    "unsupported_message_type",
    "Request body field 'type' must be text, media, image, video, document, or audio.",
  );
}

function getSendMessageCommandName(body: unknown): "SendTextMessage" | "SendMediaMessage" {
  if (isPlainObject(body) && body.type === "text") {
    return "SendTextMessage";
  }

  return "SendMediaMessage";
}

function validateSendTextBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return requiredStringField(body, "to") ?? requiredStringField(body, "text");
}

function validateSendMediaBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return (
    requiredStringField(body, "to") ??
    (typeof body.mediaId === "string" || typeof body.mediaRef === "string"
      ? undefined
      : validation("invalid_body", "Request body requires mediaId or mediaRef."))
  );
}

function validateGroupTextBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return requiredStringField(body, "text");
}

function validateGroupMemberBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return requiredStringField(body, "jid");
}

function validateGroupMetadataBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  const subjectFailure = optionalStringField(body, "subject");
  if (subjectFailure !== undefined) return subjectFailure;

  const descriptionFailure = optionalStringField(body, "description");
  if (descriptionFailure !== undefined) return descriptionFailure;

  if (typeof body.subject === "string" || typeof body.description === "string") {
    return undefined;
  }

  return validation("invalid_body", "Request body requires subject or description.");
}

function validateGroupLocalStateBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  if (
    typeof body.muted === "boolean" ||
    typeof body.archived === "boolean" ||
    typeof body.pinned === "boolean"
  ) {
    return undefined;
  }

  return validation("invalid_body", "Request body requires muted, archived, or pinned boolean.");
}

function validateMediaRegistrationBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  if (
    typeof body.mediaRef === "string" ||
    typeof body.url === "string" ||
    typeof body.fileRef === "string"
  ) {
    return undefined;
  }

  return validation("invalid_body", "Request body requires mediaRef, url, or fileRef.");
}

function validateWebhookBody(body: unknown): HttpFailure | undefined {
  const objectFailure = validateObjectBody(body);

  if (objectFailure !== undefined) {
    return objectFailure;
  }

  if (!isPlainObject(body)) {
    return validation("invalid_body", "Request body must be a JSON object.");
  }

  return requiredStringField(body, "url");
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredStringField(
  body: Readonly<Record<string, unknown>>,
  field: string,
): HttpFailure | undefined {
  const value = body[field];

  if (typeof value === "string" && value.trim().length > 0) {
    return undefined;
  }

  return validation("invalid_body", `Request body requires non-empty string field '${field}'.`);
}

function optionalStringField(
  body: Readonly<Record<string, unknown>>,
  field: string,
): HttpFailure | undefined {
  const value = body[field];

  if (value === undefined || (typeof value === "string" && value.trim().length > 0)) {
    return undefined;
  }

  return validation("invalid_body", `Optional field '${field}' must be a non-empty string.`);
}

function validation(code: string, message: string): HttpFailure {
  return {
    category: "validation",
    code,
    message,
    statusCode: 400,
  };
}

function notFound(code: string, message: string): HttpFailure {
  return {
    category: "not_found",
    code,
    message,
    statusCode: 404,
  };
}

function createUnavailableDispatcher(): ApplicationInterfaceDispatcher {
  return {
    executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
      return createApplicationCommandOutcome({
        commandRef: envelope.commandRef,
        outcome: "failed",
        accepted: false,
        retryable: true,
        reasonCode: "dispatcher_not_configured",
      });
    },
    executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
      return createApplicationQueryOutcome({
        queryRef: envelope.queryRef,
        outcome: "unavailable",
        consistency: envelope.requestedConsistency ?? "strong_owner",
        freshness: {
          stale: true,
          refreshedAtEpochMilliseconds: 0,
        },
        reasonCode: "dispatcher_not_configured",
      });
    },
  };
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
