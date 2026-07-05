import { describe, expect, it } from "vitest";
import type { FieldDef, QueryResult, QueryResultRow } from "pg";

import {
  readPostgresqlMigrationCommand,
  readPostgresqlMigrationDatabaseUrl,
  redactPostgresqlDatabaseUrl,
  runPostgresqlMigrationCli,
} from "./postgresql-migration-cli.js";
import type {
  PostgresqlConnection,
  PostgresqlTransactionClient,
} from "./postgresql-repositories.js";

describe("PostgreSQL migration CLI", () => {
  it("defaults to status and rejects unsupported commands", () => {
    expect(readPostgresqlMigrationCommand([])).toBe("status");
    expect(readPostgresqlMigrationCommand(["apply"])).toBe("apply");
    expect(() => readPostgresqlMigrationCommand(["drop"])).toThrow(
      "Usage: postgresql-migration-cli <status|apply>",
    );
  });

  it("requires an explicit production database url env var", () => {
    expect(() => readPostgresqlMigrationDatabaseUrl({})).toThrow(
      "OMNIWA_POSTGRES_DATABASE_URL is required for PostgreSQL migrations.",
    );
    expect(
      readPostgresqlMigrationDatabaseUrl({
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://user:secret@localhost/omniwa",
      }),
    ).toBe("postgresql://user:secret@localhost/omniwa");
  });

  it("redacts PostgreSQL credentials before writing command output", () => {
    expect(redactPostgresqlDatabaseUrl("postgresql://user:secret@localhost:5432/omniwa")).toBe(
      "postgresql://redacted:redacted@localhost:5432/omniwa",
    );
    expect(redactPostgresqlDatabaseUrl("not a url")).toBe("redacted-postgresql-url");
  });

  it("reports migration status without applying pending migrations", async () => {
    const connection = new FakePostgresqlConnection();
    const output: string[] = [];

    const result = await runPostgresqlMigrationCli({
      args: ["status"],
      env: {
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://user:secret@localhost/omniwa",
      },
      createConnection: () => connection,
      stdout: (line) => output.push(line),
    });

    expect(result.command).toBe("status");
    expect(result.appliedMigrationIds).toEqual([]);
    expect(result.skippedMigrationIds).toEqual([]);
    expect(result.pendingMigrationIds.length).toBeGreaterThan(0);
    expect(connection.appliedMigrationIds).toEqual([]);
    expect(output.join("\n")).not.toContain("secret");
  });

  it("applies pending migrations and reports skipped migrations on the next run", async () => {
    const connection = new FakePostgresqlConnection();
    const env = {
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://user:secret@localhost/omniwa",
    };

    const first = await runPostgresqlMigrationCli({
      args: ["apply"],
      env,
      createConnection: () => connection,
      stdout: () => undefined,
    });
    const second = await runPostgresqlMigrationCli({
      args: ["apply"],
      env,
      createConnection: () => connection,
      stdout: () => undefined,
    });

    expect(first.appliedMigrationIds.length).toBeGreaterThan(0);
    expect(first.pendingMigrationIds).toEqual([]);
    expect(second.appliedMigrationIds).toEqual([]);
    expect(second.skippedMigrationIds).toEqual(first.appliedMigrationIds);
    expect(second.pendingMigrationIds).toEqual([]);
    expect(connection.ended).toBe(2);
  });
});

class FakePostgresqlConnection implements PostgresqlConnection {
  readonly client = new FakePostgresqlClient();
  ended = 0;

  get appliedMigrationIds(): readonly string[] {
    return this.client.appliedMigrationIds;
  }

  query = this.client.query.bind(this.client);

  connect(): Promise<PostgresqlTransactionClient> {
    this.client.schemaTableExists = true;

    return Promise.resolve(this.client);
  }

  end(): Promise<void> {
    this.ended += 1;

    return Promise.resolve();
  }
}

class FakePostgresqlClient implements PostgresqlTransactionClient {
  readonly appliedMigrationIds: string[] = [];
  schemaTableExists = false;

  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    if (text.startsWith("SELECT to_regclass")) {
      return Promise.resolve(
        queryResult(
          [
            { table_name: this.schemaTableExists ? "omniwa_schema_migrations" : null },
          ] as unknown as TRow[],
          1,
        ),
      );
    }

    if (text.startsWith("SELECT id FROM omniwa_schema_migrations ORDER BY id ASC")) {
      const rows = this.appliedMigrationIds.map((id) => ({ id }) as unknown as TRow);

      return Promise.resolve(queryResult(rows, rows.length));
    }

    if (text.startsWith("SELECT id FROM omniwa_schema_migrations WHERE id = $1")) {
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
