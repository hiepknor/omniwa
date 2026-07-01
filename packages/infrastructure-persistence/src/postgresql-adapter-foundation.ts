import {
  physicalDataModelReview,
  repositoryPortNames,
  validateRepositoryAdapterPlanCompleteness,
  type RepositoryPortName,
} from "./repository-adapter-plan.js";

export const postgresqlAdapterFoundationStatuses = [
  "blocked_by_schema_review",
  "ready_for_adapter_implementation",
] as const;

export type PostgresqlAdapterFoundationStatus =
  (typeof postgresqlAdapterFoundationStatuses)[number];

export const postgresqlRuntimeDependencies = [
  "connection_pool",
  "migration_runner",
  "transaction_manager",
  "repository_contract_tests",
] as const;

export type PostgresqlRuntimeDependency = (typeof postgresqlRuntimeDependencies)[number];

export type PostgresqlAdapterFoundation = Readonly<{
  status: PostgresqlAdapterFoundationStatus;
  sourceOfTruthStore: "postgresql";
  repositoryPorts: readonly RepositoryPortName[];
  requiredRuntimeDependencies: readonly PostgresqlRuntimeDependency[];
  blockers: readonly string[];
}>;

export const postgresqlMigrationAuthorizationStatuses = ["blocked", "approved"] as const;

export type PostgresqlMigrationAuthorizationStatus =
  (typeof postgresqlMigrationAuthorizationStatuses)[number];

export type PostgresqlMigrationAuthorization =
  | Readonly<{
      status: "blocked";
      reasonCode: string;
      reviewRef: string;
    }>
  | Readonly<{
      status: "approved";
      reviewRef: string;
      targetVersion: string;
    }>;

export type PostgresqlMigration = Readonly<{
  id: string;
  description: string;
  reviewRef: string;
  reversible: boolean;
}>;

export type PostgresqlMigrationResult = Readonly<{
  migrationId: string;
  applied: true;
}>;

export type PostgresqlMigrationExecutor = Readonly<{
  apply(migration: PostgresqlMigration): Promise<PostgresqlMigrationResult>;
}>;

export type PostgresqlMigrationPlan = Readonly<{
  executable: boolean;
  authorization: PostgresqlMigrationAuthorization;
  migrations: readonly PostgresqlMigration[];
  blockers: readonly string[];
}>;

export type PostgresqlMigrationRunResult = Readonly<{
  executed: boolean;
  appliedMigrations: readonly PostgresqlMigrationResult[];
  blockers: readonly string[];
}>;

export function createPostgresqlAdapterFoundation(): PostgresqlAdapterFoundation {
  const blockers = validatePostgresqlAdapterFoundationBlockers();

  return Object.freeze({
    status: blockers.length === 0 ? "ready_for_adapter_implementation" : "blocked_by_schema_review",
    sourceOfTruthStore: "postgresql",
    repositoryPorts: Object.freeze([...repositoryPortNames]),
    requiredRuntimeDependencies: Object.freeze([...postgresqlRuntimeDependencies]),
    blockers,
  });
}

export function createBlockedPostgresqlMigrationAuthorization(): PostgresqlMigrationAuthorization {
  return Object.freeze({
    status: "blocked",
    reasonCode: "physical_schema_review_required",
    reviewRef: "docs/persistence/PERSISTENCE_FREEZE.md",
  });
}

export function createPostgresqlMigrationPlan(input: {
  authorization?: PostgresqlMigrationAuthorization;
  migrations?: readonly PostgresqlMigration[];
}): PostgresqlMigrationPlan {
  const authorization = input.authorization ?? createBlockedPostgresqlMigrationAuthorization();
  const migrations = Object.freeze([...(input.migrations ?? [])]);
  const duplicateIds = findDuplicateMigrationIds(migrations);
  const blockers = [
    ...validatePostgresqlMigrationAuthorization(authorization),
    ...duplicateIds.map((id) => `Duplicate PostgreSQL migration id: ${id}.`),
  ];

  return Object.freeze({
    executable: authorization.status === "approved" && blockers.length === 0,
    authorization,
    migrations,
    blockers: Object.freeze(blockers),
  });
}

export async function runPostgresqlMigrationPlan(input: {
  plan: PostgresqlMigrationPlan;
  executor: PostgresqlMigrationExecutor;
}): Promise<PostgresqlMigrationRunResult> {
  if (!input.plan.executable) {
    return Object.freeze({
      executed: false,
      appliedMigrations: Object.freeze([]),
      blockers: input.plan.blockers,
    });
  }

  const appliedMigrations: PostgresqlMigrationResult[] = [];

  for (const migration of input.plan.migrations) {
    appliedMigrations.push(await input.executor.apply(migration));
  }

  return Object.freeze({
    executed: true,
    appliedMigrations: Object.freeze(appliedMigrations),
    blockers: Object.freeze([]),
  });
}

function validatePostgresqlAdapterFoundationBlockers(): readonly string[] {
  const blockers = [...validateRepositoryAdapterPlanCompleteness()];

  if (physicalDataModelReview.sourceOfTruthStore !== "postgresql") {
    blockers.push("PostgreSQL must remain the approved source-of-truth store.");
  }

  if (!physicalDataModelReview.reviewNotes.some((note) => note.includes("PostgreSQL"))) {
    blockers.push("Physical data model review must include PostgreSQL review notes.");
  }

  if (physicalDataModelReview.schemaCreationAllowed === false) {
    blockers.push("Physical schema review is required before creating PostgreSQL schemas.");
  }

  if (physicalDataModelReview.migrationCreationAllowed === false) {
    blockers.push("Migration review is required before creating PostgreSQL migrations.");
  }

  return Object.freeze(blockers);
}

function validatePostgresqlMigrationAuthorization(
  authorization: PostgresqlMigrationAuthorization,
): readonly string[] {
  if (authorization.status === "blocked") {
    return Object.freeze([
      `PostgreSQL migration execution is blocked: ${authorization.reasonCode}.`,
    ]);
  }

  const blockers: string[] = [];

  if (authorization.reviewRef.trim().length === 0) {
    blockers.push("Approved PostgreSQL migration authorization requires a review reference.");
  }

  if (authorization.targetVersion.trim().length === 0) {
    blockers.push("Approved PostgreSQL migration authorization requires a target version.");
  }

  return Object.freeze(blockers);
}

function findDuplicateMigrationIds(migrations: readonly PostgresqlMigration[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      duplicates.add(migration.id);
    }

    seen.add(migration.id);
  }

  return Object.freeze([...duplicates]);
}
