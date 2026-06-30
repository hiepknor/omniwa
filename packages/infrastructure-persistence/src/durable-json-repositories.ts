import { join } from "node:path";

import type {
  AccessDecision,
  AccessDecisionId,
  AccessDecisionRepositoryPort,
  AggregateRepositoryPort,
  AuditRecord,
  AuditRecordId,
  AuditRecordRepositoryPort,
  ConfigurationSnapshot,
  ConfigurationSnapshotId,
  ConfigurationSnapshotRepositoryPort,
  DomainOwnerContext,
  GuardrailDecision,
  GuardrailDecisionId,
  GuardrailDecisionRepositoryPort,
  Group,
  GroupId,
  GroupRepositoryPort,
  GroupStatus,
  HealthCategory,
  HealthStatus,
  HealthStatusId,
  HealthStatusRepositoryPort,
  IdempotencyKey,
  Instance,
  InstanceId,
  InstanceRepositoryPort,
  InstanceStatus,
  JobId,
  JobStatus,
  MediaAsset,
  MediaAssetRepositoryPort,
  MediaAssetStatus,
  MediaId,
  Message,
  MessageId,
  MessageRepositoryPort,
  MessageStatus,
  Jid,
  ProviderId,
  ProviderProfile,
  ProviderProfileRepositoryPort,
  ProviderProfileStatus,
  RepositorySaveResult,
  Session,
  SessionId,
  SessionRepositoryPort,
  SessionStatus,
  TelemetrySignal,
  TelemetrySignalId,
  TelemetrySignalRepositoryPort,
  WebhookDelivery,
  WebhookDeliveryId,
  WebhookDeliveryRepositoryPort,
  WebhookDeliveryStatus,
  WebhookId,
  WebhookSubscription,
  WebhookSubscriptionRepositoryPort,
  WebhookSubscriptionStatus,
  WorkerJob,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";

import { DurableJsonStateStore } from "./durable-json-state-store.js";

type AggregateWithId<TId> = Readonly<{
  id: TId;
}>;

type DurableIndexValue = string | readonly string[];

type DurableRepositoryState<TAggregate> = Readonly<{
  records: readonly TAggregate[];
  indexes: Readonly<Record<string, Readonly<Record<string, DurableIndexValue>>>>;
}>;

export class DurableJsonAggregateRepository<
  TAggregate extends AggregateWithId<TId>,
  TId,
> implements AggregateRepositoryPort<TAggregate, TId> {
  private readonly store: DurableJsonStateStore<DurableRepositoryState<TAggregate>>;
  private readonly records = new Map<string, TAggregate>();
  private readonly indexes = new Map<string, Map<string, DurableIndexValue>>();

  constructor(filePath: string, initialAggregates: readonly TAggregate[] = []) {
    this.store = new DurableJsonStateStore(filePath, () => ({
      records: initialAggregates,
      indexes: {},
    }));

    const hasExistingState = this.store.exists();
    this.loadState(this.store.read());

    if (!hasExistingState && initialAggregates.length > 0) {
      this.persist();
    }
  }

  load(id: TId): Promise<TAggregate | undefined> {
    return Promise.resolve(this.records.get(keyOf(id)));
  }

  save(aggregate: TAggregate): Promise<RepositorySaveResult> {
    this.records.set(keyOf(aggregate.id), aggregate);
    this.persist();

    return Promise.resolve({ saved: true });
  }

  exists(id: TId): Promise<boolean> {
    return Promise.resolve(this.records.has(keyOf(id)));
  }

  list(): readonly TAggregate[] {
    return Object.freeze([...this.records.values()]);
  }

  clear(): void {
    this.records.clear();
    this.indexes.clear();
    this.persist();
  }

  protected findAll(predicate: (aggregate: TAggregate) => boolean): readonly TAggregate[] {
    return Object.freeze(this.list().filter(predicate));
  }

  protected loadSync(id: TId): TAggregate | undefined {
    return this.records.get(keyOf(id));
  }

  protected keyFor(id: TId): string {
    return keyOf(id);
  }

  protected getIndexValue(indexName: string, key: string): DurableIndexValue | undefined {
    return this.indexes.get(indexName)?.get(key);
  }

  protected setIndexValue(indexName: string, key: string, value: DurableIndexValue): void {
    const index = this.indexes.get(indexName) ?? new Map<string, DurableIndexValue>();
    index.set(key, Array.isArray(value) ? Object.freeze([...value]) : value);
    this.indexes.set(indexName, index);
    this.persist();
  }

  protected getIndexEntries(indexName: string): readonly [string, DurableIndexValue][] {
    return Object.freeze([...(this.indexes.get(indexName)?.entries() ?? [])]);
  }

  private loadState(state: DurableRepositoryState<TAggregate>): void {
    this.records.clear();
    this.indexes.clear();

    for (const aggregate of state.records) {
      this.records.set(keyOf(aggregate.id), aggregate);
    }

    for (const [indexName, indexValues] of Object.entries(state.indexes)) {
      this.indexes.set(indexName, new Map(Object.entries(indexValues)));
    }
  }

  private persist(): void {
    const indexes: Record<string, Record<string, DurableIndexValue>> = {};

    for (const [indexName, indexValues] of this.indexes.entries()) {
      indexes[indexName] = Object.fromEntries(indexValues.entries());
    }

    this.store.write({
      records: this.list(),
      indexes,
    });
  }
}

export class DurableJsonInstanceRepository
  extends DurableJsonAggregateRepository<Instance, InstanceId>
  implements InstanceRepositoryPort
{
  findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    return Promise.resolve(this.findAll((instance) => instance.status === status));
  }

  findNonTerminal(): Promise<readonly Instance[]> {
    return Promise.resolve(this.findAll((instance) => instance.status !== "destroyed"));
  }

  getCurrentSessionId(instanceId: InstanceId): Promise<SessionId | undefined> {
    return Promise.resolve(this.loadSync(instanceId)?.currentSessionId);
  }
}

export class DurableJsonSessionRepository
  extends DurableJsonAggregateRepository<Session, SessionId>
  implements SessionRepositoryPort
{
  findByInstance(instanceId: InstanceId): Promise<readonly Session[]> {
    return Promise.resolve(
      this.findAll((session) => keyOf(session.instanceId) === keyOf(instanceId)),
    );
  }

  findByStatusForInstance(
    instanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return Promise.resolve(
      this.findAll(
        (session) => keyOf(session.instanceId) === keyOf(instanceId) && session.status === status,
      ),
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return Promise.resolve(this.findAll((session) => session.requiresRecovery));
  }
}

export class DurableJsonMessageRepository
  extends DurableJsonAggregateRepository<Message, MessageId>
  implements MessageRepositoryPort
{
  findByStatus(status: MessageStatus): Promise<readonly Message[]> {
    return Promise.resolve(this.findAll((message) => message.status === status));
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<Message | undefined> {
    const messageId = this.getIndexValue("idempotency", keyOf(idempotencyKey));

    return Promise.resolve(
      typeof messageId === "string" ? this.loadSync(messageId as MessageId) : undefined,
    );
  }

  findRecoverableByOwner(ownerContext: DomainOwnerContext): Promise<readonly Message[]> {
    if (ownerContext !== "messaging") {
      return Promise.resolve(Object.freeze([]));
    }

    return Promise.resolve(
      this.findAll((message) => ["queued", "processing", "failed"].includes(message.status)),
    );
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, messageId: MessageId): void {
    this.setIndexValue("idempotency", keyOf(idempotencyKey), keyOf(messageId));
  }
}

export class DurableJsonMediaAssetRepository
  extends DurableJsonAggregateRepository<MediaAsset, MediaId>
  implements MediaAssetRepositoryPort
{
  findByStatus(status: MediaAssetStatus): Promise<readonly MediaAsset[]> {
    return Promise.resolve(this.findAll((media) => media.status === status));
  }

  findRequiringCleanup(): Promise<readonly MediaAsset[]> {
    const mediaIds = new Set(this.getIndexEntries("cleanupRequired").map(([mediaId]) => mediaId));

    return Promise.resolve(
      this.findAll((media) => media.status !== "cleaned" && mediaIds.has(this.keyFor(media.id))),
    );
  }

  findByMessage(messageId: MessageId): Promise<readonly MediaAsset[]> {
    return Promise.resolve(
      this.findAll(
        (media) => media.messageId !== undefined && keyOf(media.messageId) === keyOf(messageId),
      ),
    );
  }

  markRequiringCleanup(mediaId: MediaId): void {
    this.setIndexValue("cleanupRequired", this.keyFor(mediaId), "true");
  }
}

export class DurableJsonGroupRepository
  extends DurableJsonAggregateRepository<Group, GroupId>
  implements GroupRepositoryPort
{
  findByInstance(instanceId: InstanceId): Promise<readonly Group[]> {
    return Promise.resolve(this.findAll((group) => keyOf(group.instanceId) === keyOf(instanceId)));
  }

  findByStatus(status: GroupStatus): Promise<readonly Group[]> {
    return Promise.resolve(this.findAll((group) => group.status === status));
  }

  findByJid(jid: Jid): Promise<Group | undefined> {
    return Promise.resolve(this.list().find((group) => keyOf(group.jid) === keyOf(jid)));
  }
}

export class DurableJsonWebhookSubscriptionRepository
  extends DurableJsonAggregateRepository<WebhookSubscription, WebhookId>
  implements WebhookSubscriptionRepositoryPort
{
  findByStatus(status: WebhookSubscriptionStatus): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(this.findAll((subscription) => subscription.status === status));
  }

  findActiveForSignal(sourceSignalRef: string): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(
      this.findAll((subscription) => {
        const signalRefs = this.getIndexValue("signalRefs", this.keyFor(subscription.id));

        return (
          subscription.status === "active" &&
          Array.isArray(signalRefs) &&
          signalRefs.includes(sourceSignalRef)
        );
      }),
    );
  }

  recordSignalSelection(webhookId: WebhookId, sourceSignalRefs: readonly string[]): void {
    this.setIndexValue("signalRefs", this.keyFor(webhookId), sourceSignalRefs);
  }
}

export class DurableJsonWebhookDeliveryRepository
  extends DurableJsonAggregateRepository<WebhookDelivery, WebhookDeliveryId>
  implements WebhookDeliveryRepositoryPort
{
  findByStatus(status: WebhookDeliveryStatus): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(this.findAll((delivery) => delivery.status === status));
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(
      this.findAll((delivery) => delivery.sourceSignalRef === sourceSignalRef),
    );
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WebhookDelivery | undefined> {
    const deliveryId = this.getIndexValue("idempotency", keyOf(idempotencyKey));

    return Promise.resolve(
      typeof deliveryId === "string" ? this.loadSync(deliveryId as WebhookDeliveryId) : undefined,
    );
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, deliveryId: WebhookDeliveryId): void {
    this.setIndexValue("idempotency", keyOf(idempotencyKey), keyOf(deliveryId));
  }
}

export class DurableJsonGuardrailDecisionRepository
  extends DurableJsonAggregateRepository<GuardrailDecision, GuardrailDecisionId>
  implements GuardrailDecisionRepositoryPort
{
  findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(
      this.list().find((decision) => decision.evaluatedIntentRef === evaluatedIntentRef),
    );
  }
}

export class DurableJsonProviderProfileRepository
  extends DurableJsonAggregateRepository<ProviderProfile, ProviderId>
  implements ProviderProfileRepositoryPort
{
  findByStatus(status: ProviderProfileStatus): Promise<readonly ProviderProfile[]> {
    return Promise.resolve(this.findAll((profile) => profile.status === status));
  }

  findSupportedOrDegraded(): Promise<readonly ProviderProfile[]> {
    return Promise.resolve(
      this.findAll((profile) => profile.status === "supported" || profile.status === "degraded"),
    );
  }
}

export class DurableJsonWorkerJobRepository
  extends DurableJsonAggregateRepository<WorkerJob, JobId>
  implements WorkerJobRepositoryPort
{
  findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.findAll((job) => job.status === status));
  }

  findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.findAll((job) => job.ownerContext === ownerContext));
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined> {
    const jobId = this.getIndexValue("idempotency", keyOf(idempotencyKey));

    return Promise.resolve(typeof jobId === "string" ? this.loadSync(jobId as JobId) : undefined);
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): void {
    this.setIndexValue("idempotency", keyOf(idempotencyKey), keyOf(jobId));
  }
}

export class DurableJsonAccessDecisionRepository
  extends DurableJsonAggregateRepository<AccessDecision, AccessDecisionId>
  implements AccessDecisionRepositoryPort
{
  findUnexpiredByCapability(
    actorRef: string,
    capability: string,
    targetContextRef: string,
  ): Promise<AccessDecision | undefined> {
    return Promise.resolve(
      this.list().find(
        (decision) =>
          decision.status !== "expired" &&
          decision.actorRef === actorRef &&
          decision.capability === capability &&
          this.getIndexValue("targetContext", this.keyFor(decision.id)) === targetContextRef,
      ),
    );
  }

  recordTargetContext(decisionId: AccessDecisionId, targetContextRef: string): void {
    this.setIndexValue("targetContext", this.keyFor(decisionId), targetContextRef);
  }
}

export class DurableJsonAuditRecordRepository
  extends DurableJsonAggregateRepository<AuditRecord, AuditRecordId>
  implements AuditRecordRepositoryPort
{
  findBySourceSignal(sourceSignalRef: string): Promise<readonly AuditRecord[]> {
    return Promise.resolve(
      this.findAll(
        (record) => this.getIndexValue("sourceSignal", this.keyFor(record.id)) === sourceSignalRef,
      ),
    );
  }

  findRetentionExpired(): Promise<readonly AuditRecord[]> {
    return Promise.resolve(this.findAll((record) => record.status === "retention_expired"));
  }

  recordSourceSignal(auditRecordId: AuditRecordId, sourceSignalRef: string): void {
    this.setIndexValue("sourceSignal", this.keyFor(auditRecordId), sourceSignalRef);
  }
}

export class DurableJsonHealthStatusRepository
  extends DurableJsonAggregateRepository<HealthStatus, HealthStatusId>
  implements HealthStatusRepositoryPort
{
  findBySubject(subjectRef: string): Promise<HealthStatus | undefined> {
    return Promise.resolve(this.list().find((health) => health.subjectRef === subjectRef));
  }

  findByCategory(category: HealthCategory): Promise<readonly HealthStatus[]> {
    return Promise.resolve(this.findAll((health) => health.category === category));
  }
}

export class DurableJsonConfigurationSnapshotRepository
  extends DurableJsonAggregateRepository<ConfigurationSnapshot, ConfigurationSnapshotId>
  implements ConfigurationSnapshotRepositoryPort
{
  findActive(): Promise<ConfigurationSnapshot | undefined> {
    return Promise.resolve(this.list().find((snapshot) => snapshot.status === "active"));
  }

  findRejectedGuardrailBypass(): Promise<readonly ConfigurationSnapshot[]> {
    return Promise.resolve(
      this.findAll(
        (snapshot) =>
          snapshot.status === "rejected" && snapshot.safety === "guardrail_bypass_rejected",
      ),
    );
  }
}

export class DurableJsonTelemetrySignalRepository
  extends DurableJsonAggregateRepository<TelemetrySignal, TelemetrySignalId>
  implements TelemetrySignalRepositoryPort
{
  findCaptured(): Promise<readonly TelemetrySignal[]> {
    return Promise.resolve(this.findAll((signal) => signal.status === "captured"));
  }

  findDroppedBySource(sourceContextRef: string): Promise<readonly TelemetrySignal[]> {
    return Promise.resolve(
      this.findAll(
        (signal) => signal.status === "dropped" && signal.sourceContextRef === sourceContextRef,
      ),
    );
  }
}

export type DurableJsonRepositorySet = Readonly<{
  instanceRepository: DurableJsonInstanceRepository;
  sessionRepository: DurableJsonSessionRepository;
  messageRepository: DurableJsonMessageRepository;
  mediaAssetRepository: DurableJsonMediaAssetRepository;
  groupRepository: DurableJsonGroupRepository;
  webhookSubscriptionRepository: DurableJsonWebhookSubscriptionRepository;
  webhookDeliveryRepository: DurableJsonWebhookDeliveryRepository;
  guardrailDecisionRepository: DurableJsonGuardrailDecisionRepository;
  providerProfileRepository: DurableJsonProviderProfileRepository;
  workerJobRepository: DurableJsonWorkerJobRepository;
  accessDecisionRepository: DurableJsonAccessDecisionRepository;
  auditRecordRepository: DurableJsonAuditRecordRepository;
  healthStatusRepository: DurableJsonHealthStatusRepository;
  configurationSnapshotRepository: DurableJsonConfigurationSnapshotRepository;
  telemetrySignalRepository: DurableJsonTelemetrySignalRepository;
}>;

export function createDurableJsonRepositorySet(baseDirectory: string): DurableJsonRepositorySet {
  return Object.freeze({
    instanceRepository: new DurableJsonInstanceRepository(join(baseDirectory, "instances.json")),
    sessionRepository: new DurableJsonSessionRepository(join(baseDirectory, "sessions.json")),
    messageRepository: new DurableJsonMessageRepository(join(baseDirectory, "messages.json")),
    mediaAssetRepository: new DurableJsonMediaAssetRepository(
      join(baseDirectory, "media-assets.json"),
    ),
    groupRepository: new DurableJsonGroupRepository(join(baseDirectory, "groups.json")),
    webhookSubscriptionRepository: new DurableJsonWebhookSubscriptionRepository(
      join(baseDirectory, "webhook-subscriptions.json"),
    ),
    webhookDeliveryRepository: new DurableJsonWebhookDeliveryRepository(
      join(baseDirectory, "webhook-deliveries.json"),
    ),
    guardrailDecisionRepository: new DurableJsonGuardrailDecisionRepository(
      join(baseDirectory, "guardrail-decisions.json"),
    ),
    providerProfileRepository: new DurableJsonProviderProfileRepository(
      join(baseDirectory, "provider-profiles.json"),
    ),
    workerJobRepository: new DurableJsonWorkerJobRepository(
      join(baseDirectory, "worker-jobs.json"),
    ),
    accessDecisionRepository: new DurableJsonAccessDecisionRepository(
      join(baseDirectory, "access-decisions.json"),
    ),
    auditRecordRepository: new DurableJsonAuditRecordRepository(
      join(baseDirectory, "audit-records.json"),
    ),
    healthStatusRepository: new DurableJsonHealthStatusRepository(
      join(baseDirectory, "health-statuses.json"),
    ),
    configurationSnapshotRepository: new DurableJsonConfigurationSnapshotRepository(
      join(baseDirectory, "configuration-snapshots.json"),
    ),
    telemetrySignalRepository: new DurableJsonTelemetrySignalRepository(
      join(baseDirectory, "telemetry-signals.json"),
    ),
  });
}

function keyOf(value: unknown): string {
  return String(value);
}
