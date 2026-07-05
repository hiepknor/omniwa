import {
  createApplicationCommandEnvelope,
  createApplicationQueryEnvelope,
  getApplicationCommandDefinition,
  getApplicationServiceForCommand,
  getQueryBoundaryApplicationService,
  getWorkflowByQuery,
  getWorkflowsByCommand,
  isApplicationCommandName,
  isApplicationQueryName,
  type ApplicationCommandEnvelope,
  type ApplicationCommandEnvelopeInput,
  type ApplicationCommandName,
  type ApplicationCommandOutcome,
  type ApplicationError,
  type ApplicationQueryEnvelope,
  type ApplicationQueryEnvelopeInput,
  type ApplicationQueryName,
  type ApplicationQueryOutcome,
  type ApplicationServiceName,
} from "@omniwa/application";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createTraceId,
  type CorrelationId,
  type RequestContext,
  type RequestId,
  type TraceId,
} from "@omniwa/shared";

export const apiVersion = "v1";

export const apiBoundaries = [
  "public",
  "admin",
  "health",
  "monitoring",
  "internal_runtime",
] as const;

export type ApiBoundary = (typeof apiBoundaries)[number];

export const apiCredentialKinds = [
  "api_key",
  "admin_key",
  "monitoring_key",
  "internal_runtime",
] as const;

export type ApiCredentialKind = (typeof apiCredentialKinds)[number];

export const apiScopes = [
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
  "webhooks:redrive",
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
] as const;

export type ApiScope = (typeof apiScopes)[number];

export type ApiCredential = Readonly<{
  keyId: string;
  kind: ApiCredentialKind;
  scopes: readonly ApiScope[];
  allowedInstanceRefs?: readonly string[];
}>;

export type ApiRequestBase = Readonly<{
  boundary: ApiBoundary;
  requestRef: string;
  credential?: ApiCredential;
  targetRef?: string;
  requestId?: string;
  correlationId?: string;
  traceId?: string;
  dataClassification?: ApplicationCommandEnvelopeInput["dataClassification"];
}>;

export type ApiCommandRequest = ApiRequestBase &
  Readonly<{
    kind: "command";
    name: string;
    idempotencyKey?: string;
    safeInputRef?: string;
  }>;

export type ApiQueryRequest = ApiRequestBase &
  Readonly<{
    kind: "query";
    name: string;
    safeCriteriaRef?: string;
    requestedConsistency?: ApplicationQueryEnvelopeInput["requestedConsistency"];
  }>;

export type ApiRequest = ApiCommandRequest | ApiQueryRequest;

export type ApiRequestIdentity = Readonly<{
  actorRef: string;
  credentialKind: ApiCredentialKind;
  keyId: string;
  scopes: readonly ApiScope[];
  allowedInstanceRefs?: readonly string[];
}>;

export const apiErrorCategories = [
  "validation",
  "authentication",
  "authorization",
  "business",
  "conflict",
  "infrastructure",
  "internal",
] as const;

export type ApiErrorCategory = (typeof apiErrorCategories)[number];

export type ApiError = Readonly<{
  category: ApiErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
}>;

export type ApiResponseMeta = Readonly<{
  apiVersion: typeof apiVersion;
  requestRef: string;
  requestId: RequestId;
  correlationId: CorrelationId;
  traceId?: TraceId;
  boundary: ApiBoundary;
  actorRef?: string;
  applicationService?: ApplicationServiceName;
  workflowRefs?: readonly string[];
  commandRef?: string;
  queryRef?: string;
  async: boolean;
}>;

export type ApiSuccessResponse<TData> = Readonly<{
  ok: true;
  status: string;
  data: TData;
  meta: ApiResponseMeta;
}>;

export type ApiErrorResponse = Readonly<{
  ok: false;
  error: ApiError;
  meta: ApiResponseMeta;
}>;

export type ApiResponse<TData = ApplicationCommandOutcome | ApplicationQueryOutcome> =
  ApiSuccessResponse<TData> | ApiErrorResponse;

export type ApplicationInterfaceDispatcher = Readonly<{
  executeCommand(
    envelope: ApplicationCommandEnvelope,
  ): Promise<ApplicationCommandOutcome> | ApplicationCommandOutcome;
  executeQuery(
    envelope: ApplicationQueryEnvelope,
  ): Promise<ApplicationQueryOutcome> | ApplicationQueryOutcome;
}>;

export type ApiInterfaceAdapterOptions = Readonly<{
  dispatcher: ApplicationInterfaceDispatcher;
}>;

export class ApiInterfaceAdapter {
  private readonly dispatcher: ApplicationInterfaceDispatcher;

  constructor(options: ApiInterfaceAdapterOptions) {
    this.dispatcher = options.dispatcher;
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    if (request.kind === "command") {
      return this.handleCommand(request);
    }

    return this.handleQuery(request);
  }

  private async handleCommand(
    request: ApiCommandRequest,
  ): Promise<ApiResponse<ApplicationCommandOutcome>> {
    const requestContext = createApiRequestContext(request);
    const metaBase = createApiResponseMeta(request, requestContext, { async: false });

    try {
      if (!isApplicationCommandName(request.name)) {
        return createApiErrorResponse(
          request,
          requestContext,
          validationError("unknown_command", "API request does not map to an approved command."),
        );
      }

      const commandName = request.name;
      const auth = authorizeApiCommand(request, commandName);

      if (!auth.ok) {
        return createApiErrorResponse(request, requestContext, auth.error);
      }

      const envelope = createApplicationCommandEnvelope(
        createCommandEnvelopeInput(request, commandName, requestContext, auth.identity),
      );
      const outcome = await this.dispatcher.executeCommand(envelope);
      const meta = createApiResponseMeta(request, requestContext, {
        actorRef: auth.identity.actorRef,
        applicationService: getApplicationServiceForCommand(commandName),
        workflowRefs: getWorkflowRefsForCommand(commandName),
        commandRef: outcome.commandRef,
        async: isAsyncCommand(commandName),
      });

      return Object.freeze({
        ok: true,
        status: outcome.outcome,
        data: outcome,
        meta,
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        error: errorToApiError(error),
        meta: metaBase,
      });
    }
  }

  private async handleQuery(
    request: ApiQueryRequest,
  ): Promise<ApiResponse<ApplicationQueryOutcome>> {
    const requestContext = createApiRequestContext(request);
    const metaBase = createApiResponseMeta(request, requestContext, { async: false });

    try {
      if (!isApplicationQueryName(request.name)) {
        return createApiErrorResponse(
          request,
          requestContext,
          validationError("unknown_query", "API request does not map to an approved query."),
        );
      }

      const queryName = request.name;
      const auth = authorizeApiQuery(request, queryName);

      if (!auth.ok) {
        return createApiErrorResponse(request, requestContext, auth.error);
      }

      const envelope = createApplicationQueryEnvelope(
        createQueryEnvelopeInput(request, queryName, requestContext, auth.identity),
      );
      const outcome = await this.dispatcher.executeQuery(envelope);
      const meta = createApiResponseMeta(request, requestContext, {
        actorRef: auth.identity.actorRef,
        applicationService: getQueryBoundaryApplicationService(),
        workflowRefs: [getWorkflowByQuery(queryName).id],
        queryRef: outcome.queryRef,
        async: false,
      });

      return Object.freeze({
        ok: true,
        status: outcome.outcome,
        data: outcome,
        meta,
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        error: errorToApiError(error),
        meta: metaBase,
      });
    }
  }
}

export function authorizeApiCommand(
  request: ApiCommandRequest,
  commandName: ApplicationCommandName,
): { ok: true; identity: ApiRequestIdentity } | { ok: false; error: ApiError } {
  const identity = authenticateApiRequest(request);

  if (!identity.ok) {
    return identity;
  }

  if (!isBoundaryAllowedForCommand(request.boundary, commandName)) {
    return {
      ok: false,
      error: authorizationError(
        "command_not_allowed_at_boundary",
        "API boundary cannot invoke this command.",
      ),
    };
  }

  const requiredScopes = getRequiredScopesForCommand(commandName);

  if (!hasAllScopes(identity.identity, requiredScopes)) {
    return {
      ok: false,
      error: authorizationError("missing_scope", "API credential is missing required scope."),
    };
  }

  if (!isInstanceTargetAllowed(identity.identity, request.targetRef)) {
    return {
      ok: false,
      error: authorizationError(
        "instance_boundary_denied",
        "API credential is not allowed to access the target instance boundary.",
      ),
    };
  }

  return identity;
}

export function authorizeApiQuery(
  request: ApiQueryRequest,
  queryName: ApplicationQueryName,
): { ok: true; identity: ApiRequestIdentity } | { ok: false; error: ApiError } {
  const identity = authenticateApiRequest(request);

  if (!identity.ok) {
    return identity;
  }

  if (!isBoundaryAllowedForQuery(request.boundary, queryName)) {
    return {
      ok: false,
      error: authorizationError(
        "query_not_allowed_at_boundary",
        "API boundary cannot run this query.",
      ),
    };
  }

  const requiredScopes = getRequiredScopesForQuery(queryName);

  if (!hasAllScopes(identity.identity, requiredScopes)) {
    return {
      ok: false,
      error: authorizationError("missing_scope", "API credential is missing required scope."),
    };
  }

  if (!isInstanceTargetAllowed(identity.identity, request.targetRef)) {
    return {
      ok: false,
      error: authorizationError(
        "instance_boundary_denied",
        "API credential is not allowed to access the target instance boundary.",
      ),
    };
  }

  return identity;
}

export function authenticateApiRequest(
  request: ApiRequest,
): { ok: true; identity: ApiRequestIdentity } | { ok: false; error: ApiError } {
  const credential = request.credential;

  if (credential === undefined) {
    return {
      ok: false,
      error: authenticationError("missing_credential", "API request is missing authentication."),
    };
  }

  if (!isCredentialKindAllowedAtBoundary(credential.kind, request.boundary)) {
    return {
      ok: false,
      error: authenticationError(
        "credential_boundary_mismatch",
        "API credential cannot access this boundary.",
      ),
    };
  }

  return {
    ok: true,
    identity: Object.freeze({
      actorRef: `${credential.kind}:${credential.keyId}`,
      credentialKind: credential.kind,
      keyId: credential.keyId,
      scopes: Object.freeze([...credential.scopes]),
      ...optional("allowedInstanceRefs", credential.allowedInstanceRefs),
    }),
  };
}

export function mapApplicationErrorToApiError(error: ApplicationError): ApiError {
  switch (error.category) {
    case "validation":
    case "mapping":
      return validationError(error.code, error.message, error.retryable);
    case "authorization":
      return authorizationError(error.code, error.message, error.retryable);
    case "conflict":
    case "consistency":
      return apiError("conflict", error.code, error.message, error.retryable);
    case "async_visibility":
    case "dependency":
      return apiError("infrastructure", error.code, error.message, error.retryable);
    case "workflow":
      return apiError("business", error.code, error.message, error.retryable);
    case "unknown":
      return apiError("internal", error.code, "Application failed unexpectedly.", error.retryable);
  }
}

function createCommandEnvelopeInput(
  request: ApiCommandRequest,
  commandName: ApplicationCommandName,
  requestContext: RequestContext,
  identity: ApiRequestIdentity,
): ApplicationCommandEnvelopeInput {
  return {
    name: commandName,
    commandRef: request.requestRef,
    requestContext,
    actorRef: identity.actorRef,
    ...optional("targetRef", request.targetRef),
    ...optional("idempotencyKey", request.idempotencyKey),
    ...optional("safeInputRef", request.safeInputRef),
    ...optional("dataClassification", request.dataClassification),
  };
}

function createQueryEnvelopeInput(
  request: ApiQueryRequest,
  queryName: ApplicationQueryName,
  requestContext: RequestContext,
  identity: ApiRequestIdentity,
): ApplicationQueryEnvelopeInput {
  return {
    name: queryName,
    queryRef: request.requestRef,
    requestContext,
    actorRef: identity.actorRef,
    ...optional("targetRef", request.targetRef),
    ...optional("safeCriteriaRef", request.safeCriteriaRef),
    ...optional("requestedConsistency", request.requestedConsistency),
    ...optional("dataClassification", request.dataClassification),
  };
}

function createApiResponseMeta(
  request: ApiRequest,
  requestContext: RequestContext,
  input: Partial<
    Pick<
      ApiResponseMeta,
      "actorRef" | "applicationService" | "workflowRefs" | "commandRef" | "queryRef" | "async"
    >
  >,
): ApiResponseMeta {
  if (requestContext.requestId === undefined) {
    throw new TypeError("API request context must include requestId.");
  }

  return Object.freeze({
    apiVersion,
    requestRef: request.requestRef,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
    boundary: request.boundary,
    async: input.async ?? false,
    ...optional("traceId", requestContext.traceId),
    ...optional("actorRef", input.actorRef),
    ...optional("applicationService", input.applicationService),
    ...optional("workflowRefs", input.workflowRefs),
    ...optional("commandRef", input.commandRef),
    ...optional("queryRef", input.queryRef),
  });
}

function createApiRequestContext(request: ApiRequest): RequestContext {
  return createRequestContext({
    requestId: createRequestId(request.requestId ?? `req:${request.requestRef}`),
    correlationId: createCorrelationId(request.correlationId ?? `corr:${request.requestRef}`),
    ...optional(
      "traceId",
      request.traceId === undefined ? undefined : createTraceId(request.traceId),
    ),
  });
}

function createApiErrorResponse(
  request: ApiRequest,
  requestContext: RequestContext,
  error: ApiError,
): ApiErrorResponse {
  return Object.freeze({
    ok: false,
    error,
    meta: createApiResponseMeta(request, requestContext, { async: false }),
  });
}

function isCredentialKindAllowedAtBoundary(
  kind: ApiCredentialKind,
  boundary: ApiBoundary,
): boolean {
  switch (boundary) {
    case "public":
      return kind === "api_key" || kind === "admin_key";
    case "admin":
      return kind === "admin_key";
    case "health":
      return kind === "api_key" || kind === "admin_key" || kind === "monitoring_key";
    case "monitoring":
      return kind === "admin_key" || kind === "monitoring_key";
    case "internal_runtime":
      return kind === "internal_runtime";
  }
}

function isBoundaryAllowedForCommand(
  boundary: ApiBoundary,
  commandName: ApplicationCommandName,
): boolean {
  const definition = getApplicationCommandDefinition(commandName);

  switch (boundary) {
    case "public":
      return definition.trigger === "product" && !definition.privileged;
    case "admin":
      return definition.trigger === "administration" || definition.trigger === "product";
    case "internal_runtime":
      return ["internal_workflow", "worker", "provider_signal", "scheduler"].includes(
        definition.trigger,
      );
    case "health":
    case "monitoring":
      return false;
  }
}

function isBoundaryAllowedForQuery(
  boundary: ApiBoundary,
  queryName: ApplicationQueryName,
): boolean {
  switch (boundary) {
    case "public":
      return [
        "GetInstanceStatus",
        "ListInstances",
        "ListInstanceSessions",
        "GetMessageStatus",
        "GetMessageDeliveryHistory",
        "ListInstanceMessages",
        "ListChats",
        "ListInstanceChats",
        "GetChatStatus",
        "ListContacts",
        "ListInstanceContacts",
        "GetContactStatus",
        "ListLabels",
        "ListInstanceLabels",
        "GetLabelStatus",
        "ListInstanceGroups",
        "GetGroupStatus",
        "ListGroupMembers",
        "GetMediaStatus",
        "GetWebhookStatus",
        "GetWebhookDeliveryHistory",
        "ListWebhookSubscriptions",
        "ListWebhookDeliveries",
        "ListEvents",
      ].includes(queryName);
    case "admin":
      return true;
    case "health":
      return queryName === "GetHealthStatus" || queryName === "GetActionRequiredItems";
    case "monitoring":
      return [
        "GetHealthStatus",
        "GetOperationalMetricsSnapshot",
        "GetQueueMetricsSnapshot",
        "GetWebhookMetricsSnapshot",
        "GetMessageMetricsSnapshot",
        "GetMediaMetricsSnapshot",
        "GetActionRequiredItems",
        "GetWorkerJobStatus",
        "GetDashboardSummary",
        "ListWorkerJobs",
      ].includes(queryName);
    case "internal_runtime":
      return false;
  }
}

function getRequiredScopesForCommand(commandName: ApplicationCommandName): readonly ApiScope[] {
  switch (commandName) {
    case "CreateInstance":
    case "UpdateInstanceMetadata":
      return ["instances:write"];
    case "ConnectInstance":
    case "RefreshQrPairing":
    case "DisconnectInstance":
    case "ReconnectInstance":
      return ["instances:connect"];
    case "DestroyInstance":
      return ["instances:destroy"];
    case "SendTextMessage":
    case "SendMediaMessage":
      return ["messages:send"];
    case "SendGroupTextMessage":
      return ["groups:message"];
    case "RetryMessageSend":
      return ["messages:retry"];
    case "CancelMessage":
      return ["messages:cancel"];
    case "RegisterMedia":
      return ["media:write"];
    case "RefreshGroupList":
    case "UpdateGroupMetadata":
    case "UpdateGroupLocalState":
      return ["groups:write"];
    case "AddGroupMember":
    case "RemoveGroupMember":
    case "PromoteGroupMember":
    case "DemoteGroupMember":
    case "RefreshGroupInviteLink":
      return ["groups:admin"];
    case "RegisterWebhookSubscription":
    case "UpdateWebhookSubscription":
    case "ActivateWebhookSubscription":
    case "SuspendWebhookSubscription":
    case "RetireWebhookSubscription":
      return ["webhooks:write"];
    case "RetryWebhookDelivery":
      return ["webhooks:retry"];
    case "RedriveWebhookDelivery":
      return ["webhooks:redrive"];
    case "RequestDiagnosticCapture":
    case "MoveWebhookDeliveryToDeadLetter":
      return ["admin:*"];
    case "ValidateConfigurationSnapshot":
    case "ActivateConfigurationSnapshot":
      return ["config:write"];
    case "EvaluateProviderCompatibility":
      return ["provider:read"];
    case "RefreshProviderCapability":
      return ["provider:refresh"];
    case "EvaluateOutboundGuardrails":
    case "ProcessOutboundMessageWork":
    case "ApplyProviderMessageStatus":
    case "ReceiveInboundMessage":
    case "ClassifyUnsupportedInboundMessage":
    case "ProcessMediaWork":
    case "AttachMediaToMessageWorkflow":
    case "CleanupMediaRetention":
    case "ScheduleWebhookDelivery":
    case "DeliverWebhookWork":
    case "HandleProviderConnectionSignal":
    case "ConfirmSessionActivated":
    case "HandleProviderAuthSignal":
    case "HandleProviderMessageSignal":
    case "HandleProviderFailureSignal":
    case "QueueAsyncWork":
    case "ReserveWorkerJob":
    case "CompleteWorkerJob":
    case "MarkWorkerJobRetryOrDead":
    case "EvaluateAccessDecision":
    case "RecordAuditEvidence":
    case "RefreshHealthStatus":
    case "CaptureTelemetrySignal":
    case "StartQrPairing":
    case "MarkInstanceLoggedOut":
      return ["internal:runtime"];
  }
}

function getRequiredScopesForQuery(queryName: ApplicationQueryName): readonly ApiScope[] {
  switch (queryName) {
    case "GetInstanceStatus":
    case "ListInstances":
    case "ListInstanceSessions":
      return ["instances:read"];
    case "GetMessageStatus":
    case "GetMessageDeliveryHistory":
    case "ListInstanceMessages":
      return ["messages:read"];
    case "ListChats":
    case "ListInstanceChats":
    case "GetChatStatus":
      return ["chats:read"];
    case "ListContacts":
    case "ListInstanceContacts":
    case "GetContactStatus":
      return ["contacts:read"];
    case "ListLabels":
    case "ListInstanceLabels":
    case "GetLabelStatus":
      return ["labels:read"];
    case "ListInstanceGroups":
    case "GetGroupStatus":
    case "ListGroupMembers":
      return ["groups:read"];
    case "GetMediaStatus":
      return ["media:read"];
    case "GetWebhookStatus":
    case "GetWebhookDeliveryHistory":
    case "ListWebhookSubscriptions":
    case "ListWebhookDeliveries":
      return ["webhooks:read"];
    case "GetHealthStatus":
    case "GetActionRequiredItems":
      return ["health:read"];
    case "ListEvents":
      return ["events:read"];
    case "QueryAuditRecords":
      return ["audit:read"];
    case "GetConfigurationStatus":
      return ["config:read"];
    case "GetOperationalMetricsSnapshot":
    case "GetDashboardSummary":
    case "GetQueueMetricsSnapshot":
    case "GetWebhookMetricsSnapshot":
    case "GetMessageMetricsSnapshot":
    case "GetMediaMetricsSnapshot":
      return ["metrics:read"];
    case "GetWorkerJobStatus":
    case "ListWorkerJobs":
      return ["jobs:read"];
    case "GetProviderCapabilityStatus":
      return ["provider:read"];
  }
}

function hasAllScopes(identity: ApiRequestIdentity, requiredScopes: readonly ApiScope[]): boolean {
  if (identity.scopes.includes("admin:*")) {
    return true;
  }

  if (requiredScopes.includes("internal:runtime")) {
    return identity.credentialKind === "internal_runtime";
  }

  return requiredScopes.every((scope) => identity.scopes.includes(scope));
}

function isInstanceTargetAllowed(
  identity: ApiRequestIdentity,
  targetRef: string | undefined,
): boolean {
  if (targetRef === undefined || identity.allowedInstanceRefs === undefined) {
    return true;
  }

  if (!targetRef.startsWith("inst_")) {
    return true;
  }

  return identity.allowedInstanceRefs.includes(targetRef);
}

function isAsyncCommand(commandName: ApplicationCommandName): boolean {
  return getApplicationCommandDefinition(commandName).asyncBoundary;
}

function getWorkflowRefsForCommand(commandName: ApplicationCommandName): readonly string[] {
  return Object.freeze(getWorkflowsByCommand(commandName).map((workflow) => workflow.id));
}

function errorToApiError(error: unknown): ApiError {
  if (error instanceof TypeError) {
    return validationError("invalid_api_mapping", error.message);
  }

  return apiError(
    "internal",
    "api_adapter_unexpected_error",
    "API adapter failed unexpectedly.",
    true,
  );
}

function validationError(code: string, message: string, retryable = false): ApiError {
  return apiError("validation", code, message, retryable);
}

function authenticationError(code: string, message: string): ApiError {
  return apiError("authentication", code, message, false);
}

function authorizationError(code: string, message: string, retryable = false): ApiError {
  return apiError("authorization", code, message, retryable);
}

function apiError(
  category: ApiErrorCategory,
  code: string,
  message: string,
  retryable: boolean,
): ApiError {
  return Object.freeze({
    category,
    code,
    message,
    retryable,
  });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
