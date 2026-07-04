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
  createMessageDirection,
  createMessageId,
  createMessageStatus,
  createMessageType,
  createMediaId,
  createGuardrailDecisionId,
  createRetryPolicy,
  createRetentionPolicy,
  createSessionId,
  createWorkerJobSafeMetadata,
  type DomainEvent,
  type DomainOwnerContext,
  type IdempotencyKey,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type JobId,
  type JobStatus,
  type Message,
  type MessageId,
  type MessageRepositoryPort,
  type MessageStatus,
  type SessionId,
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

export type PostgresqlRepositorySetOptions = Readonly<{
  autoMigrate?: boolean;
}>;

export type PostgresqlRepositorySet = Readonly<{
  instanceRepository: PostgresqlInstanceRepository;
  messageRepository: PostgresqlMessageRepository;
  workerJobRepository: PostgresqlWorkerJobRepository;
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
        aggregate jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_status_idx ON omniwa_worker_jobs (status)",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_owner_context_idx ON omniwa_worker_jobs (owner_context)",
      "CREATE INDEX IF NOT EXISTS omniwa_worker_jobs_work_type_idx ON omniwa_worker_jobs (work_type)",
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

export function createPostgresqlRepositorySet(
  connection: PostgresqlConnection,
  options: PostgresqlRepositorySetOptions = {},
): PostgresqlRepositorySet {
  const migrationBarrier = options.autoMigrate
    ? createPostgresqlMigrationBarrier(connection)
    : undefined;

  return Object.freeze({
    instanceRepository: new PostgresqlInstanceRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    messageRepository: new PostgresqlMessageRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
    workerJobRepository: new PostgresqlWorkerJobRepository(connection, {
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
}

type WorkerJobRow = QueryResultRow & {
  aggregate: unknown;
};

type MessageRow = QueryResultRow & {
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

function createPostgresqlMigrationBarrier(connection: PostgresqlConnection): () => Promise<void> {
  let migrationPromise: Promise<void> | undefined;

  return async () => {
    migrationPromise ??= runPostgresqlSqlMigrations(connection).then(() => undefined);

    await migrationPromise;
  };
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

function keyOf(value: unknown): string {
  return String(value);
}

function identity(value: string): string {
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
