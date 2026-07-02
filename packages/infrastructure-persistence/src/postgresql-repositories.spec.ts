import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FieldDef, QueryResult, QueryResultRow } from "pg";

import {
  createPostgresqlConnectionPool,
  PostgresqlInstanceRepository,
  postgresqlInstanceRepositoryMigrations,
  runPostgresqlSqlMigrations,
  type PostgresqlConnection,
  type PostgresqlSqlMigration,
  type PostgresqlTransactionClient,
} from "./postgresql-repositories.js";
import { describeInstanceRepositoryContract } from "./repository-contracts.spec-helper.js";

describe("PostgreSQL migration runner", () => {
  it("applies migration statements inside an explicit transaction and records the migration", async () => {
    const connection = new FakePostgresqlConnection();
    const migration = sqlMigration("pgm_unit_001", [
      "CREATE TABLE IF NOT EXISTS example_unit_table (id text PRIMARY KEY)",
    ]);

    const result = await runPostgresqlSqlMigrations(connection, [migration]);

    expect(result).toEqual({
      appliedMigrationIds: ["pgm_unit_001"],
      skippedMigrationIds: [],
    });
    expect(connection.client.queries).toEqual(
      expect.arrayContaining([
        "BEGIN",
        "CREATE TABLE IF NOT EXISTS example_unit_table (id text PRIMARY KEY)",
        "COMMIT",
      ]),
    );
    expect(connection.client.appliedMigrationIds).toEqual(["pgm_unit_001"]);
  });

  it("skips already recorded migrations without re-running DDL", async () => {
    const connection = new FakePostgresqlConnection();
    const migration = sqlMigration("pgm_unit_002", [
      "CREATE TABLE IF NOT EXISTS example_skip_table (id text PRIMARY KEY)",
    ]);

    await runPostgresqlSqlMigrations(connection, [migration]);
    connection.client.queries.length = 0;

    const result = await runPostgresqlSqlMigrations(connection, [migration]);

    expect(result).toEqual({
      appliedMigrationIds: [],
      skippedMigrationIds: ["pgm_unit_002"],
    });
    expect(connection.client.queries).not.toContain(
      "CREATE TABLE IF NOT EXISTS example_skip_table (id text PRIMARY KEY)",
    );
  });

  it("defines the InstanceRepositoryPort storage migration explicitly", () => {
    expect(postgresqlInstanceRepositoryMigrations).toEqual([
      expect.objectContaining({
        id: "pgm_20260702_0001_instance_repository",
        description: expect.stringContaining("InstanceRepositoryPort"),
      }),
    ]);
    expect(postgresqlInstanceRepositoryMigrations[0]?.statements.join("\n")).toContain(
      "omniwa_instances",
    );
  });
});

const postgresqlTestDatabaseUrl = process.env.OMNIWA_POSTGRES_TEST_DATABASE_URL?.trim();

if (postgresqlTestDatabaseUrl === undefined || postgresqlTestDatabaseUrl.length === 0) {
  describe.skip("PostgreSQL InstanceRepositoryPort contract", () => {
    it("requires OMNIWA_POSTGRES_TEST_DATABASE_URL to run", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("PostgreSQL InstanceRepositoryPort contract", () => {
    const connection = createPostgresqlConnectionPool(postgresqlTestDatabaseUrl);

    beforeEach(async () => {
      await runPostgresqlSqlMigrations(connection);
      await connection.query("TRUNCATE TABLE omniwa_instances");
    });

    afterAll(async () => {
      await connection.end?.();
    });

    describeInstanceRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlInstanceRepository(connection),
    });
  });
}

function sqlMigration(id: string, statements: readonly string[]): PostgresqlSqlMigration {
  return Object.freeze({
    id,
    description: `Unit migration ${id}`,
    statements: Object.freeze([...statements]),
  });
}

class FakePostgresqlConnection implements PostgresqlConnection {
  readonly client = new FakePostgresqlClient();

  query = this.client.query.bind(this.client);

  connect(): Promise<PostgresqlTransactionClient> {
    return Promise.resolve(this.client);
  }
}

class FakePostgresqlClient implements PostgresqlTransactionClient {
  readonly appliedMigrationIds: string[] = [];
  readonly queries: string[] = [];

  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    this.queries.push(text);

    if (text.startsWith("SELECT id FROM omniwa_schema_migrations")) {
      const migrationId = String(values[0]);
      const rows = this.appliedMigrationIds.includes(migrationId)
        ? ([{ id: migrationId }] as unknown as TRow[])
        : [];

      return Promise.resolve(queryResult(rows, rows.length));
    }

    if (text.startsWith("INSERT INTO omniwa_schema_migrations")) {
      this.appliedMigrationIds.push(String(values[0]));
    }

    return Promise.resolve(queryResult([], null));
  }

  release(): void {
    return undefined;
  }
}

function queryResult<TRow extends QueryResultRow>(
  rows: TRow[],
  rowCount: number | null,
): QueryResult<TRow> {
  return {
    rows,
    rowCount,
    command: "",
    oid: 0,
    fields: [] as FieldDef[],
  };
}
