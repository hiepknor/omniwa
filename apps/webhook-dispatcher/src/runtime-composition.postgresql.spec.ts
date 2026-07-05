import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  activateWebhookSubscription,
  createJobId,
  createRetryPolicy,
  createWebhookDeliveryId,
  createWebhookId,
  createWebhookSubscription,
  createWebhookUrl,
  scheduleWebhookDelivery,
  validateWebhookSubscription,
} from "@omniwa/domain";
import {
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
  type PostgresqlConnection,
} from "@omniwa/infrastructure-persistence";
import type { WebhookFetch, WebhookFetchRequestInit } from "@omniwa/infrastructure-webhook";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createWebhookDispatcherRuntimeComposition,
  type WebhookDispatcherRuntimeComposition,
} from "./runtime-composition.js";

const postgresqlTestDatabaseUrl = process.env.OMNIWA_POSTGRES_TEST_DATABASE_URL?.trim();
const describePostgresql =
  postgresqlTestDatabaseUrl === undefined || postgresqlTestDatabaseUrl.length === 0
    ? describe.skip
    : describe;
const temporaryDirectories: string[] = [];

describePostgresql("Webhook dispatcher production PostgreSQL runtime composition", () => {
  let connection: PostgresqlConnection;

  beforeAll(() => {
    connection = createPostgresqlConnectionPool(postgresqlTestDatabaseUrl ?? "");
  });

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await connection.end?.();
  });

  it("dispatches webhook work through the guarded production profile", async () => {
    const suffix = randomUUID().replaceAll("-", "_");
    const deliveryId = createWebhookDeliveryId(`webhook_delivery_pg_runtime_${suffix}`);
    const webhookId = createWebhookId(`webhook_pg_runtime_${suffix}`);
    const retryPolicy = createRetryPolicy({
      maxAttempts: 2,
      initialDelayMilliseconds: 0,
      backoffMultiplier: 1,
    });
    const repositories = createPostgresqlRepositorySet(connection, { autoMigrate: true });
    await repositories.webhookSubscriptionRepository.save(
      activateWebhookSubscription(
        validateWebhookSubscription(
          createWebhookSubscription(
            webhookId,
            createWebhookUrl("https://receiver.example.test/postgresql-runtime"),
          ),
        ),
      ),
    );
    await repositories.webhookDeliveryRepository.save(
      scheduleWebhookDelivery(deliveryId, webhookId, "message.delivered.v1", retryPolicy),
    );
    const directory = createTemporaryDirectory();
    const fetch = new RecordingWebhookFetch();
    const composition = createWebhookDispatcherRuntimeComposition(
      {
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "durable-worker-job",
        OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY: "fetch",
        OMNIWA_WEBHOOK_SIGNING_SECRET_NAME: "OMNIWA_WEBHOOK_SIGNING_SECRET",
        OMNIWA_WEBHOOK_SIGNING_SECRET: "webhook-postgresql-runtime-secret",
        OMNIWA_POSTGRES_DATABASE_URL: postgresqlTestDatabaseUrl,
        OMNIWA_POSTGRES_AUTO_MIGRATE: "true",
        OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH: join(directory, "metrics.jsonl"),
        OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH: join(directory, "audit.jsonl"),
      },
      {
        webhookFetch: fetch.fetch,
      },
    );
    const context = createContext(suffix);

    try {
      await composition.queueProvider.enqueue(
        {
          jobId: createJobId(String(deliveryId)),
          ownerContext: "webhook_delivery",
          ownerRef: String(deliveryId),
          workType: "webhook_delivery",
          retryPolicy,
          idempotencyKey: `webhook-dispatcher-postgresql-runtime-${suffix}`,
        },
        context,
      );

      const result = await composition.app.runOnce(context);

      expect(result).toMatchObject({ outcome: "delivered" });
      expect(fetch.calls).toHaveLength(1);
      expect(fetch.calls[0]?.init.headers).toMatchObject({
        "x-omniwa-delivery-id": String(deliveryId),
        "x-omniwa-webhook-id": String(webhookId),
        "x-omniwa-signature-scheme": "v1",
      });
      expect(fetch.calls[0]?.init.headers["x-omniwa-signature"]).toMatch(/^v1=[a-f0-9]{64}$/u);
      await expect(repositories.webhookDeliveryRepository.load(deliveryId)).resolves.toMatchObject({
        status: "delivered",
        attemptNumber: 1,
      });
      await expect(
        repositories.workerJobRepository.load(createJobId(String(deliveryId))),
      ).resolves.toMatchObject({
        status: "completed",
      });
      const metrics = readFileSync(join(directory, "metrics.jsonl"), "utf8");
      const audit = readFileSync(join(directory, "audit.jsonl"), "utf8");
      expect(metrics).toContain("webhook_dispatcher.dispatch.total");
      expect(audit).toContain('"outcome":"delivered"');
      expect(JSON.stringify({ result, metrics, audit })).not.toContain(
        "webhook-postgresql-runtime-secret",
      );
      expect(JSON.stringify({ metrics, audit })).not.toContain("receiver.example.test");
    } finally {
      await disposeComposition(composition);
    }
  });
});

function createContext(suffix: string) {
  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`webhook-dispatcher-postgresql-${suffix}`),
      requestId: createRequestId(`webhook-dispatcher-postgresql-${suffix}`),
    }),
    actorRef: "webhook-dispatcher-postgresql-test",
    idempotencyKey: `webhook-dispatcher-postgresql-${suffix}`,
    dataClassification: "internal" as const,
  });
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-webhook-dispatcher-postgresql-"));
  temporaryDirectories.push(directory);

  return directory;
}

async function disposeComposition(composition: WebhookDispatcherRuntimeComposition): Promise<void> {
  await composition.dispose?.();
}

class RecordingWebhookFetch {
  readonly calls: Array<{ url: string; init: WebhookFetchRequestInit }> = [];

  readonly fetch: WebhookFetch = (url, init) => {
    this.calls.push({ url, init });
    return {
      status: 202,
    };
  };
}
