import type {
  AccessDecision,
  AccessDecisionId,
  AccessDecisionRepositoryPort,
  AggregateRepositoryPort,
  AuditRecord,
  AuditRecordId,
  AuditRecordRepositoryPort,
  Chat,
  ChatId,
  ChatRepositoryPort,
  ChatStatus,
  ConfigurationSnapshot,
  ConfigurationSnapshotId,
  ConfigurationSnapshotRepositoryPort,
  Contact,
  ContactId,
  ContactRepositoryPort,
  ContactStatus,
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
  Label,
  LabelId,
  LabelRepositoryPort,
  LabelStatus,
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

type AggregateWithId<TId> = Readonly<{
  id: TId;
}>;

export class InMemoryAggregateRepository<
  TAggregate extends AggregateWithId<TId>,
  TId,
> implements AggregateRepositoryPort<TAggregate, TId> {
  private readonly records = new Map<string, TAggregate>();

  constructor(initialAggregates: readonly TAggregate[] = []) {
    for (const aggregate of initialAggregates) {
      this.saveSync(aggregate);
    }
  }

  load(id: TId): Promise<TAggregate | undefined> {
    return Promise.resolve(this.records.get(keyOf(id)));
  }

  save(aggregate: TAggregate): Promise<RepositorySaveResult> {
    this.saveSync(aggregate);
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

  private saveSync(aggregate: TAggregate): void {
    this.records.set(keyOf(aggregate.id), aggregate);
  }
}

export class InMemoryInstanceRepository
  extends InMemoryAggregateRepository<Instance, InstanceId>
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

export class InMemorySessionRepository
  extends InMemoryAggregateRepository<Session, SessionId>
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

export class InMemoryMessageRepository
  extends InMemoryAggregateRepository<Message, MessageId>
  implements MessageRepositoryPort
{
  private readonly messageIdByIdempotencyKey = new Map<string, MessageId>();

  findByStatus(status: MessageStatus): Promise<readonly Message[]> {
    return Promise.resolve(this.findAll((message) => message.status === status));
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<Message | undefined> {
    const messageId = this.messageIdByIdempotencyKey.get(keyOf(idempotencyKey));
    return Promise.resolve(messageId === undefined ? undefined : this.loadSync(messageId));
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
    this.messageIdByIdempotencyKey.set(keyOf(idempotencyKey), messageId);
  }
}

export class InMemoryMediaAssetRepository
  extends InMemoryAggregateRepository<MediaAsset, MediaId>
  implements MediaAssetRepositoryPort
{
  private readonly cleanupRequiredMediaIds = new Set<string>();

  findByStatus(status: MediaAssetStatus): Promise<readonly MediaAsset[]> {
    return Promise.resolve(this.findAll((media) => media.status === status));
  }

  findRequiringCleanup(): Promise<readonly MediaAsset[]> {
    return Promise.resolve(
      this.findAll(
        (media) =>
          media.status !== "cleaned" && this.cleanupRequiredMediaIds.has(this.keyFor(media.id)),
      ),
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
    this.cleanupRequiredMediaIds.add(this.keyFor(mediaId));
  }
}

export class InMemoryChatRepository
  extends InMemoryAggregateRepository<Chat, ChatId>
  implements ChatRepositoryPort
{
  findByInstance(instanceId: InstanceId): Promise<readonly Chat[]> {
    return Promise.resolve(this.findAll((chat) => keyOf(chat.instanceId) === keyOf(instanceId)));
  }

  findByStatus(status: ChatStatus): Promise<readonly Chat[]> {
    return Promise.resolve(this.findAll((chat) => chat.status === status));
  }

  findByJid(jid: Jid): Promise<Chat | undefined> {
    return Promise.resolve(this.list().find((chat) => keyOf(chat.jid) === keyOf(jid)));
  }

  findByLabel(labelId: LabelId): Promise<readonly Chat[]> {
    return Promise.resolve(this.findAll((chat) => chat.labelIds.includes(labelId)));
  }
}

export class InMemoryContactRepository
  extends InMemoryAggregateRepository<Contact, ContactId>
  implements ContactRepositoryPort
{
  findByInstance(instanceId: InstanceId): Promise<readonly Contact[]> {
    return Promise.resolve(
      this.findAll((contact) => keyOf(contact.instanceId) === keyOf(instanceId)),
    );
  }

  findByStatus(status: ContactStatus): Promise<readonly Contact[]> {
    return Promise.resolve(this.findAll((contact) => contact.status === status));
  }

  findByJid(jid: Jid): Promise<Contact | undefined> {
    return Promise.resolve(this.list().find((contact) => keyOf(contact.jid) === keyOf(jid)));
  }
}

export class InMemoryLabelRepository
  extends InMemoryAggregateRepository<Label, LabelId>
  implements LabelRepositoryPort
{
  findByInstance(instanceId: InstanceId): Promise<readonly Label[]> {
    return Promise.resolve(this.findAll((label) => keyOf(label.instanceId) === keyOf(instanceId)));
  }

  findByStatus(status: LabelStatus): Promise<readonly Label[]> {
    return Promise.resolve(this.findAll((label) => label.status === status));
  }
}

export class InMemoryGroupRepository
  extends InMemoryAggregateRepository<Group, GroupId>
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

export class InMemoryWebhookSubscriptionRepository
  extends InMemoryAggregateRepository<WebhookSubscription, WebhookId>
  implements WebhookSubscriptionRepositoryPort
{
  private readonly signalRefsBySubscriptionId = new Map<string, Set<string>>();

  findByStatus(status: WebhookSubscriptionStatus): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(this.findAll((subscription) => subscription.status === status));
  }

  findActiveForSignal(sourceSignalRef: string): Promise<readonly WebhookSubscription[]> {
    return Promise.resolve(
      this.findAll((subscription) => {
        const signalRefs = this.signalRefsBySubscriptionId.get(this.keyFor(subscription.id));
        return subscription.status === "active" && (signalRefs?.has(sourceSignalRef) ?? false);
      }),
    );
  }

  recordSignalSelection(webhookId: WebhookId, sourceSignalRefs: readonly string[]): void {
    this.signalRefsBySubscriptionId.set(this.keyFor(webhookId), new Set(sourceSignalRefs));
  }
}

export class InMemoryWebhookDeliveryRepository
  extends InMemoryAggregateRepository<WebhookDelivery, WebhookDeliveryId>
  implements WebhookDeliveryRepositoryPort
{
  private readonly deliveryIdByIdempotencyKey = new Map<string, WebhookDeliveryId>();

  findByStatus(status: WebhookDeliveryStatus): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(this.findAll((delivery) => delivery.status === status));
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly WebhookDelivery[]> {
    return Promise.resolve(
      this.findAll((delivery) => delivery.sourceSignalRef === sourceSignalRef),
    );
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WebhookDelivery | undefined> {
    const deliveryId = this.deliveryIdByIdempotencyKey.get(keyOf(idempotencyKey));
    return Promise.resolve(deliveryId === undefined ? undefined : this.loadSync(deliveryId));
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, deliveryId: WebhookDeliveryId): void {
    this.deliveryIdByIdempotencyKey.set(keyOf(idempotencyKey), deliveryId);
  }
}

export class InMemoryGuardrailDecisionRepository
  extends InMemoryAggregateRepository<GuardrailDecision, GuardrailDecisionId>
  implements GuardrailDecisionRepositoryPort
{
  findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined> {
    return Promise.resolve(
      this.list().find((decision) => decision.evaluatedIntentRef === evaluatedIntentRef),
    );
  }
}

export class InMemoryProviderProfileRepository
  extends InMemoryAggregateRepository<ProviderProfile, ProviderId>
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

export class InMemoryWorkerJobRepository
  extends InMemoryAggregateRepository<WorkerJob, JobId>
  implements WorkerJobRepositoryPort
{
  private readonly jobIdByIdempotencyKey = new Map<string, JobId>();

  findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.findAll((job) => job.status === status));
  }

  findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    return Promise.resolve(this.findAll((job) => job.ownerContext === ownerContext));
  }

  findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined> {
    const jobId = this.jobIdByIdempotencyKey.get(keyOf(idempotencyKey));
    return Promise.resolve(jobId === undefined ? undefined : this.loadSync(jobId));
  }

  recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): void {
    this.jobIdByIdempotencyKey.set(keyOf(idempotencyKey), jobId);
  }
}

export class InMemoryAccessDecisionRepository
  extends InMemoryAggregateRepository<AccessDecision, AccessDecisionId>
  implements AccessDecisionRepositoryPort
{
  private readonly targetContextByDecisionId = new Map<string, string>();

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
          this.targetContextByDecisionId.get(this.keyFor(decision.id)) === targetContextRef,
      ),
    );
  }

  recordTargetContext(decisionId: AccessDecisionId, targetContextRef: string): void {
    this.targetContextByDecisionId.set(this.keyFor(decisionId), targetContextRef);
  }
}

export class InMemoryAuditRecordRepository
  extends InMemoryAggregateRepository<AuditRecord, AuditRecordId>
  implements AuditRecordRepositoryPort
{
  private readonly sourceSignalByAuditRecordId = new Map<string, string>();

  findBySourceSignal(sourceSignalRef: string): Promise<readonly AuditRecord[]> {
    return Promise.resolve(
      this.findAll(
        (record) =>
          this.sourceSignalByAuditRecordId.get(this.keyFor(record.id)) === sourceSignalRef,
      ),
    );
  }

  findRetentionExpired(): Promise<readonly AuditRecord[]> {
    return Promise.resolve(this.findAll((record) => record.status === "retention_expired"));
  }

  recordSourceSignal(auditRecordId: AuditRecordId, sourceSignalRef: string): void {
    this.sourceSignalByAuditRecordId.set(this.keyFor(auditRecordId), sourceSignalRef);
  }
}

export class InMemoryHealthStatusRepository
  extends InMemoryAggregateRepository<HealthStatus, HealthStatusId>
  implements HealthStatusRepositoryPort
{
  findBySubject(subjectRef: string): Promise<HealthStatus | undefined> {
    return Promise.resolve(this.list().find((health) => health.subjectRef === subjectRef));
  }

  findByCategory(category: HealthCategory): Promise<readonly HealthStatus[]> {
    return Promise.resolve(this.findAll((health) => health.category === category));
  }
}

export class InMemoryConfigurationSnapshotRepository
  extends InMemoryAggregateRepository<ConfigurationSnapshot, ConfigurationSnapshotId>
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

export class InMemoryTelemetrySignalRepository
  extends InMemoryAggregateRepository<TelemetrySignal, TelemetrySignalId>
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

export type InMemoryRepositorySet = Readonly<{
  instanceRepository: InMemoryInstanceRepository;
  sessionRepository: InMemorySessionRepository;
  messageRepository: InMemoryMessageRepository;
  mediaAssetRepository: InMemoryMediaAssetRepository;
  chatRepository: InMemoryChatRepository;
  contactRepository: InMemoryContactRepository;
  labelRepository: InMemoryLabelRepository;
  groupRepository: InMemoryGroupRepository;
  webhookSubscriptionRepository: InMemoryWebhookSubscriptionRepository;
  webhookDeliveryRepository: InMemoryWebhookDeliveryRepository;
  guardrailDecisionRepository: InMemoryGuardrailDecisionRepository;
  providerProfileRepository: InMemoryProviderProfileRepository;
  workerJobRepository: InMemoryWorkerJobRepository;
  accessDecisionRepository: InMemoryAccessDecisionRepository;
  auditRecordRepository: InMemoryAuditRecordRepository;
  healthStatusRepository: InMemoryHealthStatusRepository;
  configurationSnapshotRepository: InMemoryConfigurationSnapshotRepository;
  telemetrySignalRepository: InMemoryTelemetrySignalRepository;
}>;

export function createInMemoryRepositorySet(): InMemoryRepositorySet {
  return Object.freeze({
    instanceRepository: new InMemoryInstanceRepository(),
    sessionRepository: new InMemorySessionRepository(),
    messageRepository: new InMemoryMessageRepository(),
    mediaAssetRepository: new InMemoryMediaAssetRepository(),
    chatRepository: new InMemoryChatRepository(),
    contactRepository: new InMemoryContactRepository(),
    labelRepository: new InMemoryLabelRepository(),
    groupRepository: new InMemoryGroupRepository(),
    webhookSubscriptionRepository: new InMemoryWebhookSubscriptionRepository(),
    webhookDeliveryRepository: new InMemoryWebhookDeliveryRepository(),
    guardrailDecisionRepository: new InMemoryGuardrailDecisionRepository(),
    providerProfileRepository: new InMemoryProviderProfileRepository(),
    workerJobRepository: new InMemoryWorkerJobRepository(),
    accessDecisionRepository: new InMemoryAccessDecisionRepository(),
    auditRecordRepository: new InMemoryAuditRecordRepository(),
    healthStatusRepository: new InMemoryHealthStatusRepository(),
    configurationSnapshotRepository: new InMemoryConfigurationSnapshotRepository(),
    telemetrySignalRepository: new InMemoryTelemetrySignalRepository(),
  });
}

function keyOf(value: unknown): string {
  return String(value);
}
