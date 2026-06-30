import type {
  ApplicationCommandGroup,
  ApplicationCommandName,
} from "../commands/command-catalog.js";
import type { ApplicationQueryName } from "../queries/query-catalog.js";

export const applicationServiceNames = [
  "InstanceApplicationService",
  "MessagingApplicationService",
  "MediaApplicationService",
  "WebhookApplicationService",
  "ProviderApplicationService",
  "OperationsApplicationService",
  "AdministrationApplicationService",
  "MonitoringApplicationService",
  "QueryApplicationService",
] as const;

export type ApplicationServiceName = (typeof applicationServiceNames)[number];

export type ApplicationServiceDefinition = Readonly<{
  name: ApplicationServiceName;
  commandGroups: readonly ApplicationCommandGroup[];
  primaryCommands: readonly ApplicationCommandName[];
  primaryQueries: readonly ApplicationQueryName[];
  queryBoundaryForAllQueries: boolean;
  sideEffecting: boolean;
}>;

export const applicationServiceDefinitions = [
  service(
    "InstanceApplicationService",
    ["instance"],
    [
      "CreateInstance",
      "UpdateInstanceMetadata",
      "ConnectInstance",
      "StartQrPairing",
      "RefreshQrPairing",
      "ConfirmSessionActivated",
      "DisconnectInstance",
      "ReconnectInstance",
      "MarkInstanceLoggedOut",
      "DestroyInstance",
    ],
    ["GetInstanceStatus", "ListInstances", "ListInstanceSessions"],
    false,
    true,
  ),
  service(
    "MessagingApplicationService",
    ["messaging"],
    [
      "SendTextMessage",
      "SendMediaMessage",
      "EvaluateOutboundGuardrails",
      "ProcessOutboundMessageWork",
      "ApplyProviderMessageStatus",
      "ReceiveInboundMessage",
      "ClassifyUnsupportedInboundMessage",
      "RetryMessageSend",
      "CancelMessage",
    ],
    [
      "GetMessageStatus",
      "GetMessageDeliveryHistory",
      "ListInstanceMessages",
      "GetMessageMetricsSnapshot",
    ],
    false,
    true,
  ),
  service(
    "MediaApplicationService",
    ["media"],
    [
      "RegisterMedia",
      "ProcessMediaWork",
      "AttachMediaToMessageWorkflow",
      "RequestDiagnosticCapture",
      "CleanupMediaRetention",
    ],
    ["GetMediaStatus", "GetMediaMetricsSnapshot"],
    false,
    true,
  ),
  service(
    "WebhookApplicationService",
    ["webhook"],
    [
      "RegisterWebhookSubscription",
      "UpdateWebhookSubscription",
      "ActivateWebhookSubscription",
      "SuspendWebhookSubscription",
      "RetireWebhookSubscription",
      "ScheduleWebhookDelivery",
      "DeliverWebhookWork",
      "RetryWebhookDelivery",
      "MoveWebhookDeliveryToDeadLetter",
    ],
    [
      "GetWebhookStatus",
      "GetWebhookDeliveryHistory",
      "ListWebhookSubscriptions",
      "ListWebhookDeliveries",
      "GetWebhookMetricsSnapshot",
    ],
    false,
    true,
  ),
  service(
    "ProviderApplicationService",
    ["provider"],
    [
      "EvaluateProviderCompatibility",
      "HandleProviderConnectionSignal",
      "HandleProviderAuthSignal",
      "HandleProviderMessageSignal",
      "HandleProviderFailureSignal",
      "RefreshProviderCapability",
    ],
    ["GetProviderCapabilityStatus"],
    false,
    true,
  ),
  service(
    "OperationsApplicationService",
    ["operations"],
    ["QueueAsyncWork", "ReserveWorkerJob", "CompleteWorkerJob", "MarkWorkerJobRetryOrDead"],
    ["GetWorkerJobStatus", "ListWorkerJobs", "GetQueueMetricsSnapshot"],
    false,
    true,
  ),
  service(
    "AdministrationApplicationService",
    ["administration"],
    [
      "EvaluateAccessDecision",
      "ValidateConfigurationSnapshot",
      "ActivateConfigurationSnapshot",
      "RecordAuditEvidence",
    ],
    ["GetConfigurationStatus", "QueryAuditRecords"],
    false,
    true,
  ),
  service(
    "MonitoringApplicationService",
    ["monitoring"],
    ["RefreshHealthStatus", "CaptureTelemetrySignal"],
    [
      "GetHealthStatus",
      "GetDashboardSummary",
      "GetOperationalMetricsSnapshot",
      "GetActionRequiredItems",
      "ListEvents",
    ],
    false,
    true,
  ),
  service("QueryApplicationService", [], [], [], true, false),
] as const satisfies readonly ApplicationServiceDefinition[];

const serviceByCommand = Object.freeze(
  Object.fromEntries(
    applicationServiceDefinitions.flatMap((definition) =>
      definition.primaryCommands.map((commandName) => [commandName, definition.name]),
    ),
  ),
) as Readonly<Record<ApplicationCommandName, ApplicationServiceName>>;

const serviceByQuery = Object.freeze(
  Object.fromEntries(
    applicationServiceDefinitions.flatMap((definition) =>
      definition.primaryQueries.map((queryName) => [queryName, definition.name]),
    ),
  ),
) as Readonly<Record<ApplicationQueryName, ApplicationServiceName>>;

export function getApplicationServiceForCommand(
  commandName: ApplicationCommandName,
): ApplicationServiceName {
  return serviceByCommand[commandName];
}

export function getPrimaryApplicationServiceForQuery(
  queryName: ApplicationQueryName,
): ApplicationServiceName {
  return serviceByQuery[queryName];
}

export function getQueryBoundaryApplicationService(): ApplicationServiceName {
  return "QueryApplicationService";
}

function service(
  name: ApplicationServiceName,
  commandGroups: readonly ApplicationCommandGroup[],
  primaryCommands: readonly ApplicationCommandName[],
  primaryQueries: readonly ApplicationQueryName[],
  queryBoundaryForAllQueries: boolean,
  sideEffecting: boolean,
): ApplicationServiceDefinition {
  return Object.freeze({
    name,
    commandGroups,
    primaryCommands,
    primaryQueries,
    queryBoundaryForAllQueries,
    sideEffecting,
  });
}
