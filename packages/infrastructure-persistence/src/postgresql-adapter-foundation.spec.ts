import { describe, expect, it } from "vitest";

import {
  createBlockedPostgresqlMigrationAuthorization,
  createPostgresqlAdapterFoundation,
  createPostgresqlMigrationPlan,
  runPostgresqlMigrationPlan,
  type PostgresqlMigration,
  type PostgresqlMigrationExecutor,
} from "./postgresql-adapter-foundation.js";
import { repositoryPortNames } from "./repository-adapter-plan.js";

describe("PostgreSQL adapter foundation", () => {
  it("keeps PostgreSQL as source of truth while blocking schema work until review", () => {
    const foundation = createPostgresqlAdapterFoundation();

    expect(foundation).toMatchObject({
      status: "blocked_by_schema_review",
      sourceOfTruthStore: "postgresql",
    });
    expect(foundation.repositoryPorts).toEqual(repositoryPortNames);
    expect(foundation.requiredRuntimeDependencies).toEqual([
      "connection_pool",
      "migration_runner",
      "transaction_manager",
      "repository_contract_tests",
    ]);
    expect(foundation.blockers).toEqual(
      expect.arrayContaining([
        "Physical schema review is required before creating PostgreSQL schemas.",
        "Migration review is required before creating PostgreSQL migrations.",
      ]),
    );
  });

  it("creates a blocked migration authorization from the current persistence freeze", () => {
    expect(createBlockedPostgresqlMigrationAuthorization()).toEqual({
      status: "blocked",
      reasonCode: "physical_schema_review_required",
      reviewRef: "docs/persistence/PERSISTENCE_FREEZE.md",
    });
  });

  it("does not execute migrations while schema review is blocked", async () => {
    const executor = new CapturingExecutor();
    const plan = createPostgresqlMigrationPlan({
      migrations: [migration("pgm_001")],
    });

    const result = await runPostgresqlMigrationPlan({ plan, executor });

    expect(result.executed).toBe(false);
    expect(result.appliedMigrations).toEqual([]);
    expect(result.blockers).toEqual([
      "PostgreSQL migration execution is blocked: physical_schema_review_required.",
    ]);
    expect(executor.appliedMigrationIds).toEqual([]);
  });

  it("executes reviewed migration manifests through an injected executor", async () => {
    const executor = new CapturingExecutor();
    const plan = createPostgresqlMigrationPlan({
      authorization: {
        status: "approved",
        reviewRef: "docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md#sprint-pr-3",
        targetVersion: "pg-foundation-v1",
      },
      migrations: [migration("pgm_001"), migration("pgm_002")],
    });

    const result = await runPostgresqlMigrationPlan({ plan, executor });

    expect(plan.executable).toBe(true);
    expect(result).toEqual({
      executed: true,
      appliedMigrations: [
        { migrationId: "pgm_001", applied: true },
        { migrationId: "pgm_002", applied: true },
      ],
      blockers: [],
    });
    expect(executor.appliedMigrationIds).toEqual(["pgm_001", "pgm_002"]);
  });

  it("rejects duplicate migration ids before executor invocation", async () => {
    const executor = new CapturingExecutor();
    const plan = createPostgresqlMigrationPlan({
      authorization: {
        status: "approved",
        reviewRef: "docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md#sprint-pr-3",
        targetVersion: "pg-foundation-v1",
      },
      migrations: [migration("pgm_001"), migration("pgm_001")],
    });

    const result = await runPostgresqlMigrationPlan({ plan, executor });

    expect(plan.executable).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.blockers).toEqual(["Duplicate PostgreSQL migration id: pgm_001."]);
    expect(executor.appliedMigrationIds).toEqual([]);
  });
});

function migration(id: string): PostgresqlMigration {
  return Object.freeze({
    id,
    description: `Reviewed migration manifest ${id}`,
    reviewRef: "docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md#sprint-pr-3",
    reversible: true,
  });
}

class CapturingExecutor implements PostgresqlMigrationExecutor {
  readonly appliedMigrationIds: string[] = [];

  apply(migrationInput: PostgresqlMigration): Promise<{ migrationId: string; applied: true }> {
    this.appliedMigrationIds.push(migrationInput.id);

    return Promise.resolve({
      migrationId: migrationInput.id,
      applied: true,
    });
  }
}
