import { describe, expect, it } from "vitest";
import type { FieldDef, QueryResult, QueryResultRow } from "pg";

import {
  PostgresqlAggregateRepository,
  type PostgresqlQueryExecutor,
} from "./postgresql-aggregate-repository.js";

type UnitAggregate = Readonly<{
  id: string;
  status: string;
  sideChannel?: string;
}>;

describe("PostgresqlAggregateRepository", () => {
  it("builds a reusable aggregate upsert with denormalized columns", async () => {
    const connection = new FakePostgresqlQueryExecutor();
    let migrationBarrierCalls = 0;
    const repository = new UnitAggregateRepository(connection, async () => {
      migrationBarrierCalls += 1;
    });

    await repository.save(
      Object.freeze({
        id: "agg_1",
        status: "active",
        sideChannel: "side_1",
      }),
    );

    expect(migrationBarrierCalls).toBe(1);
    expect(connection.queries[0]?.text).toContain("INSERT INTO unit_aggregates");
    expect(connection.queries[0]?.text).toContain("status = EXCLUDED.status");
    expect(connection.queries[0]?.text).toContain(
      "side_channel = COALESCE(unit_aggregates.side_channel, EXCLUDED.side_channel)",
    );
    expect(connection.queries[0]?.values).toEqual([
      "agg_1",
      "active",
      "side_1",
      JSON.stringify({
        id: "agg_1",
        status: "active",
        sideChannel: "side_1",
      }),
    ]);
  });

  it("loads, checks existence, and lists aggregates through the shared decode path", async () => {
    const connection = new FakePostgresqlQueryExecutor();
    const repository = new UnitAggregateRepository(connection);
    connection.loadRow = {
      aggregate: {
        id: "agg_2",
        status: "active",
      },
    };
    connection.existsRowCount = 1;
    connection.findRows = [
      {
        aggregate: JSON.stringify({
          id: "agg_3",
          status: "active",
        }),
      },
    ];

    await expect(repository.load("agg_2")).resolves.toEqual({
      id: "agg_2",
      status: "active",
    });
    await expect(repository.exists("agg_2")).resolves.toBe(true);
    await expect(repository.findByStatus("active")).resolves.toEqual([
      {
        id: "agg_3",
        status: "active",
      },
    ]);
  });
});

class UnitAggregateRepository extends PostgresqlAggregateRepository<UnitAggregate, string> {
  constructor(connection: PostgresqlQueryExecutor, migrationBarrier?: () => Promise<void>) {
    super(connection, {
      tableName: "unit_aggregates",
      columns: Object.freeze([
        Object.freeze({
          name: "status",
          value: (aggregate: UnitAggregate) => aggregate.status,
        }),
        Object.freeze({
          name: "side_channel",
          value: async (aggregate: UnitAggregate) => aggregate.sideChannel ?? null,
          updateExpression: "COALESCE(unit_aggregates.side_channel, EXCLUDED.side_channel)",
        }),
      ]),
      decode: decodeUnitAggregate,
      getId: (aggregate) => aggregate.id,
      ...(migrationBarrier === undefined ? {} : { migrationBarrier }),
    });
  }

  findByStatus(status: string): Promise<readonly UnitAggregate[]> {
    return this.findManyBySql(
      "SELECT aggregate FROM unit_aggregates WHERE status = $1 ORDER BY id ASC",
      [status],
    );
  }
}

class FakePostgresqlQueryExecutor implements PostgresqlQueryExecutor {
  readonly queries: Array<Readonly<{ text: string; values: readonly unknown[] }>> = [];
  loadRow: QueryResultRow | undefined;
  findRows: QueryResultRow[] = [];
  existsRowCount = 0;

  query<TRow extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    this.queries.push(
      Object.freeze({
        text,
        values: Object.freeze([...values]),
      }),
    );

    if (text.startsWith("SELECT aggregate FROM unit_aggregates WHERE id")) {
      return Promise.resolve(
        queryResult(this.loadRow === undefined ? [] : [this.loadRow as TRow], null),
      );
    }

    if (text.startsWith("SELECT 1 FROM unit_aggregates")) {
      return Promise.resolve(queryResult([], this.existsRowCount));
    }

    if (text.startsWith("SELECT aggregate FROM unit_aggregates WHERE status")) {
      return Promise.resolve(queryResult(this.findRows as TRow[], this.findRows.length));
    }

    return Promise.resolve(queryResult([], 1));
  }
}

function decodeUnitAggregate(value: unknown): UnitAggregate {
  const aggregate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;

  if (typeof aggregate !== "object" || aggregate === null || Array.isArray(aggregate)) {
    throw new TypeError("Unit aggregate must be an object.");
  }

  const record = aggregate as Readonly<Record<string, unknown>>;

  if (typeof record.id !== "string" || typeof record.status !== "string") {
    throw new TypeError("Unit aggregate id and status must be strings.");
  }

  return Object.freeze({
    id: record.id,
    status: record.status,
    ...(typeof record.sideChannel === "string" ? { sideChannel: record.sideChannel } : {}),
  });
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
