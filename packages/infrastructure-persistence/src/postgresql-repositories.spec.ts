import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FieldDef, QueryResult, QueryResultRow } from "pg";
import {
  acceptMediaAsset,
  attachMediaAsset,
  createInstanceId,
  createLabel,
  createLabelId,
  createMediaAsset,
  createMediaCategory,
  createMediaId,
  createMessageId,
  createRetentionPolicy,
  markMediaProcessed,
  markMediaProcessing,
} from "@omniwa/domain";

import {
  createPostgresqlConnectionPool,
  PostgresqlAuditRecordRepository,
  PostgresqlChatRepository,
  PostgresqlContactRepository,
  PostgresqlGroupRepository,
  PostgresqlGuardrailDecisionRepository,
  PostgresqlHealthStatusRepository,
  PostgresqlInstanceRepository,
  PostgresqlLabelRepository,
  PostgresqlMediaAssetRepository,
  PostgresqlMessageRepository,
  PostgresqlSessionRepository,
  PostgresqlWebhookDeliveryRepository,
  PostgresqlWebhookSubscriptionRepository,
  PostgresqlWorkerJobRepository,
  postgresqlInstanceRepositoryMigrations,
  runPostgresqlSqlMigrations,
  type PostgresqlConnection,
  type PostgresqlSqlMigration,
  type PostgresqlTransactionClient,
} from "./postgresql-repositories.js";
import {
  describeChatRepositoryContract,
  describeContactRepositoryContract,
  describeGroupRepositoryContract,
  describeGuardrailDecisionRepositoryContract,
  describeHealthStatusRepositoryContract,
  describeAuditRecordRepositoryContract,
  describeInstanceRepositoryContract,
  describeMessageRepositoryContract,
  describeSessionRepositoryContract,
  describeWebhookDeliveryRepositoryContract,
  describeWebhookSubscriptionRepositoryContract,
  describeWorkerJobRepositoryContract,
} from "./repository-contracts.spec-helper.js";

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

  it("defines the PostgreSQL repository storage migrations explicitly", () => {
    expect(postgresqlInstanceRepositoryMigrations).toEqual([
      expect.objectContaining({
        id: "pgm_20260702_0001_instance_repository",
        description: expect.stringContaining("InstanceRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260702_0002_worker_job_repository",
        description: expect.stringContaining("WorkerJobRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0003_message_repository",
        description: expect.stringContaining("MessageRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0004_session_repository",
        description: expect.stringContaining("SessionRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0005_webhook_subscription_repository",
        description: expect.stringContaining("WebhookSubscriptionRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0006_webhook_delivery_repository",
        description: expect.stringContaining("WebhookDeliveryRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0007_chat_repository",
        description: expect.stringContaining("ChatRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0008_contact_repository",
        description: expect.stringContaining("ContactRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0009_group_repository",
        description: expect.stringContaining("GroupRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0010_guardrail_decision_repository",
        description: expect.stringContaining("GuardrailDecisionRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260704_0011_health_status_repository",
        description: expect.stringContaining("HealthStatusRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260705_0012_audit_record_repository",
        description: expect.stringContaining("AuditRecordRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260705_0013_label_repository",
        description: expect.stringContaining("LabelRepositoryPort"),
      }),
      expect.objectContaining({
        id: "pgm_20260705_0014_media_asset_repository",
        description: expect.stringContaining("MediaAssetRepositoryPort"),
      }),
    ]);
    expect(postgresqlInstanceRepositoryMigrations[0]?.statements.join("\n")).toContain(
      "omniwa_instances",
    );
    expect(postgresqlInstanceRepositoryMigrations[1]?.statements.join("\n")).toContain(
      "omniwa_worker_jobs",
    );
    expect(postgresqlInstanceRepositoryMigrations[2]?.statements.join("\n")).toContain(
      "omniwa_messages",
    );
    expect(postgresqlInstanceRepositoryMigrations[3]?.statements.join("\n")).toContain(
      "omniwa_sessions",
    );
    expect(postgresqlInstanceRepositoryMigrations[4]?.statements.join("\n")).toContain(
      "omniwa_webhook_subscriptions",
    );
    expect(postgresqlInstanceRepositoryMigrations[5]?.statements.join("\n")).toContain(
      "omniwa_webhook_deliveries",
    );
    expect(postgresqlInstanceRepositoryMigrations[6]?.statements.join("\n")).toContain(
      "omniwa_chats",
    );
    expect(postgresqlInstanceRepositoryMigrations[7]?.statements.join("\n")).toContain(
      "omniwa_contacts",
    );
    expect(postgresqlInstanceRepositoryMigrations[8]?.statements.join("\n")).toContain(
      "omniwa_groups",
    );
    expect(postgresqlInstanceRepositoryMigrations[9]?.statements.join("\n")).toContain(
      "omniwa_guardrail_decisions",
    );
    expect(postgresqlInstanceRepositoryMigrations[10]?.statements.join("\n")).toContain(
      "omniwa_health_statuses",
    );
    expect(postgresqlInstanceRepositoryMigrations[11]?.statements.join("\n")).toContain(
      "omniwa_audit_records",
    );
    expect(postgresqlInstanceRepositoryMigrations[12]?.statements.join("\n")).toContain(
      "omniwa_labels",
    );
    expect(postgresqlInstanceRepositoryMigrations[13]?.statements.join("\n")).toContain(
      "omniwa_media_assets",
    );
  });
});

const postgresqlTestDatabaseUrl = process.env.OMNIWA_POSTGRES_TEST_DATABASE_URL?.trim();

if (postgresqlTestDatabaseUrl === undefined || postgresqlTestDatabaseUrl.length === 0) {
  describe.skip("PostgreSQL repository contracts", () => {
    it("requires OMNIWA_POSTGRES_TEST_DATABASE_URL to run", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("PostgreSQL repository contracts", () => {
    const connection = createPostgresqlConnectionPool(postgresqlTestDatabaseUrl);

    beforeEach(async () => {
      await runPostgresqlSqlMigrations(connection);
      await connection.query(
        "TRUNCATE TABLE omniwa_media_assets, omniwa_labels, omniwa_audit_records, omniwa_health_statuses, omniwa_guardrail_decisions, omniwa_groups, omniwa_contacts, omniwa_chats, omniwa_worker_jobs, omniwa_webhook_deliveries, omniwa_webhook_subscriptions, omniwa_messages, omniwa_sessions, omniwa_instances",
      );
    });

    afterAll(async () => {
      await connection.end?.();
    });

    describeInstanceRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlInstanceRepository(connection),
    });

    describeMessageRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlMessageRepository(connection),
    });

    describeSessionRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlSessionRepository(connection),
    });

    describeChatRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlChatRepository(connection),
    });

    describeContactRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlContactRepository(connection),
    });

    describeGroupRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlGroupRepository(connection),
    });

    it("persists label and media ownership projections", async () => {
      const labelRepository = new PostgresqlLabelRepository(connection);
      const mediaAssetRepository = new PostgresqlMediaAssetRepository(connection);
      const instanceId = createInstanceId("inst_postgresql_label_media_owner");
      const messageId = createMessageId("msg_postgresql_media_owner");
      const mediaId = createMediaId("media_postgresql_owner");
      const label = createLabel({
        id: createLabelId("label_postgresql_owner"),
        instanceId,
        name: "PostgreSQL Owner Label",
      });
      const media = attachMediaAsset(
        markMediaProcessed(
          markMediaProcessing(
            acceptMediaAsset(
              createMediaAsset(
                mediaId,
                createMediaCategory("image"),
                createRetentionPolicy({
                  category: "media_metadata",
                  retentionDays: 30,
                }),
              ),
            ),
          ),
        ),
        messageId,
      );

      await labelRepository.save(label);
      await mediaAssetRepository.save(media);
      await mediaAssetRepository.markRequiringCleanup(mediaId);

      await expect(labelRepository.findByInstance(instanceId)).resolves.toEqual([label]);
      await expect(labelRepository.findByStatus("active")).resolves.toEqual([label]);
      await expect(mediaAssetRepository.findByStatus("attached")).resolves.toEqual([media]);
      await expect(mediaAssetRepository.findByMessage(messageId)).resolves.toEqual([media]);
      await expect(mediaAssetRepository.findRequiringCleanup()).resolves.toEqual([media]);
    });

    describeGuardrailDecisionRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlGuardrailDecisionRepository(connection),
    });

    describeHealthStatusRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlHealthStatusRepository(connection),
    });

    describeAuditRecordRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlAuditRecordRepository(connection),
    });

    describeWebhookSubscriptionRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlWebhookSubscriptionRepository(connection),
    });

    describeWebhookDeliveryRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlWebhookDeliveryRepository(connection),
    });

    describeWorkerJobRepositoryContract({
      name: "postgresql",
      create: () => new PostgresqlWorkerJobRepository(connection),
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
