import type { ApplicationCommandName } from "../commands/command-catalog.js";
import type { ApplicationQueryName } from "../queries/query-catalog.js";

export const applicationWorkflowGroups = [
  "instance",
  "messaging",
  "media",
  "group",
  "webhook",
  "provider",
  "administration",
  "monitoring",
  "query",
] as const;

export type ApplicationWorkflowGroup = (typeof applicationWorkflowGroups)[number];

export const sagaCandidateStrengths = ["none", "weak", "moderate", "strong"] as const;

export type SagaCandidateStrength = (typeof sagaCandidateStrengths)[number];

export type ApplicationWorkflowDefinition = Readonly<{
  id: string;
  name: string;
  group: ApplicationWorkflowGroup;
  longRunning: boolean;
  asyncVisibilityRequired: boolean;
  queryOnly: boolean;
  sagaCandidate: SagaCandidateStrength;
  entryCommands: readonly ApplicationCommandName[];
  entryQueries: readonly ApplicationQueryName[];
}>;

export const commandsWithoutStandaloneWorkflow = [
  "UpdateInstanceMetadata",
  "RequestDiagnosticCapture",
  "QueueAsyncWork",
  "ReserveWorkerJob",
  "CompleteWorkerJob",
  "MarkWorkerJobRetryOrDead",
] as const satisfies readonly ApplicationCommandName[];

export const applicationWorkflowDefinitions = [
  workflow("WF-INS-001", "Instance Creation", "instance", false, false, false, "none", [
    "CreateInstance",
  ]),
  workflow("WF-INS-002", "Instance Connection Request", "instance", true, true, false, "none", [
    "ConnectInstance",
  ]),
  workflow("WF-INS-003", "QR Authentication", "instance", true, false, false, "strong", [
    "StartQrPairing",
    "RefreshQrPairing",
    "ConfirmSessionActivated",
  ]),
  workflow("WF-INS-004", "Reconnect Instance", "instance", true, true, false, "strong", [
    "ReconnectInstance",
  ]),
  workflow("WF-INS-005", "Disconnect Or Logout Handling", "instance", true, false, false, "none", [
    "DisconnectInstance",
    "MarkInstanceLoggedOut",
  ]),
  workflow("WF-INS-006", "Instance Destruction", "instance", true, false, false, "strong", [
    "DestroyInstance",
  ]),

  workflow("WF-MSG-001", "Send Text Message", "messaging", false, true, false, "none", [
    "SendTextMessage",
    "EvaluateOutboundGuardrails",
  ]),
  workflow("WF-MSG-002", "Send Media Message", "messaging", true, true, false, "strong", [
    "SendMediaMessage",
  ]),
  workflow("WF-MSG-003", "Outbound Message Execution", "messaging", true, true, false, "strong", [
    "ProcessOutboundMessageWork",
    "ApplyProviderMessageStatus",
  ]),
  workflow("WF-MSG-004", "Message Retry", "messaging", true, true, false, "moderate", [
    "RetryMessageSend",
  ]),
  workflow("WF-MSG-005", "Message Cancellation", "messaging", false, false, false, "none", [
    "CancelMessage",
  ]),
  workflow("WF-MSG-006", "Receive Inbound Message", "messaging", false, false, false, "none", [
    "ReceiveInboundMessage",
  ]),
  workflow(
    "WF-MSG-007",
    "Unsupported Inbound Message Handling",
    "messaging",
    false,
    false,
    false,
    "none",
    ["ClassifyUnsupportedInboundMessage"],
  ),

  workflow("WF-MED-001", "Media Registration", "media", false, true, false, "none", [
    "RegisterMedia",
  ]),
  workflow("WF-MED-002", "Media Processing", "media", true, true, false, "moderate", [
    "ProcessMediaWork",
    "AttachMediaToMessageWorkflow",
  ]),
  workflow("WF-MED-003", "Media Cleanup", "media", true, true, false, "moderate", [
    "CleanupMediaRetention",
  ]),

  workflow("WF-GRP-001", "Group Discovery Sync", "group", true, true, false, "moderate", [
    "RefreshGroupList",
  ]),
  workflow("WF-GRP-002", "Send Group Text Message", "group", true, true, false, "moderate", [
    "SendGroupTextMessage",
  ]),
  workflow("WF-GRP-003", "Group Member Administration", "group", true, true, false, "strong", [
    "AddGroupMember",
    "RemoveGroupMember",
    "PromoteGroupMember",
    "DemoteGroupMember",
  ]),
  workflow(
    "WF-GRP-004",
    "Group Metadata Invite And Local State",
    "group",
    true,
    true,
    false,
    "moderate",
    ["UpdateGroupMetadata", "RefreshGroupInviteLink", "UpdateGroupLocalState"],
  ),

  workflow(
    "WF-WEB-001",
    "Webhook Subscription Management",
    "webhook",
    false,
    false,
    false,
    "none",
    [
      "RegisterWebhookSubscription",
      "UpdateWebhookSubscription",
      "ActivateWebhookSubscription",
      "SuspendWebhookSubscription",
      "RetireWebhookSubscription",
    ],
  ),
  workflow("WF-WEB-002", "Webhook Delivery", "webhook", true, true, false, "strong", [
    "ScheduleWebhookDelivery",
    "DeliverWebhookWork",
  ]),
  workflow("WF-WEB-003", "Webhook Retry And Dead Letter", "webhook", true, true, false, "strong", [
    "RetryWebhookDelivery",
    "RedriveWebhookDelivery",
    "MoveWebhookDeliveryToDeadLetter",
  ]),

  workflow(
    "WF-PRV-001",
    "Provider Compatibility Refresh",
    "provider",
    false,
    false,
    false,
    "weak",
    ["EvaluateProviderCompatibility", "RefreshProviderCapability"],
  ),
  workflow("WF-PRV-002", "Provider Signal Routing", "provider", false, false, false, "none", [
    "HandleProviderConnectionSignal",
    "HandleProviderAuthSignal",
    "HandleProviderMessageSignal",
    "HandleProviderFailureSignal",
  ]),

  workflow(
    "WF-ADM-001",
    "Configuration Activation",
    "administration",
    false,
    false,
    false,
    "moderate",
    ["ValidateConfigurationSnapshot", "ActivateConfigurationSnapshot"],
  ),
  workflow(
    "WF-ADM-002",
    "Audit Evidence Recording",
    "administration",
    false,
    false,
    false,
    "none",
    ["RecordAuditEvidence", "EvaluateAccessDecision"],
  ),

  workflow("WF-MON-001", "Health Refresh", "monitoring", false, false, false, "none", [
    "RefreshHealthStatus",
  ]),
  workflow("WF-MON-002", "Telemetry Capture", "monitoring", false, false, false, "none", [
    "CaptureTelemetrySignal",
  ]),

  workflow(
    "WF-QRY-001",
    "Status Query Workflows",
    "query",
    false,
    false,
    true,
    "none",
    [],
    [
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
      "GetHealthStatus",
      "QueryAuditRecords",
      "GetConfigurationStatus",
      "GetDashboardSummary",
      "GetOperationalMetricsSnapshot",
      "GetQueueMetricsSnapshot",
      "GetWebhookMetricsSnapshot",
      "GetMessageMetricsSnapshot",
      "GetMediaMetricsSnapshot",
      "GetActionRequiredItems",
      "GetWorkerJobStatus",
      "ListWorkerJobs",
      "GetProviderCapabilityStatus",
    ],
  ),
] as const satisfies readonly ApplicationWorkflowDefinition[];

export type ApplicationWorkflowId = (typeof applicationWorkflowDefinitions)[number]["id"];

export const applicationWorkflowIds = Object.freeze(
  applicationWorkflowDefinitions.map((definition) => definition.id),
) as readonly ApplicationWorkflowId[];

const workflowDefinitionById = Object.freeze(
  Object.fromEntries(
    applicationWorkflowDefinitions.map((definition) => [definition.id, definition]),
  ),
) as Readonly<Record<ApplicationWorkflowId, ApplicationWorkflowDefinition>>;

export function isApplicationWorkflowId(value: string): value is ApplicationWorkflowId {
  return applicationWorkflowIds.includes(value as ApplicationWorkflowId);
}

export function getApplicationWorkflowDefinition(
  id: ApplicationWorkflowId,
): ApplicationWorkflowDefinition {
  return workflowDefinitionById[id];
}

export function getWorkflowsByCommand(
  commandName: ApplicationCommandName,
): readonly ApplicationWorkflowDefinition[] {
  return applicationWorkflowDefinitions.filter((definition) =>
    definition.entryCommands.includes(commandName),
  );
}

export function getWorkflowByQuery(queryName: ApplicationQueryName): ApplicationWorkflowDefinition {
  const workflow = applicationWorkflowDefinitions.find((definition) =>
    definition.entryQueries.includes(queryName),
  );

  if (workflow === undefined) {
    throw new TypeError(`No Application workflow owns query ${queryName}.`);
  }

  return workflow;
}

export function hasStandaloneWorkflowException(commandName: ApplicationCommandName): boolean {
  return commandsWithoutStandaloneWorkflow.includes(commandName as never);
}

function workflow<const TId extends string>(
  id: TId,
  name: string,
  group: ApplicationWorkflowGroup,
  longRunning: boolean,
  asyncVisibilityRequired: boolean,
  queryOnly: boolean,
  sagaCandidate: SagaCandidateStrength,
  entryCommands: readonly ApplicationCommandName[] = [],
  entryQueries: readonly ApplicationQueryName[] = [],
): Readonly<{
  id: TId;
  name: string;
  group: ApplicationWorkflowGroup;
  longRunning: boolean;
  asyncVisibilityRequired: boolean;
  queryOnly: boolean;
  sagaCandidate: SagaCandidateStrength;
  entryCommands: readonly ApplicationCommandName[];
  entryQueries: readonly ApplicationQueryName[];
}> {
  return Object.freeze({
    id,
    name,
    group,
    longRunning,
    asyncVisibilityRequired,
    queryOnly,
    sagaCandidate,
    entryCommands,
    entryQueries,
  });
}
