import {
  createDomainEvent,
  createAttemptNumber,
  createDeadLetterReason,
  createDomainOwnerContext,
  createFailureCategory,
  createInstanceId,
  createInstanceStatus,
  createIdempotencyKey,
  createJobId,
  createJobStatus,
  createChatStatus,
  createContactStatus,
  createLabelStatus,
  createMediaAssetStatus,
  createMessageDirection,
  createMessageId,
  createMessageStatus,
  createMessageType,
  createMediaId,
  createGroupStatus,
  createHealthCategory,
  createGuardrailDecisionId,
  createRetryPolicy,
  createRetentionPolicy,
  createSessionId,
  createSessionStatus,
  createWebhookDeliveryId,
  createWebhookDeliveryStatus,
  createWebhookId,
  createWebhookSubscriptionStatus,
  createWebhookUrl,
  createWorkerJobSafeMetadata,
  type AuditRecord,
  type AuditRecordId,
  type AuditRecordRepositoryPort,
  type Chat,
  type ChatId,
  type ChatRepositoryPort,
  type ChatStatus,
  type Contact,
  type ContactId,
  type ContactRepositoryPort,
  type ContactStatus,
  type DomainEvent,
  type DomainOwnerContext,
  type Group,
  type GroupId,
  type GroupRepositoryPort,
  type GroupStatus,
  type GuardrailDecision,
  type GuardrailDecisionId,
  type GuardrailDecisionRepositoryPort,
  type HealthCategory,
  type HealthStatus,
  type HealthStatusId,
  type HealthStatusRepositoryPort,
  type IdempotencyKey,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type JobId,
  type JobStatus,
  type Label,
  type LabelId,
  type LabelRepositoryPort,
  type LabelStatus,
  type MediaAsset,
  type MediaAssetRepositoryPort,
  type MediaAssetStatus,
  type MediaId,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type MessageStatus,
  type Jid,
  type Session,
  type SessionId,
  type SessionRepositoryPort,
  type SessionStatus,
  type WebhookDelivery,
  type WebhookDeliveryId,
  type WebhookDeliveryRepositoryPort,
  type WebhookDeliveryStatus,
  type WebhookId,
  type WebhookSubscription,
  type WebhookSubscriptionRepositoryPort,
  type WebhookSubscriptionStatus,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";
import {
  PostgresqlAggregateRepository,
  type PostgresqlQueryExecutor,
} from "./postgresql-aggregate-repository.js";

export type { PostgresqlQueryExecutor } from "./postgresql-aggregate-repository.js";

export type PostgresqlTransactionClient = PostgresqlQueryExecutor &
  Readonly<{
    release(): void;
  }>;

export type PostgresqlConnection = PostgresqlQueryExecutor &
  Readonly<{
    connect(): Promise<PostgresqlTransactionClient>;
    end?(): Promise<void>;
  }>;

export type PostgresqlSqlMigration = Readonly<{
  id: string;
  description: string;
  statements: readonly string[];
}>;

export type PostgresqlSqlMigrationRunResult = Readonly<{
  appliedMigrationIds: readonly string[];
  skippedMigrationIds: readonly string[];
}>;

export type PostgresqlSqlMigrationStatus = Readonly<{
  totalMigrationIds: readonly string[];
  appliedMigrationIds: readonly string[];
  pendingMigrationIds: readonly string[];
  unknownAppliedMigrationIds: readonly string[];
}>;

export type PostgresqlRepositorySetOptions = Readonly<{
  autoMigrate?: boolean;
}>;

export type PostgresqlRepositorySet = Readonly<{
  chatRepository: PostgresqlChatRepository;
  contactRepository: PostgresqlContactRepository;
  groupRepository: PostgresqlGroupRepository;
  guardrailDecisionRepository: PostgresqlGuardrailDecisionRepository;
  healthStatusRepository: PostgresqlHealthStatusRepository;
  instanceRepository: PostgresqlInstanceRepository;
  labelRepository: PostgresqlLabelRepository;
  mediaAssetRepository: PostgresqlMediaAssetRepository;
  messageRepository: PostgresqlMessageRepository;
  sessionRepository: PostgresqlSessionRepository;
  webhookDeliveryRepository: PostgresqlWebhookDeliveryRepository;
  webhookSubscriptionRepository: PostgresqlWebhookSubscriptionRepository;
  workerJobRepository: PostgresqlWorkerJobRepository;
  auditRecordRepository: PostgresqlAuditRecordRepository;
}>;

export const postgresqlRepositoryMigrations = Object.freeze([
  Object.freeze({
    id: "pgm_20260702_0001_instance_repository",
    description: "Create PostgreSQL source-state storage for InstanceRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_instances (
        id text PRIMARY KEY,
        status text NOT NULL,
        current_session_id text NULL,
        action_required_reason text NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_instances_status_idx ON omniwa_instances (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_instances_non_terminal_idx ON omniwa_instances (status) WHERE status <> 'destroyed'",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260702_0002_worker_job_repository",
    description: "Create PostgreSQL source-state storage for WorkerJobRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_worker_jobs (
        id text PRIMARY KEY,
        status text NOT NULL,
        owner_context text NOT NULL,
        work_type text NOT NULL,
        idempotency_key text NULL UNIQUE,
        queue_visible_at_epoch_ms bigint NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_status_idx ON omniwa_worker_jobs (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_owner_context_idx ON omniwa_worker_jobs (owner_context)",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_work_type_idx ON omniwa_worker_jobs (work_type)",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_reservable_idx ON omniwa_worker_jobs (work_type, status, queue_visible_at_epoch_ms)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0003_message_repository",
    description: "Create PostgreSQL source-state storage for MessageRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_messages (
        id text PRIMARY KEY,
        status text NOT NULL,
        idempotency_key text NULL UNIQUE,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_messages_status_idx ON omniwa_messages (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_messages_recoverable_messaging_idx ON omniwa_messages (status) WHERE status IN ('queued', 'processing', 'failed')",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0004_session_repository",
    description: "Create PostgreSQL source-state storage for SessionRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_sessions (
        id text PRIMARY KEY,
        instance_id text NOT NULL,
        status text NOT NULL,
        requires_recovery boolean NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_sessions_instance_id_idx ON omniwa_sessions (instance_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_sessions_instance_status_idx ON omniwa_sessions (instance_id, status)",
      "CREATE INDEX IF NOT EXISTS omniwa_sessions_recovery_required_idx ON omniwa_sessions (requires_recovery) WHERE requires_recovery = true",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0005_webhook_subscription_repository",
    description: "Create PostgreSQL source-state storage for WebhookSubscriptionRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_webhook_subscriptions (
        id text PRIMARY KEY,
        status text NOT NULL,
        signal_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_webhook_subscriptions_status_idx ON omniwa_webhook_subscriptions (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_webhook_subscriptions_signal_refs_idx ON omniwa_webhook_subscriptions USING gin (signal_refs)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0006_webhook_delivery_repository",
    description: "Create PostgreSQL source-state storage for WebhookDeliveryRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_webhook_deliveries (
        id text PRIMARY KEY,
        status text NOT NULL,
        source_signal_ref text NOT NULL,
        idempotency_key text NULL UNIQUE,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_webhook_deliveries_status_idx ON omniwa_webhook_deliveries (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_webhook_deliveries_source_signal_ref_idx ON omniwa_webhook_deliveries (source_signal_ref)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0007_chat_repository",
    description: "Create PostgreSQL projection storage for ChatRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_chats (
        id text PRIMARY KEY,
        instance_id text NOT NULL,
        status text NOT NULL,
        jid text NOT NULL,
        label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_chats_instance_id_idx ON omniwa_chats (instance_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_chats_status_idx ON omniwa_chats (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_chats_jid_idx ON omniwa_chats (jid)",
      "CREATE INDEX IF NOT EXISTS omniwa_chats_label_ids_idx ON omniwa_chats USING gin (label_ids)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0008_contact_repository",
    description: "Create PostgreSQL projection storage for ContactRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_contacts (
        id text PRIMARY KEY,
        instance_id text NOT NULL,
        status text NOT NULL,
        jid text NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_contacts_instance_id_idx ON omniwa_contacts (instance_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_contacts_status_idx ON omniwa_contacts (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_contacts_jid_idx ON omniwa_contacts (jid)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0009_group_repository",
    description: "Create PostgreSQL projection storage for GroupRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_groups (
        id text PRIMARY KEY,
        instance_id text NOT NULL,
        status text NOT NULL,
        jid text NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_groups_instance_id_idx ON omniwa_groups (instance_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_groups_status_idx ON omniwa_groups (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_groups_jid_idx ON omniwa_groups (jid)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0010_guardrail_decision_repository",
    description: "Create PostgreSQL source-state storage for GuardrailDecisionRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_guardrail_decisions (
        id text PRIMARY KEY,
        evaluated_intent_ref text NOT NULL,
        status text NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_guardrail_decisions_evaluated_intent_ref_idx ON omniwa_guardrail_decisions (evaluated_intent_ref)",
      "CREATE INDEX IF NOT EXISTS omniwa_guardrail_decisions_status_idx ON omniwa_guardrail_decisions (status)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260704_0011_health_status_repository",
    description: "Create PostgreSQL projection storage for HealthStatusRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_health_statuses (
        id text PRIMARY KEY,
        subject_ref text NOT NULL,
        category text NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_health_statuses_subject_ref_idx ON omniwa_health_statuses (subject_ref)",
      "CREATE INDEX IF NOT EXISTS omniwa_health_statuses_category_idx ON omniwa_health_statuses (category)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260705_0012_audit_record_repository",
    description: "Create PostgreSQL source-state storage for AuditRecordRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_audit_records (
        id text PRIMARY KEY,
        audit_category text NOT NULL,
        status text NOT NULL,
        source_signal_ref text NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_audit_records_audit_category_idx ON omniwa_audit_records (audit_category)",
      "CREATE INDEX IF NOT EXISTS omniwa_audit_records_status_idx ON omniwa_audit_records (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_audit_records_source_signal_ref_idx ON omniwa_audit_records (source_signal_ref)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260705_0013_label_repository",
    description: "Create PostgreSQL projection storage for LabelRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_labels (
        id text PRIMARY KEY,
        instance_id text NOT NULL,
        status text NOT NULL,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_labels_instance_id_idx ON omniwa_labels (instance_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_labels_status_idx ON omniwa_labels (status)",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260705_0014_media_asset_repository",
    description: "Create PostgreSQL source-state storage for MediaAssetRepositoryPort.",
    statements: Object.freeze([
      `CREATE TABLE IF NOT EXISTS omniwa_media_assets (
        id text PRIMARY KEY,
        status text NOT NULL,
        message_id text NULL,
        cleanup_required boolean NOT NULL DEFAULT false,
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_media_assets_status_idx ON omniwa_media_assets (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_media_assets_message_id_idx ON omniwa_media_assets (message_id)",
      "CREATE INDEX IF NOT EXISTS omniwa_media_assets_cleanup_required_idx ON omniwa_media_assets (cleanup_required) WHERE cleanup_required = true AND status <> 'cleaned'",
    ]),
  }),
  Object.freeze({
    id: "pgm_20260705_0015_worker_job_queue_visibility",
    description:
      "Add durable queue visibility metadata for WorkerJobRepositoryPort reservations.",
    statements: Object.freeze([
      "ALTER TABLE omniwa_worker_jobs ADD COLUMN IF NOT EXISTS queue_visible_at_epoch_ms bigint NULL",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_reservable_idx ON omniwa_worker_jobs (work_type, status, queue_visible_at_epoch_ms)",
    ]),
  }),
]) satisfies readonly PostgresqlSqlMigration[];

export const postgresqlInstanceRepositoryMigrations = postgresqlRepositoryMigrations;

const schemaMigrationTableSql = `CREATE TABLE IF NOT EXISTS omniwa_schema_migrations (
  id text PRIMARY KEY,
  description text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

export class PostgresqlConnectionPool implements PostgresqlConnection {
  private readonly pool: Pool;

  constructor(config: PoolConfig | string) {
    this.pool =
      typeof config === "string"
        ? new Pool({
            connectionString: config,
          })
        : new Pool(config);
  }

  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>> {
    return values === undefined
      ? this.pool.query<TRow>(text)
      : this.pool.query<TRow>(text, [...values]);
  }

  async connect(): Promise<PostgresqlTransactionClient> {
    return this.pool.connect();
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresqlConnectionPool(config: PoolConfig | string): PostgresqlConnection {
  return new PostgresqlConnectionPool(config);
}

export async function runPostgresqlSqlMigrations(
  connection: PostgresqlConnection,
  migrations: readonly PostgresqlSqlMigration[] = postgresqlRepositoryMigrations,
): Promise<PostgresqlSqlMigrationRunResult> {
  const client = await connection.connect();
  const appliedMigrationIds: string[] = [];
  const skippedMigrationIds: string[] = [];

  try {
    await client.query(schemaMigrationTableSql);

    for (const migration of migrations) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM omniwa_schema_migrations WHERE id = $1",
        [migration.id],
      );

      if (existing.rowCount !== null && existing.rowCount > 0) {
        skippedMigrationIds.push(migration.id);
        continue;
      }

      await client.query("BEGIN");

      try {
        for (const statement of migration.statements) {
          await client.query(statement);
        }

        await client.query(
          "INSERT INTO omniwa_schema_migrations (id, description) VALUES ($1, $2)",
          [migration.id, migration.description],
        );
        await client.query("COMMIT");
        appliedMigrationIds.push(migration.id);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }

  return Object.freeze({
    appliedMigrationIds: Object.freeze(appliedMigrationIds),
    skippedMigrationIds: Object.freeze(skippedMigrationIds),
  });
}

export async function getPostgresqlSqlMigrationStatus(
  connection: PostgresqlConnection,
  migrations: readonly PostgresqlSqlMigration[] = postgresqlRepositoryMigrations,
): Promise<PostgresqlSqlMigrationStatus> {
  const totalMigrationIds = migrations.map((migration) => migration.id);
  const expectedMigrationIds = new Set(totalMigrationIds);
  const appliedMigrationIds = await findAppliedPostgresqlSqlMigrationIds(connection);
  const appliedMigrationIdSet = new Set(appliedMigrationIds);

  return Object.freeze({
    totalMigrationIds: Object.freeze(totalMigrationIds),
    appliedMigrationIds: Object.freeze(
      totalMigrationIds.filter((migrationId) => appliedMigrationIdSet.has(migrationId)),
    ),
    pendingMigrationIds: Object.freeze(
      totalMigrationIds.filter((migrationId) => !appliedMigrationIdSet.has(migrationId)),
    ),
    unknownAppliedMigrationIds: Object.freeze(
      appliedMigrationIds.filter((migrationId) => !expectedMigrationIds.has(migrationId)),
    ),
  });
}

export function createPostgresqlRepositorySet(
  connection: PostgresqlConnection,
  options: PostgresqlRepositorySetOptions = {},
): PostgresqlRepositorySet {
  const migrationBarrier = options.autoMigrate
    ? createPostgresqlMigrationBarrier(connection)
    : undefined;

  return Object.freeze({
    chatRepository: new PostgresqlChatRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    contactRepository: new PostgresqlContactRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    groupRepository: new PostgresqlGroupRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    guardrailDecisionRepository: new PostgresqlGuardrailDecisionRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    healthStatusRepository: new PostgresqlHealthStatusRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    instanceRepository: new PostgresqlInstanceRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    labelRepository: new PostgresqlLabelRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    mediaAssetRepository: new PostgresqlMediaAssetRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    messageRepository: new PostgresqlMessageRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    sessionRepository: new PostgresqlSessionRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    webhookDeliveryRepository: new PostgresqlWebhookDeliveryRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    webhookSubscriptionRepository: new PostgresqlWebhookSubscriptionRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    workerJobRepository: new PostgresqlWorkerJobRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    auditRecordRepository: new PostgresqlAuditRecordRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
  });
}

export type PostgresqlInstanceRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlInstanceRepository
  extends PostgresqlAggregateRepository<Instance, InstanceId>
  implements InstanceRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlInstanceRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_instances",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (instance: Instance) => instance.status,
        }),
        Object.freeze({
          name: "current_session_id",
          value: (instance: Instance) => optionalNullable(instance.currentSessionId),
        }),
        Object.freeze({
          name: "action_required_reason",
          value: (instance: Instance) => optionalNullable(instance.actionRequiredReason),
        }),
      ]),
      decode: decodeInstanceAggregate,
      getId: (instance) => keyOf(instance.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  async findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_instances WHERE status = $1 ORDER BY id ASC",
      [createInstanceStatus(status)],
    );
  }

  async findNonTerminal(): Promise<readonly Instance[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_instances WHERE status <> $1 ORDER BY id ASC",
      ["destroyed"],
    );
  }

  async getCurrentSessionId(instanceId: InstanceId): Promise<SessionId | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<{ current_session_id: string | null }>(
      "SELECT current_session_id FROM omniwa_instances WHERE id = $1",
      [keyOf(instanceId)],
    );
    const value = result.rows[0]?.current_session_id;

    return value === undefined || value === null ? undefined : createSessionId(value);
  }
}

export type PostgresqlWorkerJobRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export type PostgresqlMessageRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export type PostgresqlSessionRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export type PostgresqlWebhookSubscriptionRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export type PostgresqlChatRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlChatRepository
  extends PostgresqlAggregateRepository<Chat, ChatId>
  implements ChatRepositoryPort
{
  constructor(connection: PostgresqlQueryExecutor, options: PostgresqlChatRepositoryOptions = {}) {
    super(connection, {
      tableName: "omniwa_chats",
      columns: Object.freeze([
        Object.freeze({
          name: "instance_id",
          value: (chat: Chat) => keyOf(chat.instanceId),
        }),
        Object.freeze({
          name: "status",
          value: (chat: Chat) => chat.status,
        }),
        Object.freeze({
          name: "jid",
          value: (chat: Chat) => keyOf(chat.jid),
        }),
        Object.freeze({
          name: "label_ids",
          value: (chat: Chat) => JSON.stringify(chat.labelIds.map(keyOf)),
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<Chat>(value, "Chat"),
      getId: (chat) => keyOf(chat.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Chat[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_chats WHERE instance_id = $1 ORDER BY id ASC",
      [keyOf(instanceId)],
    );
  }

  findByStatus(status: ChatStatus): Promise<readonly Chat[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_chats WHERE status = $1 ORDER BY id ASC",
      [createChatStatus(status)],
    );
  }

  async findByJid(jid: Jid): Promise<Chat | undefined> {
    const matches = await this.findManyBySql(
      "SELECT aggregate FROM omniwa_chats WHERE jid = $1 ORDER BY id ASC LIMIT 1",
      [keyOf(jid)],
    );

    return matches[0];
  }

  findByLabel(labelId: LabelId): Promise<readonly Chat[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_chats WHERE label_ids @> $1::jsonb ORDER BY id ASC",
      [JSON.stringify([keyOf(labelId)])],
    );
  }
}

export type PostgresqlContactRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlContactRepository
  extends PostgresqlAggregateRepository<Contact, ContactId>
  implements ContactRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlContactRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_contacts",
      columns: Object.freeze([
        Object.freeze({
          name: "instance_id",
          value: (contact: Contact) => keyOf(contact.instanceId),
        }),
        Object.freeze({
          name: "status",
          value: (contact: Contact) => contact.status,
        }),
        Object.freeze({
          name: "jid",
          value: (contact: Contact) => keyOf(contact.jid),
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<Contact>(value, "Contact"),
      getId: (contact) => keyOf(contact.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Contact[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_contacts WHERE instance_id = $1 ORDER BY id ASC",
      [keyOf(instanceId)],
    );
  }

  findByStatus(status: ContactStatus): Promise<readonly Contact[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_contacts WHERE status = $1 ORDER BY id ASC",
      [createContactStatus(status)],
    );
  }

  async findByJid(jid: Jid): Promise<Contact | undefined> {
    const matches = await this.findManyBySql(
      "SELECT aggregate FROM omniwa_contacts WHERE jid = $1 ORDER BY id ASC LIMIT 1",
      [keyOf(jid)],
    );

    return matches[0];
  }
}

export type PostgresqlLabelRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlLabelRepository
  extends PostgresqlAggregateRepository<Label, LabelId>
  implements LabelRepositoryPort
{
  constructor(connection: PostgresqlQueryExecutor, options: PostgresqlLabelRepositoryOptions = {}) {
    super(connection, {
      tableName: "omniwa_labels",
      columns: Object.freeze([
        Object.freeze({
          name: "instance_id",
          value: (label: Label) => keyOf(label.instanceId),
        }),
        Object.freeze({
          name: "status",
          value: (label: Label) => label.status,
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<Label>(value, "Label"),
      getId: (label) => keyOf(label.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Label[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_labels WHERE instance_id = $1 ORDER BY id ASC",
      [keyOf(instanceId)],
    );
  }

  findByStatus(status: LabelStatus): Promise<readonly Label[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_labels WHERE status = $1 ORDER BY id ASC",
      [createLabelStatus(status)],
    );
  }
}

export type PostgresqlMediaAssetRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlMediaAssetRepository
  extends PostgresqlAggregateRepository<MediaAsset, MediaId>
  implements MediaAssetRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlMediaAssetRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_media_assets",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (media: MediaAsset) => media.status,
        }),
        Object.freeze({
          name: "message_id",
          value: (media: MediaAsset) => optionalNullable(media.messageId),
        }),
        Object.freeze({
          name: "cleanup_required",
          value: (media: MediaAsset) =>
            findMediaAssetCleanupRequiredByMediaId(connection, media.id),
          updateExpression: "omniwa_media_assets.cleanup_required OR EXCLUDED.cleanup_required",
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<MediaAsset>(value, "MediaAsset"),
      getId: (media) => keyOf(media.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByStatus(status: MediaAssetStatus): Promise<readonly MediaAsset[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_media_assets WHERE status = $1 ORDER BY id ASC",
      [createMediaAssetStatus(status)],
    );
  }

  findRequiringCleanup(): Promise<readonly MediaAsset[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_media_assets WHERE cleanup_required = true AND status <> 'cleaned' ORDER BY id ASC",
      [],
    );
  }

  findByMessage(messageId: MessageId): Promise<readonly MediaAsset[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_media_assets WHERE message_id = $1 ORDER BY id ASC",
      [keyOf(messageId)],
    );
  }

  async markRequiringCleanup(mediaId: MediaId): Promise<void> {
    await this.ensureReady();
    await this.connection.query(
      "UPDATE omniwa_media_assets SET cleanup_required = true, updated_at = now() WHERE id = $1",
      [keyOf(mediaId)],
    );
  }
}

export type PostgresqlGroupRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlGroupRepository
  extends PostgresqlAggregateRepository<Group, GroupId>
  implements GroupRepositoryPort
{
  constructor(connection: PostgresqlQueryExecutor, options: PostgresqlGroupRepositoryOptions = {}) {
    super(connection, {
      tableName: "omniwa_groups",
      columns: Object.freeze([
        Object.freeze({
          name: "instance_id",
          value: (group: Group) => keyOf(group.instanceId),
        }),
        Object.freeze({
          name: "status",
          value: (group: Group) => group.status,
        }),
        Object.freeze({
          name: "jid",
          value: (group: Group) => keyOf(group.jid),
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<Group>(value, "Group"),
      getId: (group) => keyOf(group.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Group[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_groups WHERE instance_id = $1 ORDER BY id ASC",
      [keyOf(instanceId)],
    );
  }

  findByStatus(status: GroupStatus): Promise<readonly Group[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_groups WHERE status = $1 ORDER BY id ASC",
      [createGroupStatus(status)],
    );
  }

  async findByJid(jid: Jid): Promise<Group | undefined> {
    const matches = await this.findManyBySql(
      "SELECT aggregate FROM omniwa_groups WHERE jid = $1 ORDER BY id ASC LIMIT 1",
      [keyOf(jid)],
    );

    return matches[0];
  }
}

export type PostgresqlGuardrailDecisionRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlGuardrailDecisionRepository
  extends PostgresqlAggregateRepository<GuardrailDecision, GuardrailDecisionId>
  implements GuardrailDecisionRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlGuardrailDecisionRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_guardrail_decisions",
      columns: Object.freeze([
        Object.freeze({
          name: "evaluated_intent_ref",
          value: (decision: GuardrailDecision) => decision.evaluatedIntentRef,
        }),
        Object.freeze({
          name: "status",
          value: (decision: GuardrailDecision) => decision.status,
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<GuardrailDecision>(value, "GuardrailDecision"),
      getId: (decision) => keyOf(decision.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  async findByEvaluatedIntent(evaluatedIntentRef: string): Promise<GuardrailDecision | undefined> {
    const matches = await this.findManyBySql(
      "SELECT aggregate FROM omniwa_guardrail_decisions WHERE evaluated_intent_ref = $1 ORDER BY id ASC LIMIT 1",
      [evaluatedIntentRef],
    );

    return matches[0];
  }
}

export type PostgresqlHealthStatusRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlHealthStatusRepository
  extends PostgresqlAggregateRepository<HealthStatus, HealthStatusId>
  implements HealthStatusRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlHealthStatusRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_health_statuses",
      columns: Object.freeze([
        Object.freeze({
          name: "subject_ref",
          value: (health: HealthStatus) => health.subjectRef,
        }),
        Object.freeze({
          name: "category",
          value: (health: HealthStatus) => health.category,
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<HealthStatus>(value, "HealthStatus"),
      getId: (health) => keyOf(health.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  async findBySubject(subjectRef: string): Promise<HealthStatus | undefined> {
    const matches = await this.findManyBySql(
      "SELECT aggregate FROM omniwa_health_statuses WHERE subject_ref = $1 ORDER BY id ASC LIMIT 1",
      [subjectRef],
    );

    return matches[0];
  }

  findByCategory(category: HealthCategory): Promise<readonly HealthStatus[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_health_statuses WHERE category = $1 ORDER BY id ASC",
      [createHealthCategory(category)],
    );
  }
}

export type PostgresqlAuditRecordRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlAuditRecordRepository
  extends PostgresqlAggregateRepository<AuditRecord, AuditRecordId>
  implements AuditRecordRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlAuditRecordRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_audit_records",
      columns: Object.freeze([
        Object.freeze({
          name: "audit_category",
          value: (record: AuditRecord) => record.auditCategory,
        }),
        Object.freeze({
          name: "status",
          value: (record: AuditRecord) => record.status,
        }),
        Object.freeze({
          name: "source_signal_ref",
          value: (record: AuditRecord) =>
            findAuditRecordSourceSignalByAuditRecordId(connection, record.id),
          updateExpression:
            "COALESCE(omniwa_audit_records.source_signal_ref, EXCLUDED.source_signal_ref)",
        }),
      ]),
      decode: (value) => decodeProjectionAggregate<AuditRecord>(value, "AuditRecord"),
      getId: (record) => keyOf(record.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly AuditRecord[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_audit_records WHERE source_signal_ref = $1 ORDER BY id ASC",
      [sourceSignalRef],
    );
  }

  findRetentionExpired(): Promise<readonly AuditRecord[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_audit_records WHERE status = 'retention_expired' ORDER BY id ASC",
      [],
    );
  }

  async recordSourceSignal(auditRecordId: AuditRecordId, sourceSignalRef: string): Promise<void> {
    await this.ensureReady();
    await this.connection.query(
      "UPDATE omniwa_audit_records SET source_signal_ref = $2, updated_at = now() WHERE id = $1",
      [keyOf(auditRecordId), sourceSignalRef],
    );
  }
}

export class PostgresqlWebhookSubscriptionRepository
  extends PostgresqlAggregateRepository<WebhookSubscription, WebhookId>
  implements WebhookSubscriptionRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlWebhookSubscriptionRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_webhook_subscriptions",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (subscription: WebhookSubscription) => subscription.status,
        }),
        Object.freeze({
          name: "signal_refs",
          value: (subscription: WebhookSubscription) =>
            findWebhookSubscriptionSignalRefsByWebhookId(connection, subscription.id),
          updateExpression:
            "COALESCE(omniwa_webhook_subscriptions.signal_refs, EXCLUDED.signal_refs)",
        }),
      ]),
      decode: decodeWebhookSubscriptionAggregate,
      getId: (subscription) => keyOf(subscription.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByStatus(status: WebhookSubscriptionStatus): Promise<readonly WebhookSubscription[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_webhook_subscriptions WHERE status = $1 ORDER BY id ASC",
      [createWebhookSubscriptionStatus(status)],
    );
  }

  findActiveForSignal(sourceSignalRef: string): Promise<readonly WebhookSubscription[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_webhook_subscriptions WHERE status = $1 AND signal_refs @> $2::jsonb ORDER BY id ASC",
      ["active", JSON.stringify([sourceSignalRef])],
    );
  }

  async recordSignalSelection(
    webhookId: WebhookId,
    sourceSignalRefs: readonly string[],
  ): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_webhook_subscriptions SET signal_refs = $1::jsonb, updated_at = now() WHERE id = $2",
      [JSON.stringify([...sourceSignalRefs]), keyOf(webhookId)],
    );
  }
}

export type PostgresqlWebhookDeliveryRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlWebhookDeliveryRepository
  extends PostgresqlAggregateRepository<WebhookDelivery, WebhookDeliveryId>
  implements WebhookDeliveryRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlWebhookDeliveryRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_webhook_deliveries",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (delivery: WebhookDelivery) => delivery.status,
        }),
        Object.freeze({
          name: "source_signal_ref",
          value: (delivery: WebhookDelivery) => delivery.sourceSignalRef,
        }),
        Object.freeze({
          name: "idempotency_key",
          value: (delivery: WebhookDelivery) =>
            findWebhookDeliveryIdempotencyKeyByDeliveryId(connection, delivery.id),
          updateExpression:
            "COALESCE(omniwa_webhook_deliveries.idempotency_key, EXCLUDED.idempotency_key)",
        }),
      ]),
      decode: decodeWebhookDeliveryAggregate,
      getId: (delivery) => keyOf(delivery.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByStatus(status: WebhookDeliveryStatus): Promise<readonly WebhookDelivery[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_webhook_deliveries WHERE status = $1 ORDER BY id ASC",
      [createWebhookDeliveryStatus(status)],
    );
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly WebhookDelivery[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_webhook_deliveries WHERE source_signal_ref = $1 ORDER BY id ASC",
      [sourceSignalRef],
    );
  }

  async findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WebhookDelivery | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<WebhookDeliveryRow>(
      "SELECT aggregate FROM omniwa_webhook_deliveries WHERE idempotency_key = $1",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey)))],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : decodeWebhookDeliveryAggregate(row.aggregate);
  }

  async recordIdempotencyKey(
    idempotencyKey: IdempotencyKey,
    deliveryId: WebhookDeliveryId,
  ): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_webhook_deliveries SET idempotency_key = $1, updated_at = now() WHERE id = $2",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey))), keyOf(deliveryId)],
    );
  }
}

export class PostgresqlSessionRepository
  extends PostgresqlAggregateRepository<Session, SessionId>
  implements SessionRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlSessionRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_sessions",
      columns: Object.freeze([
        Object.freeze({
          name: "instance_id",
          value: (session: Session) => keyOf(session.instanceId),
        }),
        Object.freeze({
          name: "status",
          value: (session: Session) => session.status,
        }),
        Object.freeze({
          name: "requires_recovery",
          value: (session: Session) => session.requiresRecovery,
        }),
      ]),
      decode: decodeSessionAggregate,
      getId: (session) => keyOf(session.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  findByInstance(instanceId: InstanceId): Promise<readonly Session[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_sessions WHERE instance_id = $1 ORDER BY id ASC",
      [keyOf(instanceId)],
    );
  }

  findByStatusForInstance(
    instanceId: InstanceId,
    status: SessionStatus,
  ): Promise<readonly Session[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_sessions WHERE instance_id = $1 AND status = $2 ORDER BY id ASC",
      [keyOf(instanceId), createSessionStatus(status)],
    );
  }

  findRecoveryRequired(): Promise<readonly Session[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_sessions WHERE requires_recovery = true ORDER BY id ASC",
      [],
    );
  }
}

export class PostgresqlMessageRepository
  extends PostgresqlAggregateRepository<Message, MessageId>
  implements MessageRepositoryPort
{
  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlMessageRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_messages",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (message: Message) => message.status,
        }),
        Object.freeze({
          name: "idempotency_key",
          value: (message: Message) => findMessageIdempotencyKeyByMessageId(connection, message.id),
          updateExpression: "COALESCE(omniwa_messages.idempotency_key, EXCLUDED.idempotency_key)",
        }),
      ]),
      decode: decodeMessageAggregate,
      getId: (message) => keyOf(message.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
  }

  async findByStatus(status: MessageStatus): Promise<readonly Message[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_messages WHERE status = $1 ORDER BY id ASC",
      [createMessageStatus(status)],
    );
  }

  async findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<Message | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<MessageRow>(
      "SELECT aggregate FROM omniwa_messages WHERE idempotency_key = $1",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey)))],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : decodeMessageAggregate(row.aggregate);
  }

  findRecoverableByOwner(ownerContext: DomainOwnerContext): Promise<readonly Message[]> {
    if (ownerContext !== "messaging") {
      return Promise.resolve(Object.freeze([]));
    }

    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_messages WHERE status IN ($1, $2, $3) ORDER BY id ASC",
      ["queued", "processing", "failed"],
    );
  }

  async recordIdempotencyKey(idempotencyKey: IdempotencyKey, messageId: MessageId): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_messages SET idempotency_key = $1, updated_at = now() WHERE id = $2",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey))), keyOf(messageId)],
    );
  }
}

export class PostgresqlWorkerJobRepository
  extends PostgresqlAggregateRepository<WorkerJob, JobId>
  implements WorkerJobRepositoryPort
{
  private readonly transactionConnection: PostgresqlConnection | undefined;

  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlWorkerJobRepositoryOptions = {},
  ) {
    super(connection, {
      tableName: "omniwa_worker_jobs",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (workerJob: WorkerJob) => workerJob.status,
        }),
        Object.freeze({
          name: "owner_context",
          value: (workerJob: WorkerJob) => workerJob.ownerContext,
        }),
        Object.freeze({
          name: "work_type",
          value: (workerJob: WorkerJob) => workerJob.workType,
        }),
        Object.freeze({
          name: "idempotency_key",
          value: (workerJob: WorkerJob) =>
            findWorkerJobIdempotencyKeyByJobId(connection, workerJob.id),
          updateExpression:
            "COALESCE(omniwa_worker_jobs.idempotency_key, EXCLUDED.idempotency_key)",
        }),
      ]),
      decode: decodeWorkerJobAggregate,
      getId: (workerJob) => keyOf(workerJob.id),
      ...optional("migrationBarrier", options.migrationBarrier),
    });
    this.transactionConnection = isPostgresqlConnection(connection) ? connection : undefined;
  }

  async findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE status = $1 ORDER BY id ASC",
      [createJobStatus(status)],
    );
  }

  async findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE owner_context = $1 ORDER BY id ASC",
      [createDomainOwnerContext(ownerContext)],
    );
  }

  async findByIdempotencyKey(idempotencyKey: IdempotencyKey): Promise<WorkerJob | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<WorkerJobRow>(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE idempotency_key = $1",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey)))],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : decodeWorkerJobAggregate(row.aggregate);
  }

  async recordIdempotencyKey(idempotencyKey: IdempotencyKey, jobId: JobId): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_worker_jobs SET idempotency_key = $1, updated_at = now() WHERE id = $2",
      [keyOf(createIdempotencyKey(keyOf(idempotencyKey))), keyOf(jobId)],
    );
  }

  async reserveNextVisibleWorkerJob(
    input: PostgresqlWorkerJobReserveInput,
  ): Promise<WorkerJob | undefined> {
    await this.ensureReady();

    if (this.transactionConnection === undefined) {
      throw new TypeError("PostgreSQL WorkerJob atomic reservation requires a transaction connection.");
    }

    const client = await this.transactionConnection.connect();

    try {
      await client.query("BEGIN");

      const candidate = await client.query<WorkerJobRow>(
        `SELECT aggregate
         FROM omniwa_worker_jobs
         WHERE work_type = $1
           AND (
             status = $2
             OR (status = $3 AND COALESCE(queue_visible_at_epoch_ms, 0) <= $4)
           )
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [
          input.workType,
          createJobStatus("queued"),
          createJobStatus("retrying"),
          input.visibleAtEpochMilliseconds,
        ],
      );
      const row = candidate.rows[0];

      if (row === undefined) {
        await client.query("COMMIT");
        return undefined;
      }

      const workerJob = decodeWorkerJobAggregate(row.aggregate);
      const reserved = input.reserve(workerJob);

      await client.query(
        `UPDATE omniwa_worker_jobs
         SET status = $1,
             aggregate = $2::jsonb,
             queue_visible_at_epoch_ms = $3,
             updated_at = now()
         WHERE id = $4`,
        [
          reserved.status,
          JSON.stringify(reserved),
          input.reservedVisibleAtEpochMilliseconds,
          keyOf(reserved.id),
        ],
      );
      await client.query("COMMIT");

      return reserved;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverExpiredWorkerJobLeases(
    input: PostgresqlWorkerJobLeaseRecoveryInput,
  ): Promise<readonly WorkerJob[]> {
    await this.ensureReady();

    if (this.transactionConnection === undefined) {
      throw new TypeError("PostgreSQL WorkerJob lease recovery requires a transaction connection.");
    }

    const client = await this.transactionConnection.connect();
    const recovered: WorkerJob[] = [];

    try {
      await client.query("BEGIN");

      const candidates = await client.query<WorkerJobRow>(
        `SELECT aggregate
         FROM omniwa_worker_jobs
         WHERE work_type = ANY($1::text[])
           AND status IN ($2, $3)
           AND COALESCE(queue_visible_at_epoch_ms, 0) <= $4
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED`,
        [
          [...input.workTypes],
          createJobStatus("reserved"),
          createJobStatus("running"),
          input.visibleAtEpochMilliseconds,
        ],
      );

      for (const row of candidates.rows) {
        const workerJob = decodeWorkerJobAggregate(row.aggregate);
        const recoveredWorkerJob = input.recover(workerJob);
        const visibleAt =
          recoveredWorkerJob.status === "retrying" ? input.visibleAtEpochMilliseconds : null;

        await client.query(
          `UPDATE omniwa_worker_jobs
           SET status = $1,
               aggregate = $2::jsonb,
               queue_visible_at_epoch_ms = $3,
               updated_at = now()
           WHERE id = $4`,
          [
            recoveredWorkerJob.status,
            JSON.stringify(recoveredWorkerJob),
            visibleAt,
            keyOf(recoveredWorkerJob.id),
          ],
        );
        recovered.push(recoveredWorkerJob);
      }

      await client.query("COMMIT");

      return Object.freeze(recovered);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setWorkerJobVisibleAt(
    jobId: JobId,
    visibleAtEpochMilliseconds: number,
  ): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_worker_jobs SET queue_visible_at_epoch_ms = $1, updated_at = now() WHERE id = $2",
      [visibleAtEpochMilliseconds, keyOf(jobId)],
    );
  }

  async clearWorkerJobVisibleAt(jobId: JobId): Promise<void> {
    await this.ensureReady();

    await this.connection.query(
      "UPDATE omniwa_worker_jobs SET queue_visible_at_epoch_ms = NULL, updated_at = now() WHERE id = $1",
      [keyOf(jobId)],
    );
  }

  async getWorkerJobVisibleAt(jobId: JobId): Promise<number | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<WorkerJobVisibilityRow>(
      "SELECT queue_visible_at_epoch_ms FROM omniwa_worker_jobs WHERE id = $1",
      [keyOf(jobId)],
    );

    return optionalEpochMilliseconds(result.rows[0]?.queue_visible_at_epoch_ms);
  }
}

type WorkerJobRow = QueryResultRow & {
  aggregate: unknown;
};

type WorkerJobVisibilityRow = QueryResultRow & {
  queue_visible_at_epoch_ms: string | number | null;
};

type PostgresqlWorkerJobReserveInput = Readonly<{
  workType: string;
  visibleAtEpochMilliseconds: number;
  reservedVisibleAtEpochMilliseconds: number;
  reserve(workerJob: WorkerJob): WorkerJob;
}>;

type PostgresqlWorkerJobLeaseRecoveryInput = Readonly<{
  workTypes: readonly string[];
  visibleAtEpochMilliseconds: number;
  recover(workerJob: WorkerJob): WorkerJob;
}>;

type MessageRow = QueryResultRow & {
  aggregate: unknown;
};

type WebhookDeliveryRow = QueryResultRow & {
  aggregate: unknown;
};

async function findMessageIdempotencyKeyByMessageId(
  connection: PostgresqlQueryExecutor,
  messageId: MessageId,
): Promise<string | null> {
  const result = await connection.query<{ idempotency_key: string | null }>(
    "SELECT idempotency_key FROM omniwa_messages WHERE id = $1",
    [keyOf(messageId)],
  );

  return result.rows[0]?.idempotency_key ?? null;
}

async function findWebhookSubscriptionSignalRefsByWebhookId(
  connection: PostgresqlQueryExecutor,
  webhookId: WebhookId,
): Promise<string> {
  const result = await connection.query<{ signal_refs: unknown }>(
    "SELECT signal_refs FROM omniwa_webhook_subscriptions WHERE id = $1",
    [keyOf(webhookId)],
  );
  const signalRefs = result.rows[0]?.signal_refs;

  return JSON.stringify(normalizeSignalRefs(signalRefs));
}

async function findWebhookDeliveryIdempotencyKeyByDeliveryId(
  connection: PostgresqlQueryExecutor,
  deliveryId: WebhookDeliveryId,
): Promise<string | null> {
  const result = await connection.query<{ idempotency_key: string | null }>(
    "SELECT idempotency_key FROM omniwa_webhook_deliveries WHERE id = $1",
    [keyOf(deliveryId)],
  );

  return result.rows[0]?.idempotency_key ?? null;
}

async function findWorkerJobIdempotencyKeyByJobId(
  connection: PostgresqlQueryExecutor,
  jobId: JobId,
): Promise<string | null> {
  const result = await connection.query<{ idempotency_key: string | null }>(
    "SELECT idempotency_key FROM omniwa_worker_jobs WHERE id = $1",
    [keyOf(jobId)],
  );

  return result.rows[0]?.idempotency_key ?? null;
}

async function findAuditRecordSourceSignalByAuditRecordId(
  connection: PostgresqlQueryExecutor,
  auditRecordId: AuditRecordId,
): Promise<string | null> {
  const result = await connection.query<{ source_signal_ref: string | null }>(
    "SELECT source_signal_ref FROM omniwa_audit_records WHERE id = $1",
    [keyOf(auditRecordId)],
  );

  return result.rows[0]?.source_signal_ref ?? null;
}

async function findMediaAssetCleanupRequiredByMediaId(
  connection: PostgresqlQueryExecutor,
  mediaId: MediaId,
): Promise<boolean> {
  const result = await connection.query<{ cleanup_required: boolean | null }>(
    "SELECT cleanup_required FROM omniwa_media_assets WHERE id = $1",
    [keyOf(mediaId)],
  );

  return result.rows[0]?.cleanup_required === true;
}

function createPostgresqlMigrationBarrier(connection: PostgresqlConnection): () => Promise<void> {
  let migrationPromise: Promise<void> | undefined;

  return async () => {
    migrationPromise ??= runPostgresqlSqlMigrations(connection).then(() => undefined);

    await migrationPromise;
  };
}

async function findAppliedPostgresqlSqlMigrationIds(
  connection: PostgresqlConnection,
): Promise<readonly string[]> {
  const table = await connection.query<{ table_name: string | null }>(
    "SELECT to_regclass($1::text) AS table_name",
    ["omniwa_schema_migrations"],
  );

  if (table.rows[0]?.table_name === null || table.rows[0]?.table_name === undefined) {
    return Object.freeze([]);
  }

  const result = await connection.query<{ id: string }>(
    "SELECT id FROM omniwa_schema_migrations ORDER BY id ASC",
  );

  return Object.freeze(result.rows.map((row) => row.id));
}

function decodeInstanceAggregate(value: unknown): Instance {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL Instance aggregate must be an object.");
  }

  return Object.freeze({
    id: createInstanceId(requiredString(aggregate.id, "Instance.id")),
    status: createInstanceStatus(requiredString(aggregate.status, "Instance.status")),
    ...optional(
      "currentSessionId",
      optionalString(aggregate.currentSessionId, "Instance.currentSessionId", createSessionId),
    ),
    ...optional(
      "actionRequiredReason",
      optionalString(aggregate.actionRequiredReason, "Instance.actionRequiredReason", identity),
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "Instance.domainEvents").map(decodeDomainEvent),
    ),
  });
}

function decodeSessionAggregate(value: unknown): Session {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL Session aggregate must be an object.");
  }

  return Object.freeze({
    id: createSessionId(requiredString(aggregate.id, "Session.id")),
    instanceId: createInstanceId(requiredString(aggregate.instanceId, "Session.instanceId")),
    status: createSessionStatus(requiredString(aggregate.status, "Session.status")),
    requiresRecovery: requiredBoolean(aggregate.requiresRecovery, "Session.requiresRecovery"),
    ...optional(
      "retentionPolicy",
      optionalRetentionPolicy(aggregate.retentionPolicy, "Session.retentionPolicy"),
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "Session.domainEvents").map(decodeDomainEvent),
    ),
  });
}

function decodeMessageAggregate(value: unknown): Message {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL Message aggregate must be an object.");
  }

  return Object.freeze({
    id: createMessageId(requiredString(aggregate.id, "Message.id")),
    instanceId: createInstanceId(requiredString(aggregate.instanceId, "Message.instanceId")),
    direction: createMessageDirection(requiredString(aggregate.direction, "Message.direction")),
    type: createMessageType(requiredString(aggregate.type, "Message.type")),
    status: createMessageStatus(requiredString(aggregate.status, "Message.status")),
    ...optional(
      "guardrailDecisionId",
      optionalString(
        aggregate.guardrailDecisionId,
        "Message.guardrailDecisionId",
        createGuardrailDecisionId,
      ),
    ),
    ...optional("mediaId", optionalString(aggregate.mediaId, "Message.mediaId", createMediaId)),
    ...optional(
      "failureCategory",
      optionalString(aggregate.failureCategory, "Message.failureCategory", createFailureCategory),
    ),
    ...optional(
      "retentionPolicy",
      optionalRetentionPolicy(aggregate.retentionPolicy, "Message.retentionPolicy"),
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "Message.domainEvents").map(decodeDomainEvent),
    ),
  });
}

function decodeWebhookSubscriptionAggregate(value: unknown): WebhookSubscription {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL WebhookSubscription aggregate must be an object.");
  }

  return Object.freeze({
    id: createWebhookId(requiredString(aggregate.id, "WebhookSubscription.id")),
    targetUrl: createWebhookUrl(
      requiredString(aggregate.targetUrl, "WebhookSubscription.targetUrl"),
    ),
    status: createWebhookSubscriptionStatus(
      requiredString(aggregate.status, "WebhookSubscription.status"),
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "WebhookSubscription.domainEvents").map(
        decodeDomainEvent,
      ),
    ),
  });
}

function decodeWebhookDeliveryAggregate(value: unknown): WebhookDelivery {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL WebhookDelivery aggregate must be an object.");
  }

  const retryPolicy = decodeRetryPolicy(aggregate.retryPolicy, "WebhookDelivery.retryPolicy");

  return Object.freeze({
    id: createWebhookDeliveryId(requiredString(aggregate.id, "WebhookDelivery.id")),
    webhookId: createWebhookId(requiredString(aggregate.webhookId, "WebhookDelivery.webhookId")),
    sourceSignalRef: requiredString(aggregate.sourceSignalRef, "WebhookDelivery.sourceSignalRef"),
    status: createWebhookDeliveryStatus(requiredString(aggregate.status, "WebhookDelivery.status")),
    retryPolicy,
    ...optional(
      "attemptNumber",
      optionalNumber(aggregate.attemptNumber, "WebhookDelivery.attemptNumber", (value) =>
        createAttemptNumber(value, retryPolicy),
      ),
    ),
    ...optional(
      "failureCategory",
      optionalString(
        aggregate.failureCategory,
        "WebhookDelivery.failureCategory",
        createFailureCategory,
      ),
    ),
    ...optional(
      "deadLetterReason",
      optionalDeadLetterReason(aggregate.deadLetterReason, "WebhookDelivery.deadLetterReason"),
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "WebhookDelivery.domainEvents").map(decodeDomainEvent),
    ),
  });
}

function decodeWorkerJobAggregate(value: unknown): WorkerJob {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError("PostgreSQL WorkerJob aggregate must be an object.");
  }

  const retryPolicy = decodeRetryPolicy(aggregate.retryPolicy, "WorkerJob.retryPolicy");

  return Object.freeze({
    id: createJobId(requiredString(aggregate.id, "WorkerJob.id")),
    ownerContext: createDomainOwnerContext(
      requiredString(aggregate.ownerContext, "WorkerJob.ownerContext"),
    ),
    workType: requiredString(aggregate.workType, "WorkerJob.workType"),
    ...optional(
      "safeMetadata",
      optionalWorkerJobSafeMetadata(aggregate.safeMetadata, "WorkerJob.safeMetadata"),
    ),
    status: createJobStatus(requiredString(aggregate.status, "WorkerJob.status")),
    retryPolicy,
    ...optional(
      "attemptNumber",
      optionalNumber(aggregate.attemptNumber, "WorkerJob.attemptNumber", (value) =>
        createAttemptNumber(value, retryPolicy),
      ),
    ),
    ...optional(
      "failureCategory",
      optionalString(aggregate.failureCategory, "WorkerJob.failureCategory", createFailureCategory),
    ),
    ...optional(
      "deadLetterReason",
      optionalDeadLetterReason(aggregate.deadLetterReason, "WorkerJob.deadLetterReason"),
    ),
    recoveryActionRequired: requiredBoolean(
      aggregate.recoveryActionRequired,
      "WorkerJob.recoveryActionRequired",
    ),
    domainEvents: Object.freeze(
      requiredArray(aggregate.domainEvents, "WorkerJob.domainEvents").map(decodeDomainEvent),
    ),
  });
}

function decodeProjectionAggregate<TAggregate>(value: unknown, label: string): TAggregate {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (!isRecord(aggregate)) {
    throw new TypeError(`PostgreSQL ${label} aggregate must be an object.`);
  }

  return Object.freeze(aggregate) as TAggregate;
}

function optionalRetentionPolicy(
  value: unknown,
  label: string,
): ReturnType<typeof createRetentionPolicy> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return createRetentionPolicy({
    category: requiredString(value.category, `${label}.category`),
    retentionDays: requiredNumber(value.retentionDays, `${label}.retentionDays`),
  });
}

function optionalWorkerJobSafeMetadata(value: unknown, label: string) {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object when present.`);
  }

  return createWorkerJobSafeMetadata({
    jobKind: requiredString(value.jobKind, `${label}.jobKind`),
    ...optional("instanceId", optionalSafeString(value.instanceId, `${label}.instanceId`)),
    ...optional("messageId", optionalSafeString(value.messageId, `${label}.messageId`)),
    ...optional(
      "outboundIntentRef",
      optionalSafeString(value.outboundIntentRef, `${label}.outboundIntentRef`),
    ),
  });
}

function optionalSafeString(value: unknown, label: string): string | undefined {
  return optionalString(value, label, (input) => input);
}

function decodeDomainEvent(value: unknown): DomainEvent {
  if (!isRecord(value)) {
    throw new TypeError("PostgreSQL Instance domain event must be an object.");
  }

  return createDomainEvent({
    name: requiredString(value.name, "DomainEvent.name") as DomainEvent["name"],
    aggregateType: requiredString(
      value.aggregateType,
      "DomainEvent.aggregateType",
    ) as DomainEvent["aggregateType"],
    aggregateId: requiredString(value.aggregateId, "DomainEvent.aggregateId"),
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function optionalString<TValue extends string>(
  value: unknown,
  label: string,
  factory: (value: string) => TValue,
): TValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return factory(requiredString(value, label));
}

function optionalNumber<TValue extends number>(
  value: unknown,
  label: string,
  factory: (value: number) => TValue,
): TValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return factory(value);
}

function decodeRetryPolicy(value: unknown, label: string): ReturnType<typeof createRetryPolicy> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return createRetryPolicy({
    maxAttempts: requiredNumber(value.maxAttempts, `${label}.maxAttempts`),
    initialDelayMilliseconds: requiredNumber(
      value.initialDelayMilliseconds,
      `${label}.initialDelayMilliseconds`,
    ),
    backoffMultiplier: requiredNumber(value.backoffMultiplier, `${label}.backoffMultiplier`),
  });
}

function optionalDeadLetterReason(
  value: unknown,
  label: string,
): ReturnType<typeof createDeadLetterReason> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return createDeadLetterReason({
    code: requiredString(value.code, `${label}.code`),
    category: requiredString(value.category, `${label}.category`),
  });
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function optionalNullable(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function optionalEpochMilliseconds(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(normalized)) {
    throw new TypeError("PostgreSQL WorkerJob visibility timestamp must be finite.");
  }

  return normalized;
}

function isPostgresqlConnection(value: PostgresqlQueryExecutor): value is PostgresqlConnection {
  return "connect" in value && typeof value.connect === "function";
}

function keyOf(value: unknown): string {
  return String(value);
}

function identity(value: string): string {
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSignalRefs(value: unknown): readonly string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  return Array.isArray(parsed)
    ? Object.freeze(parsed.filter((entry): entry is string => typeof entry === "string"))
    : Object.freeze([]);
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
