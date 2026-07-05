export const applicationCommandGroups = [
  "instance",
  "messaging",
  "media",
  "group",
  "webhook",
  "provider",
  "operations",
  "administration",
  "monitoring",
] as const;

export type ApplicationCommandGroup = (typeof applicationCommandGroups)[number];

export const applicationCommandTriggers = [
  "product",
  "internal_workflow",
  "worker",
  "provider_signal",
  "scheduler",
  "administration",
] as const;

export type ApplicationCommandTrigger = (typeof applicationCommandTriggers)[number];

export const applicationCommandOutcomes = [
  "completed",
  "accepted",
  "queued",
  "waiting",
  "rejected",
  "failed",
  "action_required",
  "cancelled",
  "dead_lettered",
] as const;

export type ApplicationCommandOutcomeName = (typeof applicationCommandOutcomes)[number];

export type ApplicationCommandDefinition = Readonly<{
  name: string;
  group: ApplicationCommandGroup;
  trigger: ApplicationCommandTrigger;
  idempotencyRequired: boolean;
  longRunning: boolean;
  asyncBoundary: boolean;
  privileged: boolean;
}>;

export const applicationCommandDefinitions = [
  command("CreateInstance", "instance", "product", true, false, false, false),
  command("UpdateInstanceMetadata", "instance", "product", false, false, false, false),
  command("ConnectInstance", "instance", "product", true, true, true, false),
  command("StartQrPairing", "instance", "internal_workflow", true, true, false, false),
  command("RefreshQrPairing", "instance", "product", true, true, false, false),
  command("ConfirmSessionActivated", "instance", "provider_signal", true, false, false, false),
  command("DisconnectInstance", "instance", "product", false, true, false, false),
  command("ReconnectInstance", "instance", "scheduler", true, true, true, false),
  command("MarkInstanceLoggedOut", "instance", "provider_signal", true, false, false, false),
  command("DestroyInstance", "instance", "administration", false, true, false, true),

  command("SendTextMessage", "messaging", "product", true, true, true, false),
  command("SendMediaMessage", "messaging", "product", true, true, true, false),
  command(
    "EvaluateOutboundGuardrails",
    "messaging",
    "internal_workflow",
    true,
    false,
    false,
    false,
  ),
  command("ProcessOutboundMessageWork", "messaging", "worker", true, true, true, false),
  command("ApplyProviderMessageStatus", "messaging", "provider_signal", true, false, false, false),
  command("ReceiveInboundMessage", "messaging", "provider_signal", true, false, false, false),
  command(
    "ClassifyUnsupportedInboundMessage",
    "messaging",
    "provider_signal",
    true,
    false,
    false,
    false,
  ),
  command("RetryMessageSend", "messaging", "product", true, true, true, false),
  command("CancelMessage", "messaging", "product", true, false, false, false),

  command("RegisterMedia", "media", "product", true, true, true, false),
  command("ProcessMediaWork", "media", "worker", true, true, true, false),
  command("AttachMediaToMessageWorkflow", "media", "internal_workflow", false, false, false, false),
  command("RequestDiagnosticCapture", "media", "administration", false, false, false, true),
  command("CleanupMediaRetention", "media", "scheduler", true, true, true, false),

  command("RefreshGroupList", "group", "product", true, true, true, false),
  command("SendGroupTextMessage", "group", "product", true, true, true, false),
  command("UpdateGroupMetadata", "group", "product", true, true, true, false),
  command("AddGroupMember", "group", "product", true, true, true, false),
  command("RemoveGroupMember", "group", "product", true, true, true, false),
  command("PromoteGroupMember", "group", "product", true, true, true, false),
  command("DemoteGroupMember", "group", "product", true, true, true, false),
  command("RefreshGroupInviteLink", "group", "product", true, true, true, false),
  command("UpdateGroupLocalState", "group", "product", true, true, true, false),

  command("RegisterWebhookSubscription", "webhook", "product", true, false, false, false),
  command("UpdateWebhookSubscription", "webhook", "product", true, false, false, false),
  command("ActivateWebhookSubscription", "webhook", "product", true, false, false, false),
  command("SuspendWebhookSubscription", "webhook", "product", true, false, false, false),
  command("RetireWebhookSubscription", "webhook", "product", true, true, false, false),
  command("ScheduleWebhookDelivery", "webhook", "internal_workflow", true, true, true, false),
  command("DeliverWebhookWork", "webhook", "worker", true, true, true, false),
  command("RetryWebhookDelivery", "webhook", "product", true, true, true, false),
  command("RedriveWebhookDelivery", "webhook", "product", true, true, true, false),
  command("MoveWebhookDeliveryToDeadLetter", "webhook", "worker", true, false, false, false),

  command("EvaluateProviderCompatibility", "provider", "scheduler", false, false, false, false),
  command(
    "HandleProviderConnectionSignal",
    "provider",
    "provider_signal",
    true,
    false,
    false,
    false,
  ),
  command("HandleProviderAuthSignal", "provider", "provider_signal", true, false, false, false),
  command("HandleProviderMessageSignal", "provider", "provider_signal", true, false, false, false),
  command("HandleProviderFailureSignal", "provider", "provider_signal", true, false, false, false),
  command("RefreshProviderCapability", "provider", "scheduler", false, false, false, false),

  command("QueueAsyncWork", "operations", "internal_workflow", true, false, true, false),
  command("ReserveWorkerJob", "operations", "worker", true, false, false, false),
  command("CompleteWorkerJob", "operations", "worker", true, false, false, false),
  command("MarkWorkerJobRetryOrDead", "operations", "worker", true, false, false, false),

  command(
    "EvaluateAccessDecision",
    "administration",
    "internal_workflow",
    false,
    false,
    false,
    true,
  ),
  command(
    "ValidateConfigurationSnapshot",
    "administration",
    "administration",
    true,
    false,
    false,
    true,
  ),
  command(
    "ActivateConfigurationSnapshot",
    "administration",
    "administration",
    true,
    false,
    false,
    true,
  ),
  command("RecordAuditEvidence", "administration", "internal_workflow", true, false, false, false),

  command("RefreshHealthStatus", "monitoring", "scheduler", true, false, false, false),
  command("CaptureTelemetrySignal", "monitoring", "internal_workflow", true, false, false, false),
] as const satisfies readonly ApplicationCommandDefinition[];

export type ApplicationCommandName = (typeof applicationCommandDefinitions)[number]["name"];

export const applicationCommandNames = Object.freeze(
  applicationCommandDefinitions.map((definition) => definition.name),
) as readonly ApplicationCommandName[];

export function isApplicationCommandName(value: string): value is ApplicationCommandName {
  return applicationCommandNames.includes(value as ApplicationCommandName);
}

export function getApplicationCommandDefinition(
  name: ApplicationCommandName,
): Extract<(typeof applicationCommandDefinitions)[number], { name: typeof name }> {
  return commandDefinitionByName[name] as Extract<
    (typeof applicationCommandDefinitions)[number],
    { name: typeof name }
  >;
}

export function getApplicationCommandsByGroup(
  group: ApplicationCommandGroup,
): readonly ApplicationCommandDefinition[] {
  return applicationCommandDefinitions.filter((definition) => definition.group === group);
}

export function isApplicationCommandOutcome(value: string): value is ApplicationCommandOutcomeName {
  return applicationCommandOutcomes.includes(value as ApplicationCommandOutcomeName);
}

const commandDefinitionByName = Object.freeze(
  Object.fromEntries(
    applicationCommandDefinitions.map((definition) => [definition.name, definition]),
  ),
) as Readonly<Record<ApplicationCommandName, ApplicationCommandDefinition>>;

function command<const TName extends string>(
  name: TName,
  group: ApplicationCommandGroup,
  trigger: ApplicationCommandTrigger,
  idempotencyRequired: boolean,
  longRunning: boolean,
  asyncBoundary: boolean,
  privileged: boolean,
): Readonly<{
  name: TName;
  group: ApplicationCommandGroup;
  trigger: ApplicationCommandTrigger;
  idempotencyRequired: boolean;
  longRunning: boolean;
  asyncBoundary: boolean;
  privileged: boolean;
}> {
  return Object.freeze({
    name,
    group,
    trigger,
    idempotencyRequired,
    longRunning,
    asyncBoundary,
    privileged,
  });
}
