import type { ReadConsistencyLevel } from "../ports/read-model.js";

export const applicationQueryGroups = [
  "status",
  "history",
  "configuration",
  "metrics",
  "monitoring",
] as const;

export type ApplicationQueryGroup = (typeof applicationQueryGroups)[number];

export const applicationQueryOutcomes = [
  "result",
  "empty",
  "stale",
  "unavailable",
  "denied",
] as const;

export type ApplicationQueryOutcomeName = (typeof applicationQueryOutcomes)[number];

export type ApplicationQueryDefinition = Readonly<{
  name: string;
  group: ApplicationQueryGroup;
  consistency: ReadConsistencyLevel;
  cacheCandidate: boolean;
  retentionBound: boolean;
  sideEffectFree: true;
}>;

export const applicationQueryDefinitions = [
  query("GetInstanceStatus", "status", "strong_owner", true, false),
  query("ListInstances", "history", "eventual_projection", true, false),
  query("GetMessageStatus", "status", "strong_owner", true, false),
  query("GetMessageDeliveryHistory", "history", "retention_bound", true, true),
  query("GetMediaStatus", "status", "strong_owner", true, false),
  query("GetWebhookStatus", "status", "strong_owner", true, false),
  query("GetWebhookDeliveryHistory", "history", "retention_bound", true, true),
  query("GetHealthStatus", "status", "eventual_projection", true, false),
  query("QueryAuditRecords", "history", "retention_bound", true, true),
  query("GetConfigurationStatus", "configuration", "strong_owner", true, false),
  query("GetOperationalMetricsSnapshot", "metrics", "eventual_projection", true, false),
  query("GetQueueMetricsSnapshot", "metrics", "eventual_projection", true, false),
  query("GetWebhookMetricsSnapshot", "metrics", "eventual_projection", true, false),
  query("GetMessageMetricsSnapshot", "metrics", "eventual_projection", true, false),
  query("GetMediaMetricsSnapshot", "metrics", "eventual_projection", true, false),
  query("GetActionRequiredItems", "monitoring", "eventual_projection", true, false),
  query("GetWorkerJobStatus", "monitoring", "strong_owner", true, false),
  query("GetProviderCapabilityStatus", "monitoring", "strong_owner", true, false),
] as const satisfies readonly ApplicationQueryDefinition[];

export type ApplicationQueryName = (typeof applicationQueryDefinitions)[number]["name"];

export const applicationQueryNames = Object.freeze(
  applicationQueryDefinitions.map((definition) => definition.name),
) as readonly ApplicationQueryName[];

export function isApplicationQueryName(value: string): value is ApplicationQueryName {
  return applicationQueryNames.includes(value as ApplicationQueryName);
}

export function getApplicationQueryDefinition(
  name: ApplicationQueryName,
): Extract<(typeof applicationQueryDefinitions)[number], { name: typeof name }> {
  return queryDefinitionByName[name] as Extract<
    (typeof applicationQueryDefinitions)[number],
    { name: typeof name }
  >;
}

export function getApplicationQueriesByGroup(
  group: ApplicationQueryGroup,
): readonly ApplicationQueryDefinition[] {
  return applicationQueryDefinitions.filter((definition) => definition.group === group);
}

export function isApplicationQueryOutcome(value: string): value is ApplicationQueryOutcomeName {
  return applicationQueryOutcomes.includes(value as ApplicationQueryOutcomeName);
}

const queryDefinitionByName = Object.freeze(
  Object.fromEntries(
    applicationQueryDefinitions.map((definition) => [definition.name, definition]),
  ),
) as Readonly<Record<ApplicationQueryName, ApplicationQueryDefinition>>;

function query<const TName extends string>(
  name: TName,
  group: ApplicationQueryGroup,
  consistency: ReadConsistencyLevel,
  cacheCandidate: boolean,
  retentionBound: boolean,
): Readonly<{
  name: TName;
  group: ApplicationQueryGroup;
  consistency: ReadConsistencyLevel;
  cacheCandidate: boolean;
  retentionBound: boolean;
  sideEffectFree: true;
}> {
  return Object.freeze({
    name,
    group,
    consistency,
    cacheCandidate,
    retentionBound,
    sideEffectFree: true,
  });
}
