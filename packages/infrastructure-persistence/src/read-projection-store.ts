import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type ProjectionWriterPort,
  type ReadConsistencyLevel,
  type ReadFreshness,
  type ReadModelPort,
  type ReadModelResult,
} from "@omniwa/application";
import type { DomainAggregateType, DomainOwnerContext } from "@omniwa/domain";
import { err, ok } from "@omniwa/shared";

export const readProjectionNames = [
  "InstanceStatusProjection",
  "InstanceListProjection",
  "SessionListProjection",
  "MessageStatusProjection",
  "MessageDeliveryHistoryProjection",
  "MessageTimelineProjection",
  "ChatListProjection",
  "ChatStatusProjection",
  "ContactListProjection",
  "ContactStatusProjection",
  "LabelListProjection",
  "LabelStatusProjection",
  "GroupListProjection",
  "GroupStatusProjection",
  "GroupMemberListProjection",
  "MediaStatusProjection",
  "WebhookStatusProjection",
  "WebhookDeliveryHistoryProjection",
  "WebhookListProjection",
  "WebhookDeliveryListProjection",
  "WorkerJobStatusProjection",
  "WorkerJobListProjection",
  "HealthStatusProjection",
  "ActionRequiredProjection",
  "ProviderCapabilityProjection",
  "ConfigurationStatusProjection",
  "AuditRecordProjection",
  "EventLogProjection",
  "MetricsSnapshotProjection",
  "OperationalDashboardProjection",
  "DashboardSummaryProjection",
  "QueueMetricsProjection",
  "WebhookMetricsProjection",
  "MessageMetricsProjection",
  "MediaMetricsProjection",
] as const;

export type ReadProjectionName = (typeof readProjectionNames)[number];

export type ReadProjectionDefinition = Readonly<{
  name: ReadProjectionName;
  ownerContext: DomainOwnerContext;
  sourceAggregates: readonly DomainAggregateType[];
  queries: readonly string[];
  consistency: ReadConsistencyLevel;
  rebuildable: boolean;
  retentionBound: boolean;
}>;

export type ProjectionReadQuery = Readonly<{
  projectionName: ReadProjectionName;
  projectionKey: string;
}>;

export type ProjectionWriteSignal<TReadModel = unknown> = Readonly<{
  projectionName: ReadProjectionName;
  projectionKey: string;
  model: TReadModel;
  consistency?: ReadConsistencyLevel;
  refreshedAtEpochMilliseconds?: number;
  stale?: boolean;
  version?: string;
}>;

export type StoredReadProjection<TReadModel = unknown> = Readonly<{
  projectionName: ReadProjectionName;
  projectionKey: string;
  model: TReadModel;
  consistency: ReadConsistencyLevel;
  freshness: ReadFreshness;
  version?: string;
}>;

export const readProjectionDefinitions = Object.freeze([
  projection(
    "InstanceStatusProjection",
    "instance",
    ["Instance", "Session", "HealthStatus"],
    ["GetInstanceStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "InstanceListProjection",
    "instance",
    ["Instance", "Session", "HealthStatus"],
    ["ListInstances"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "SessionListProjection",
    "session",
    ["Session", "Instance", "HealthStatus"],
    ["ListInstanceSessions"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "MessageStatusProjection",
    "messaging",
    ["Message", "WorkerJob", "WebhookDelivery"],
    ["GetMessageStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "MessageDeliveryHistoryProjection",
    "messaging",
    ["Message", "WorkerJob"],
    ["GetMessageDeliveryHistory"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "MessageTimelineProjection",
    "messaging",
    ["Message", "MediaAsset", "WorkerJob"],
    ["ListInstanceMessages"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "ChatListProjection",
    "chat",
    ["Chat", "Contact", "Group", "Label", "Message"],
    ["ListChats", "ListInstanceChats"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "ChatStatusProjection",
    "chat",
    ["Chat", "Contact", "Group", "Label", "Message"],
    ["GetChatStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "ContactListProjection",
    "contact",
    ["Contact", "Chat"],
    ["ListContacts", "ListInstanceContacts"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "ContactStatusProjection",
    "contact",
    ["Contact", "Chat"],
    ["GetContactStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "LabelListProjection",
    "label",
    ["Label", "Chat"],
    ["ListLabels", "ListInstanceLabels"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "LabelStatusProjection",
    "label",
    ["Label", "Chat"],
    ["GetLabelStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "GroupListProjection",
    "group",
    ["Group", "Instance", "ProviderProfile", "HealthStatus"],
    ["ListInstanceGroups"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "GroupStatusProjection",
    "group",
    ["Group", "ProviderProfile", "HealthStatus"],
    ["GetGroupStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "GroupMemberListProjection",
    "group",
    ["Group"],
    ["ListGroupMembers"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "MediaStatusProjection",
    "media",
    ["MediaAsset", "WorkerJob"],
    ["GetMediaStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "WebhookStatusProjection",
    "webhook_delivery",
    ["WebhookSubscription", "WebhookDelivery", "HealthStatus"],
    ["GetWebhookStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "WebhookDeliveryHistoryProjection",
    "webhook_delivery",
    ["WebhookDelivery"],
    ["GetWebhookDeliveryHistory"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "WebhookListProjection",
    "webhook_delivery",
    ["WebhookSubscription", "WebhookDelivery", "HealthStatus"],
    ["ListWebhookSubscriptions"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "WebhookDeliveryListProjection",
    "webhook_delivery",
    ["WebhookDelivery", "WebhookSubscription"],
    ["ListWebhookDeliveries"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "WorkerJobStatusProjection",
    "operations",
    ["WorkerJob"],
    ["GetWorkerJobStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "WorkerJobListProjection",
    "operations",
    ["WorkerJob"],
    ["ListWorkerJobs"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "HealthStatusProjection",
    "health",
    ["HealthStatus"],
    ["GetHealthStatus"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "ActionRequiredProjection",
    "health",
    ["HealthStatus", "Instance", "WorkerJob", "WebhookDelivery", "ConfigurationSnapshot"],
    ["GetActionRequiredItems"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "ProviderCapabilityProjection",
    "provider_integration",
    ["ProviderProfile", "HealthStatus"],
    ["GetProviderCapabilityStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "ConfigurationStatusProjection",
    "configuration",
    ["ConfigurationSnapshot"],
    ["GetConfigurationStatus"],
    "strong_owner",
    true,
    false,
  ),
  projection(
    "AuditRecordProjection",
    "audit",
    ["AuditRecord"],
    ["QueryAuditRecords"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "EventLogProjection",
    "observability",
    [
      "Instance",
      "Session",
      "Message",
      "MediaAsset",
      "WebhookSubscription",
      "WebhookDelivery",
      "WorkerJob",
      "AuditRecord",
      "HealthStatus",
      "TelemetrySignal",
    ],
    ["ListEvents"],
    "retention_bound",
    true,
    true,
  ),
  projection(
    "MetricsSnapshotProjection",
    "observability",
    ["TelemetrySignal", "HealthStatus", "WorkerJob", "Message", "WebhookDelivery", "MediaAsset"],
    ["GetOperationalMetricsSnapshot"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "OperationalDashboardProjection",
    "observability",
    ["HealthStatus", "WorkerJob", "TelemetrySignal", "Message", "WebhookDelivery"],
    ["GetOperationalMetricsSnapshot", "GetActionRequiredItems"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "DashboardSummaryProjection",
    "observability",
    ["HealthStatus", "TelemetrySignal", "WorkerJob", "Message", "WebhookDelivery", "Instance"],
    ["GetDashboardSummary"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "QueueMetricsProjection",
    "operations",
    ["WorkerJob", "HealthStatus"],
    ["GetQueueMetricsSnapshot"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "WebhookMetricsProjection",
    "webhook_delivery",
    ["WebhookDelivery"],
    ["GetWebhookMetricsSnapshot"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "MessageMetricsProjection",
    "messaging",
    ["Message", "WorkerJob"],
    ["GetMessageMetricsSnapshot"],
    "eventual_projection",
    true,
    false,
  ),
  projection(
    "MediaMetricsProjection",
    "media",
    ["MediaAsset", "WorkerJob"],
    ["GetMediaMetricsSnapshot"],
    "eventual_projection",
    true,
    false,
  ),
] satisfies readonly ReadProjectionDefinition[]);

export class InMemoryReadProjectionStore
  implements
    ReadModelPort<ProjectionReadQuery, unknown>,
    ProjectionWriterPort<ProjectionWriteSignal>
{
  private readonly records = new Map<string, StoredReadProjection>();

  project(
    signal: ProjectionWriteSignal,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<void>> {
    void context;

    const projectionKey = normalizeProjectionKey(signal.projectionKey);
    const definition = getReadProjectionDefinition(signal.projectionName);
    const freshness = createReadFreshness(signal);
    const storedProjection = Object.freeze({
      projectionName: signal.projectionName,
      projectionKey,
      model: signal.model,
      consistency: signal.consistency ?? definition.consistency,
      freshness,
      ...(signal.version === undefined ? {} : { version: signal.version }),
    });

    this.records.set(projectionRecordKey(signal.projectionName, projectionKey), storedProjection);

    return Promise.resolve(ok(undefined));
  }

  read(
    query: ProjectionReadQuery,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<ReadModelResult<unknown>>> {
    void context;

    const projectionKey = normalizeProjectionKey(query.projectionKey);
    const storedProjection = this.records.get(
      projectionRecordKey(query.projectionName, projectionKey),
    );

    if (storedProjection === undefined) {
      return Promise.resolve(
        err(
          createApplicationPortFailure({
            category: "unavailable",
            code: "read_projection_not_found",
            message: "Read projection is unavailable.",
            retryable: true,
            ownerContext: getReadProjectionDefinition(query.projectionName).ownerContext,
            safeMetadata: {
              projectionName: query.projectionName,
              projectionKey,
            },
          }),
        ),
      );
    }

    return Promise.resolve(
      ok({
        model: storedProjection.model,
        consistency: storedProjection.consistency,
        freshness: storedProjection.freshness,
      }),
    );
  }

  readStoredProjection(query: ProjectionReadQuery): StoredReadProjection | undefined {
    return this.records.get(
      projectionRecordKey(query.projectionName, normalizeProjectionKey(query.projectionKey)),
    );
  }

  listStoredProjections(): readonly StoredReadProjection[] {
    return Object.freeze([...this.records.values()]);
  }

  listStoredProjectionsByName(projectionName: ReadProjectionName): readonly StoredReadProjection[] {
    return Object.freeze(
      [...this.records.values()].filter(
        (projection) => projection.projectionName === projectionName,
      ),
    );
  }

  clear(): void {
    this.records.clear();
  }
}

export function createInMemoryReadProjectionStore(): InMemoryReadProjectionStore {
  return new InMemoryReadProjectionStore();
}

export function listReadProjectionDefinitions(): readonly ReadProjectionDefinition[] {
  return readProjectionDefinitions;
}

export function getReadProjectionDefinition(
  projectionName: ReadProjectionName,
): ReadProjectionDefinition {
  const definition = readProjectionDefinitions.find((entry) => entry.name === projectionName);

  if (definition === undefined) {
    throw new TypeError(`Read projection definition is missing for ${projectionName}.`);
  }

  return definition;
}

function projection(
  name: ReadProjectionName,
  ownerContext: DomainOwnerContext,
  sourceAggregates: readonly DomainAggregateType[],
  queries: readonly string[],
  consistency: ReadConsistencyLevel,
  rebuildable: boolean,
  retentionBound: boolean,
): ReadProjectionDefinition {
  return Object.freeze({
    name,
    ownerContext,
    sourceAggregates: Object.freeze([...sourceAggregates]),
    queries: Object.freeze([...queries]),
    consistency,
    rebuildable,
    retentionBound,
  });
}

function createReadFreshness(signal: ProjectionWriteSignal): ReadFreshness {
  return Object.freeze({
    stale: signal.stale ?? false,
    ...(signal.refreshedAtEpochMilliseconds === undefined
      ? {}
      : { refreshedAtEpochMilliseconds: signal.refreshedAtEpochMilliseconds }),
  });
}

function normalizeProjectionKey(projectionKey: string): string {
  const normalized = projectionKey.trim();

  if (normalized.length === 0) {
    throw new TypeError("Projection key must not be empty.");
  }

  return normalized;
}

function projectionRecordKey(projectionName: ReadProjectionName, projectionKey: string): string {
  return `${projectionName}:${projectionKey}`;
}
