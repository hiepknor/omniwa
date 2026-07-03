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
  createRetryPolicy,
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
  type RepositorySaveResult,
  type SessionId,
  type WorkerJob,
  type WorkerJobRepositoryPort,
} from "@omniwa/domain";
import { Pool, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export type PostgresqlQueryExecutor = Readonly<{
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}>;

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
    workerJobRepository: new PostgresqlWorkerJobRepository(connection, {
      ...optional("migrationBarrier", migrationBarrier),
    }),
  });
}

export type PostgresqlInstanceRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlInstanceRepository implements InstanceRepositoryPort {
  private readonly connection: PostgresqlQueryExecutor;
  private readonly migrationBarrier: (() => Promise<void>) | undefined;

  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlInstanceRepositoryOptions = {},
  ) {
    this.connection = connection;
    this.migrationBarrier = options.migrationBarrier;
  }

  async load(id: InstanceId): Promise<Instance | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<InstanceRow>(
      "SELECT aggregate FROM omniwa_instances WHERE id = $1",
      [keyOf(id)],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : decodeInstanceAggregate(row.aggregate);
  }

  async save(instance: Instance): Promise<RepositorySaveResult> {
    await this.ensureReady();

    await this.connection.query(
      `INSERT INTO omniwa_instances (
        id,
        status,
        current_session_id,
        action_required_reason,
        aggregate,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        current_session_id = EXCLUDED.current_session_id,
        action_required_reason = EXCLUDED.action_required_reason,
        aggregate = EXCLUDED.aggregate,
        updated_at = now()`,
      [
        keyOf(instance.id),
        instance.status,
        optionalNullable(instance.currentSessionId),
        optionalNullable(instance.actionRequiredReason),
        JSON.stringify(instance),
      ],
    );

    return Object.freeze({ saved: true });
  }

  async exists(id: InstanceId): Promise<boolean> {
    await this.ensureReady();

    const result = await this.connection.query("SELECT 1 FROM omniwa_instances WHERE id = $1", [
      keyOf(id),
    ]);

    return result.rowCount !== null && result.rowCount > 0;
  }

  async findByStatus(status: InstanceStatus): Promise<readonly Instance[]> {
    await this.ensureReady();

    const result = await this.connection.query<InstanceRow>(
      "SELECT aggregate FROM omniwa_instances WHERE status = $1 ORDER BY id ASC",
      [createInstanceStatus(status)],
    );

    return Object.freeze(result.rows.map((row) => decodeInstanceAggregate(row.aggregate)));
  }

  async findNonTerminal(): Promise<readonly Instance[]> {
    await this.ensureReady();

    const result = await this.connection.query<InstanceRow>(
      "SELECT aggregate FROM omniwa_instances WHERE status <> $1 ORDER BY id ASC",
      ["destroyed"],
    );

    return Object.freeze(result.rows.map((row) => decodeInstanceAggregate(row.aggregate)));
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

  private ensureReady(): Promise<void> {
    return this.migrationBarrier?.() ?? Promise.resolve();
  }
}

export type PostgresqlWorkerJobRepositoryOptions = Readonly<{
  migrationBarrier?: () => Promise<void>;
}>;

export class PostgresqlWorkerJobRepository implements WorkerJobRepositoryPort {
  private readonly connection: PostgresqlQueryExecutor;
  private readonly migrationBarrier: (() => Promise<void>) | undefined;

  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlWorkerJobRepositoryOptions = {},
  ) {
    this.connection = connection;
    this.migrationBarrier = options.migrationBarrier;
  }

  async load(id: JobId): Promise<WorkerJob | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<WorkerJobRow>(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE id = $1",
      [keyOf(id)],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : decodeWorkerJobAggregate(row.aggregate);
  }

  async save(workerJob: WorkerJob): Promise<RepositorySaveResult> {
    await this.ensureReady();

    const existingIdempotencyKey = await this.findIdempotencyKeyByJobId(workerJob.id);

    await this.connection.query(
      `INSERT INTO omniwa_worker_jobs (
        id,
        status,
        owner_context,
        work_type,
        idempotency_key,
        aggregate,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        owner_context = EXCLUDED.owner_context,
        work_type = EXCLUDED.work_type,
        idempotency_key = COALESCE(omniwa_worker_jobs.idempotency_key, EXCLUDED.idempotency_key),
        aggregate = EXCLUDED.aggregate,
        updated_at = now()`,
      [
        keyOf(workerJob.id),
        workerJob.status,
        workerJob.ownerContext,
        workerJob.workType,
        existingIdempotencyKey,
        JSON.stringify(workerJob),
      ],
    );

    return Object.freeze({ saved: true });
  }

  async exists(id: JobId): Promise<boolean> {
    await this.ensureReady();

    const result = await this.connection.query("SELECT 1 FROM omniwa_worker_jobs WHERE id = $1", [
      keyOf(id),
    ]);

    return result.rowCount !== null && result.rowCount > 0;
  }

  async findByStatus(status: JobStatus): Promise<readonly WorkerJob[]> {
    await this.ensureReady();

    const result = await this.connection.query<WorkerJobRow>(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE status = $1 ORDER BY id ASC",
      [createJobStatus(status)],
    );

    return Object.freeze(result.rows.map((row) => decodeWorkerJobAggregate(row.aggregate)));
  }

  async findByOwnerContext(ownerContext: DomainOwnerContext): Promise<readonly WorkerJob[]> {
    await this.ensureReady();

    const result = await this.connection.query<WorkerJobRow>(
      "SELECT aggregate FROM omniwa_worker_jobs WHERE owner_context = $1 ORDER BY id ASC",
      [createDomainOwnerContext(ownerContext)],
    );

    return Object.freeze(result.rows.map((row) => decodeWorkerJobAggregate(row.aggregate)));
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

  private async findIdempotencyKeyByJobId(jobId: JobId): Promise<string | null> {
    const result = await this.connection.query<{ idempotency_key: string | null }>(
      "SELECT idempotency_key FROM omniwa_worker_jobs WHERE id = $1",
      [keyOf(jobId)],
    );

    return result.rows[0]?.idempotency_key ?? null;
  }

  private ensureReady(): Promise<void> {
    return this.migrationBarrier?.() ?? Promise.resolve();
  }
}

type InstanceRow = QueryResultRow & {
  aggregate: unknown;
};

type WorkerJobRow = QueryResultRow & {
  aggregate: unknown;
};

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
