import type { AuditRecord } from "../audit/audit-record.js";
import type { ConfigurationSnapshot } from "../configuration/configuration-snapshot.js";
import type { DomainOwnerContext } from "../errors/domain-owner-context.js";
import type { GuardrailDecision } from "../guardrails/guardrail-decision.js";
import type { Group } from "../group/group.js";
import type { HealthStatus } from "../health/health-status.js";
import type {
  AccessDecisionId,
  AuditRecordId,
  ConfigurationSnapshotId,
  GuardrailDecisionId,
  GroupId,
  HealthStatusId,
  InstanceId,
  JobId,
  MediaId,
  MessageId,
  ProviderId,
  SessionId,
  TelemetrySignalId,
  WebhookDeliveryId,
  WebhookId,
} from "../identity/aggregate-ids.js";
import type { IdempotencyKey } from "../idempotency/idempotency-key.js";
import type { Instance } from "../instance/instance.js";
import type { Jid } from "../references/jid.js";
import type { MediaAsset } from "../media/media-asset.js";
import type { Message } from "../messaging/message.js";
import type { TelemetrySignal } from "../observability/telemetry-signal.js";
import type { WorkerJob } from "../operations/worker-job.js";
import type { ProviderProfile } from "../provider/provider-profile.js";
import type { AccessDecision } from "../security/access-decision.js";
import type { Session } from "../session/session.js";
import type { HealthCategory } from "../status/health-category.js";
import type { GroupStatus } from "../status/group-status.js";
import type { InstanceStatus } from "../status/instance-status.js";
import type { JobStatus } from "../status/job-status.js";
import type { MediaAssetStatus } from "../status/media-asset-status.js";
import type { MessageStatus } from "../status/message-status.js";
import type { ProviderProfileStatus } from "../status/provider-profile-status.js";
import type { SessionStatus } from "../status/session-status.js";
import type { WebhookDeliveryStatus } from "../status/webhook-delivery-status.js";
import type { WebhookSubscriptionStatus } from "../status/webhook-subscription-status.js";
import type { WebhookDelivery } from "../webhook/webhook-delivery.js";
import type { WebhookSubscription } from "../webhook/webhook-subscription.js";

export type RepositorySaveResult = Readonly<{
  saved: true;
}>;

export interface AggregateRepositoryPort<TAggregate, TId> {
  load(id: TId): Promise<TAggregate | undefined>;
  save(aggregate: TAggregate): Promise<RepositorySaveResult>;
  exists(id: TId): Promise<boolean>;
}

export interface InstanceRepositoryPort extends AggregateRepositoryPort<Instance, InstanceId> {
  findByStatus(status: InstanceStatus): Promise<readonly Instance[]>;
  findNonTerminal(): Promise<readonly Instance[]>;
  getCurrentSessionId(instanceId: InstanceId): Promise<SessionId | undefined>;
}

export interface SessionRepositoryPort extends AggregateRepositoryPort<Session, SessionId> {
  findByInstance(instanceId: InstanceId): Promise<readonly Session[]>;
  findByStatusForInstance(
    instanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]>;
  findRecoveryRequired(): Promise<readonly Session[]>;
}

export interface MessageRepositoryPort extends AggregateRepositoryPort<Message, MessageId> {
  findByStatus(status: MessageStatus): Promise<readonly Message[]>;
  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<Message | undefined>;
  findRecoverableByOwner(ownerContext: DomainOwnerContext): Promise<readonly Message[]>;
}

export interface MediaAssetRepositoryPort extends AggregateRepositoryPort<MediaAsset, MediaId> {
  findByStatus(status: MediaAssetStatus): Promise<readonly MediaAsset[]>;
  findRequiringCleanup(): Promise<readonly MediaAsset[]>;
  findByMessage(messageId: MessageId): Promise<readonly MediaAsset[]>;
}

export interface GroupRepositoryPort extends AggregateRepositoryPort<Group, GroupId> {
  findByInstance(instanceId: InstanceId): Promise<readonly Group[]>;
  findByStatus(status: GroupStatus): Promise<readonly Group[]>;
  findByJid(jid: Jid): Promise<Group | undefined>;
}

export interface WebhookSubscriptionRepositoryPort extends AggregateRepositoryPort<
  WebhookSubscription,
  WebhookId
> {
  findByStatus(status: WebhookSubscriptionStatus): Promise<readonly WebhookSubscription[]>;
  findActiveForSignal(sourceSignalRef: string): Promise<readonly WebhookSubscription[]>;
}

export interface WebhookDeliveryRepositoryPort extends AggregateRepositoryPort<
  WebhookDelivery,
  WebhookDeliveryId
> {
  findByStatus(status: WebhookDeliveryStatus): Promise<readonly WebhookDelivery[]>;
  findBySourceSignal(sourceSignalRef: string): Promise<readonly WebhookDelivery[]>;
  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WebhookDelivery | undefined>;
}

export interface GuardrailDecisionRepositoryPort extends AggregateRepositoryPort<
  GuardrailDecision,
  GuardrailDecisionId
> {
  findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined>;
}

export interface ProviderProfileRepositoryPort extends AggregateRepositoryPort<
  ProviderProfile,
  ProviderId
> {
  findByStatus(status: ProviderProfileStatus): Promise<readonly ProviderProfile[]>;
  findSupportedOrDegraded(): Promise<readonly ProviderProfile[]>;
}

export interface WorkerJobRepositoryPort extends AggregateRepositoryPort<WorkerJob, JobId> {
  findByStatus(status: JobStatus): Promise<readonly WorkerJob[]>;
  findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]>;
  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined>;
}

export interface AccessDecisionRepositoryPort extends AggregateRepositoryPort<
  AccessDecision,
  AccessDecisionId
> {
  findUnexpiredByCapability(
    actorRef: string,
    capability: string,
    targetContextRef: string,
  ): Promise<AccessDecision | undefined>;
}

export interface AuditRecordRepositoryPort extends AggregateRepositoryPort<
  AuditRecord,
  AuditRecordId
> {
  findBySourceSignal(sourceSignalRef: string): Promise<readonly AuditRecord[]>;
  findRetentionExpired(): Promise<readonly AuditRecord[]>;
}

export interface HealthStatusRepositoryPort extends AggregateRepositoryPort<
  HealthStatus,
  HealthStatusId
> {
  findBySubject(subjectRef: string): Promise<HealthStatus | undefined>;
  findByCategory(category: HealthCategory): Promise<readonly HealthStatus[]>;
}

export interface ConfigurationSnapshotRepositoryPort extends AggregateRepositoryPort<
  ConfigurationSnapshot,
  ConfigurationSnapshotId
> {
  findActive(): Promise<ConfigurationSnapshot | undefined>;
  findRejectedGuardrailBypass(): Promise<readonly ConfigurationSnapshot[]>;
}

export interface TelemetrySignalRepositoryPort extends AggregateRepositoryPort<
  TelemetrySignal,
  TelemetrySignalId
> {
  findCaptured(): Promise<readonly TelemetrySignal[]>;
  findDroppedBySource(sourceContextRef: string): Promise<readonly TelemetrySignal[]>;
}
