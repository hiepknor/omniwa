import {
  createDomainEvent,
  createInstanceId,
  createInstanceStatus,
  createSessionId,
  type DomainEvent,
  type Instance,
  type InstanceId,
  type InstanceRepositoryPort,
  type InstanceStatus,
  type RepositorySaveResult,
  type SessionId,
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
}>;

export const postgresqlInstanceRepositoryMigrations = Object.freeze([
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
]) satisfies readonly PostgresqlSqlMigration[];

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
  migrations: readonly PostgresqlSqlMigration[] = postgresqlInstanceRepositoryMigrations,
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

type InstanceRow = QueryResultRow & {
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
