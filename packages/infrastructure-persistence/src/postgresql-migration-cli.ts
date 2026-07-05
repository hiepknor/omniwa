import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPostgresqlConnectionPool,
  getPostgresqlSqlMigrationStatus,
  runPostgresqlSqlMigrations,
  type PostgresqlConnection,
} from "./postgresql-repositories.js";

export const postgresqlMigrationCliCommands = ["status", "apply"] as const;

export type PostgresqlMigrationCliCommand = (typeof postgresqlMigrationCliCommands)[number];

export type PostgresqlMigrationCliResult = Readonly<{
  command: PostgresqlMigrationCliCommand;
  databaseUrl: string;
  appliedMigrationIds: readonly string[];
  skippedMigrationIds: readonly string[];
  pendingMigrationIds: readonly string[];
  unknownAppliedMigrationIds: readonly string[];
}>;

export type PostgresqlMigrationCliOptions = Readonly<{
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  createConnection?: (databaseUrl: string) => PostgresqlConnection;
  stdout?: (line: string) => void;
}>;

const databaseUrlEnvName = "OMNIWA_POSTGRES_DATABASE_URL";

export async function runPostgresqlMigrationCli(
  options: PostgresqlMigrationCliOptions = {},
): Promise<PostgresqlMigrationCliResult> {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((line) => console.log(line));
  const command = readPostgresqlMigrationCommand(args);
  const databaseUrl = readPostgresqlMigrationDatabaseUrl(env);
  const connectionFactory = options.createConnection ?? createPostgresqlConnectionPool;
  const connection = connectionFactory(databaseUrl);

  try {
    const runResult =
      command === "apply"
        ? await runPostgresqlSqlMigrations(connection)
        : { appliedMigrationIds: Object.freeze([]), skippedMigrationIds: Object.freeze([]) };
    const status = await getPostgresqlSqlMigrationStatus(connection);
    const result = Object.freeze({
      command,
      databaseUrl: redactPostgresqlDatabaseUrl(databaseUrl),
      appliedMigrationIds:
        command === "apply"
          ? Object.freeze([...runResult.appliedMigrationIds])
          : status.appliedMigrationIds,
      skippedMigrationIds: Object.freeze([...runResult.skippedMigrationIds]),
      pendingMigrationIds: status.pendingMigrationIds,
      unknownAppliedMigrationIds: status.unknownAppliedMigrationIds,
    });

    stdout(JSON.stringify(result, null, 2));

    return result;
  } finally {
    await connection.end?.();
  }
}

export function readPostgresqlMigrationCommand(
  args: readonly string[],
): PostgresqlMigrationCliCommand {
  const command = args[0] ?? "status";

  if (postgresqlMigrationCliCommands.includes(command as PostgresqlMigrationCliCommand)) {
    return command as PostgresqlMigrationCliCommand;
  }

  throw new Error("Usage: postgresql-migration-cli <status|apply>");
}

export function readPostgresqlMigrationDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  const databaseUrl = env[databaseUrlEnvName]?.trim();

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(`${databaseUrlEnvName} is required for PostgreSQL migrations.`);
  }

  return databaseUrl;
}

export function redactPostgresqlDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);

    if (parsed.username.length > 0) {
      parsed.username = "redacted";
    }

    if (parsed.password.length > 0) {
      parsed.password = "redacted";
    }

    return parsed.toString();
  } catch {
    return "redacted-postgresql-url";
  }
}

function isMainModule(metaUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) {
    return false;
  }

  return fileURLToPath(metaUrl) === resolve(argvEntry);
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runPostgresqlMigrationCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "PostgreSQL migration command failed.";

    console.error(message);
    process.exitCode = 1;
  });
}
