import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
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
  createEmptyRealtimeEventSource,
  encodeServerSentEvents,
  type RealtimeEventSource,
} from "./realtime-event-stream.js";

const apiPrefix = "v1";
const jsonContentType = "application/json; charset=utf-8";
const eventStreamContentType = "text/event-stream; charset=utf-8";
const maxRequestBodyBytes = 1_000_000;
const defaultSseReplayLimit = 100;

export type ApiKeyConfig = Readonly<{
  key: string;
  credential: ApiCredential;
}>;

export type ApiHttpServerOptions = Readonly<{
  dispatcher?: ApplicationInterfaceDispatcher;
  adapter?: ApiInterfaceAdapter;
  apiKeys?: readonly ApiKeyConfig[];
  eventSource?: RealtimeEventSource;
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
  body: SuccessEnvelope | ErrorEnvelope;
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

type HttpFailureCategory =
  | "authentication"
  | "authorization"
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
  const route = matchRoute(request.method, request.url);

  if (route === undefined) {
    return createErrorHttpResponse(
      notFound("route_not_found", "Route is not part of the public API surface."),
      metaBase,
    );
  }

  const credential = authenticateHeader(headers, options.apiKeys ?? readApiKeysFromEnv());

  if (credential === undefined) {
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

  const adapter =
    options.adapter ??
    new ApiInterfaceAdapter({
      dispatcher: options.dispatcher ?? createUnavailableDispatcher(),
    });
  const adapterResponse = await adapter.handle(match.request);

  return mapAdapterResponse(adapterResponse, timestamp);
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

  const credential = authenticateHeader(headers, options.apiKeys ?? readApiKeysFromEnv());

  if (credential === undefined) {
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

  if (!credential.scopes.includes("admin:*") && !credential.scopes.includes("events:read")) {
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
  const events = eventSource.replay({
    ...(cursor === null || cursor === undefined || cursor.trim().length === 0
      ? {}
      : { cursor: cursor.trim() }),
    limit: options.sseReplayLimit ?? defaultSseReplayLimit,
  });

  return Object.freeze({
    statusCode: 200,
    headers: createSseHeaders(metaBase),
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
    build: (context) => ({
      kind: "adapter",
      request: createQueryRequest(boundary, name, targetRef, requestedConsistency, context),
    }),
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

function createQueryRequest(
  boundary: ApiBoundary,
  name: string,
  targetRef: string | undefined,
  requestedConsistency: ApiQueryRequest["requestedConsistency"],
  context: RouteContext,
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
    safeCriteriaRef: targetRef === undefined ? `http:${name}` : `http:${name}:${targetRef}`,
    dataClassification: "internal",
    ...optional("targetRef", targetRef),
    ...optional("traceId", context.traceId),
  });
}

function mapAdapterResponse(response: ApiResponse, timestamp: string): ApiHttpResponse {
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

  return Object.freeze({
    statusCode: statusCodeForApiSuccess(response),
    headers: createJsonHeaders(meta),
    body: Object.freeze({
      data: response.data,
      meta,
    }),
  });
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

function createSseHeaders(meta: HttpResponseMeta): Readonly<Record<string, string>> {
  return Object.freeze({
    "content-type": eventStreamContentType,
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": meta.requestId,
    "x-correlation-id": meta.correlationId,
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
  apiKeys: readonly ApiKeyConfig[],
): ApiCredential | undefined {
  const providedKey = getHeader(headers, "x-api-key");

  if (providedKey === undefined) {
    return undefined;
  }

  return apiKeys.find((apiKey) => apiKey.key === providedKey)?.credential;
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
