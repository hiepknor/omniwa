import type { RepositorySaveResult } from "@omniwa/domain";
import type { QueryResult, QueryResultRow } from "pg";

export type PostgresqlQueryExecutor = Readonly<{
  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}>;

export type PostgresqlColumnValue = unknown | Promise<unknown>;

export type PostgresqlAggregateColumn<TAggregate> = Readonly<{
  name: string;
  value: (aggregate: TAggregate) => PostgresqlColumnValue;
  updateExpression?: string;
}>;

export type PostgresqlAggregateRepositoryOptions<TAggregate> = Readonly<{
  tableName: string;
  columns: readonly PostgresqlAggregateColumn<TAggregate>[];
  decode: (value: unknown) => TAggregate;
  getId: (aggregate: TAggregate) => string;
  migrationBarrier?: () => Promise<void>;
  aggregateColumn?: string;
  idColumn?: string;
  updatedAtColumn?: string;
}>;

type AggregateRow = QueryResultRow & {
  aggregate: unknown;
};

export class PostgresqlAggregateRepository<TAggregate, TId> {
  protected readonly connection: PostgresqlQueryExecutor;

  private readonly tableName: string;
  private readonly columns: readonly PostgresqlAggregateColumn<TAggregate>[];
  private readonly decode: (value: unknown) => TAggregate;
  private readonly getAggregateId: (aggregate: TAggregate) => string;
  private readonly migrationBarrier: (() => Promise<void>) | undefined;
  private readonly aggregateColumn: string;
  private readonly idColumn: string;
  private readonly updatedAtColumn: string;

  constructor(
    connection: PostgresqlQueryExecutor,
    options: PostgresqlAggregateRepositoryOptions<TAggregate>,
  ) {
    this.connection = connection;
    this.tableName = options.tableName;
    this.columns = options.columns;
    this.decode = options.decode;
    this.getAggregateId = options.getId;
    this.migrationBarrier = options.migrationBarrier;
    this.aggregateColumn = options.aggregateColumn ?? "aggregate";
    this.idColumn = options.idColumn ?? "id";
    this.updatedAtColumn = options.updatedAtColumn ?? "updated_at";
  }

  async load(id: TId): Promise<TAggregate | undefined> {
    await this.ensureReady();

    const result = await this.connection.query<AggregateRow>(
      `SELECT ${this.aggregateColumn} FROM ${this.tableName} WHERE ${this.idColumn} = $1`,
      [keyOf(id)],
    );
    const row = result.rows[0];

    return row === undefined ? undefined : this.decode(row[this.aggregateColumn]);
  }

  async save(aggregate: TAggregate): Promise<RepositorySaveResult> {
    await this.ensureReady();

    const { sql, values } = await this.createUpsert(aggregate);
    await this.connection.query(sql, values);

    return Object.freeze({ saved: true });
  }

  async exists(id: TId): Promise<boolean> {
    await this.ensureReady();

    const result = await this.connection.query(
      `SELECT 1 FROM ${this.tableName} WHERE ${this.idColumn} = $1`,
      [keyOf(id)],
    );

    return result.rowCount !== null && result.rowCount > 0;
  }

  protected async findManyBySql(
    sql: string,
    values: readonly unknown[],
  ): Promise<readonly TAggregate[]> {
    await this.ensureReady();

    const result = await this.connection.query<AggregateRow>(sql, values);

    return Object.freeze(result.rows.map((row) => this.decode(row[this.aggregateColumn])));
  }

  protected ensureReady(): Promise<void> {
    return this.migrationBarrier?.() ?? Promise.resolve();
  }

  private async createUpsert(
    aggregate: TAggregate,
  ): Promise<Readonly<{ sql: string; values: readonly unknown[] }>> {
    const columnNames = [
      this.idColumn,
      ...this.columns.map((column) => column.name),
      this.aggregateColumn,
      this.updatedAtColumn,
    ];
    const persistedValues = await Promise.all(
      this.columns.map((column) => column.value(aggregate)),
    );
    const values = [this.getAggregateId(aggregate), ...persistedValues, JSON.stringify(aggregate)];
    const aggregatePlaceholder = `$${values.length}::jsonb`;
    const valuePlaceholders = [
      "$1",
      ...this.columns.map((_column, index) => `$${index + 2}`),
      aggregatePlaceholder,
      "now()",
    ];
    const updateAssignments = [
      ...this.columns.map((column) => {
        const expression = column.updateExpression ?? `EXCLUDED.${column.name}`;

        return `${column.name} = ${expression}`;
      }),
      `${this.aggregateColumn} = EXCLUDED.${this.aggregateColumn}`,
      `${this.updatedAtColumn} = now()`,
    ];

    return Object.freeze({
      sql: `INSERT INTO ${this.tableName} (
        ${columnNames.join(",\n        ")}
      ) VALUES (${valuePlaceholders.join(", ")})
      ON CONFLICT (${this.idColumn}) DO UPDATE SET
        ${updateAssignments.join(",\n        ")}`,
      values: Object.freeze(values),
    });
  }
}

function keyOf(value: unknown): string {
  return String(value);
}
