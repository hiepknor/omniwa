import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { createDurableJsonRepositorySet } from "@omniwa/infrastructure-persistence";
import { DurableWorkerJobQueueProvider, InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import type { WebhookFetch, WebhookFetchRequestInit } from "@omniwa/infrastructure-webhook";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import type {
  WebhookDispatchAuditEntry,
  WebhookDispatchAuditSink,
} from "./webhook-dispatcher-app.js";
import {
  createWebhookDispatcherRuntimeComposition,
  readWebhookDispatcherQueueProfile,
  readWebhookDispatcherRepositoryProfile,
  readWebhookDispatcherRuntimeProfile,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];
const context = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("webhook-runtime-composition-correlation"),
    requestId: createRequestId("webhook-runtime-composition-request"),
  }),
  actorRef: "webhook-dispatcher-runtime-test",
  idempotencyKey: "webhook-runtime-composition-test",
  dataClassification: "internal",
} as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Webhook Dispatcher runtime composition", () => {
  it("composes a local in-memory dispatcher runtime by default", async () => {
    const composition = createWebhookDispatcherRuntimeComposition({
      NODE_ENV: "test",
    });

    expect(composition).toMatchObject({
      profile: "test",
      repositoryProfile: "in-memory",
      queueProfile: "in-memory",
    });
    expect(composition.queueProvider).toBeInstanceOf(InMemoryQueueProvider);
    await expect(composition.queueProvider.recoverVisibleJobs?.()).resolves.toEqual({
      recovered: 0,
    });
    await expect(composition.app.runOnce()).resolves.toMatchObject({
      outcome: "idle",
    });
  });

  it("composes durable worker-job queue profile for webhook dispatch", async () => {
    const directory = createTemporaryDirectory();
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR: directory,
      OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "durable-worker-job",
    });

    expect(composition.queueProfile).toBe("durable-worker-job");
    expect(composition.queueProvider).toBeInstanceOf(DurableWorkerJobQueueProvider);
    await expect(composition.app.runOnce()).resolves.toMatchObject({
      outcome: "idle",
    });
  });

  it("composes durable JSON repository profile when a state directory is provided", async () => {
    const directory = createTemporaryDirectory();
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
    await expect(composition.app.runOnce()).resolves.toMatchObject({
      outcome: "idle",
    });
  });

  it("falls back to API repository state directory for shared local stack configuration", () => {
    const directory = createTemporaryDirectory();
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_API_REPOSITORY_STATE_DIR: directory,
    });

    expect(composition.repositoryProfile).toBe("durable-json");
  });

  it("wires opt-in fetch gateway and signing provider for local dispatch", async () => {
    const directory = createTemporaryDirectory();
    const deliveryId = createWebhookDeliveryId("webhook-delivery-runtime-fetch");
    const webhookId = createWebhookId("webhook-runtime-fetch");
    const repositories = createDurableJsonRepositorySet(directory);
    await repositories.webhookSubscriptionRepository.save(
      activateWebhookSubscription(
        validateWebhookSubscription(
          createWebhookSubscription(webhookId, createWebhookUrl("https://receiver.example.test/a")),
        ),
      ),
    );
    await repositories.webhookDeliveryRepository.save(
      scheduleWebhookDelivery(
        deliveryId,
        webhookId,
        "message.delivered.v1",
        createRetryPolicy({
          maxAttempts: 2,
          initialDelayMilliseconds: 0,
          backoffMultiplier: 1,
        }),
      ),
    );
    const fetch = new RecordingWebhookFetch();
    const composition = createWebhookDispatcherRuntimeComposition(
      {
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR: directory,
        OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY: "fetch",
        OMNIWA_WEBHOOK_SIGNING_SECRET_NAME: "OMNIWA_WEBHOOK_SIGNING_SECRET",
        OMNIWA_WEBHOOK_SIGNING_SECRET: "webhook-runtime-composition-secret",
      },
      {
        webhookFetch: fetch.fetch,
      },
    );
    await composition.queueProvider.enqueue(
      {
        jobId: createJobId(String(deliveryId)),
        ownerContext: "webhook_delivery",
        ownerRef: String(deliveryId),
        workType: "webhook_delivery",
        retryPolicy: createRetryPolicy({
          maxAttempts: 2,
          initialDelayMilliseconds: 0,
          backoffMultiplier: 1,
        }),
        idempotencyKey: "webhook-runtime-composition-fetch",
      },
      context,
    );

    const result = await composition.app.runOnce(context);

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]?.init.headers).toMatchObject({
      "x-omniwa-signature-scheme": "v1",
      "x-omniwa-delivery-id": String(deliveryId),
      "x-omniwa-webhook-id": String(webhookId),
    });
    expect(fetch.calls[0]?.init.headers["x-omniwa-signature"]).toMatch(/^v1=[a-f0-9]{64}$/u);
    expect(fetch.calls[0]?.init.body).not.toContain("webhook-runtime-composition-secret");
  });

  it("requires a signing secret name when fetch gateway is enabled", () => {
    const directory = createTemporaryDirectory();

    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR: directory,
        OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY: "fetch",
      }),
    ).toThrow(/OMNIWA_WEBHOOK_SIGNING_SECRET_NAME/u);
  });

  it("fails closed for production runtime when required production adapters are missing", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(
      /OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE=postgresql.*OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job.*OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch.*OMNIWA_WEBHOOK_SIGNING_SECRET_NAME.*metric recorder adapter.*webhook dispatch audit sink/u,
    );
  });

  it("requires the configured webhook signing secret value for production composition", () => {
    const telemetry = new RecordingWebhookDispatcherTelemetry();

    expect(() =>
      createWebhookDispatcherRuntimeComposition(
        {
          OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
          OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
          OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "durable-worker-job",
          OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY: "fetch",
          OMNIWA_WEBHOOK_SIGNING_SECRET_NAME: "OMNIWA_WEBHOOK_SIGNING_SECRET",
          OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
        },
        {
          webhookFetch: new RecordingWebhookFetch().fetch,
          metricRecorder: telemetry,
          auditSink: telemetry,
        },
      ),
    ).toThrow(/configured webhook signing secret value/u);
  });

  it("composes production runtime when durable queue, gateway, secret, and observability are present", () => {
    const telemetry = new RecordingWebhookDispatcherTelemetry();
    const composition = createWebhookDispatcherRuntimeComposition(
      {
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "durable-worker-job",
        OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY: "fetch",
        OMNIWA_WEBHOOK_SIGNING_SECRET_NAME: "OMNIWA_WEBHOOK_SIGNING_SECRET",
        OMNIWA_WEBHOOK_SIGNING_SECRET: "webhook-production-runtime-secret",
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
        OMNIWA_POSTGRES_AUTO_MIGRATE: "true",
      },
      {
        webhookFetch: new RecordingWebhookFetch().fetch,
        metricRecorder: telemetry,
        auditSink: telemetry,
      },
    );

    expect(composition).toMatchObject({
      profile: "production",
      repositoryProfile: "postgresql",
      queueProfile: "durable-worker-job",
    });
    expect(composition.queueProvider).toBeInstanceOf(DurableWorkerJobQueueProvider);
  });

  it("supports PostgreSQL repository profile once webhook repositories are implemented", () => {
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
  });

  it("requires a PostgreSQL database URL for PostgreSQL composition", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toThrow(/OMNIWA_POSTGRES_DATABASE_URL/u);
  });

  it("composes PostgreSQL repository profile when a database URL is provided", () => {
    const composition = createWebhookDispatcherRuntimeComposition({
      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
      OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
      OMNIWA_POSTGRES_AUTO_MIGRATE: "true",
    });

    expect(composition.repositoryProfile).toBe("postgresql");
  });

  it("requires a repository state directory for durable JSON composition", () => {
    expect(() =>
      createWebhookDispatcherRuntimeComposition({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "local",
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      }),
    ).toThrow(/OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR/u);
  });

  it("normalizes dispatcher runtime and repository profile values", () => {
    expect(readWebhookDispatcherRuntimeProfile({ NODE_ENV: "development" })).toBe("local");
    expect(
      readWebhookDispatcherRuntimeProfile({
        OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: "production",
      }),
    ).toBe("production");
    expect(readWebhookDispatcherRepositoryProfile({})).toBe("in-memory");
    expect(readWebhookDispatcherQueueProfile({})).toBe("in-memory");
    expect(
      readWebhookDispatcherQueueProfile({
        OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "durable",
      }),
    ).toBe("durable-worker-job");
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "durable-json",
      }),
    ).toBe("durable-json");
    expect(
      readWebhookDispatcherRepositoryProfile({
        OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toBe("postgresql");
    expect(() =>
      readWebhookDispatcherQueueProfile({
        OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE: "unknown",
      }),
    ).toThrow(/Unsupported OmniWA Webhook Dispatcher queue profile/u);
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-webhook-dispatcher-runtime-"));
  temporaryDirectories.push(directory);

  return directory;
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

class RecordingWebhookDispatcherTelemetry implements MetricRecorder, WebhookDispatchAuditSink {
  readonly metrics: MetricPoint[] = [];
  readonly auditEntries: WebhookDispatchAuditEntry[] = [];

  recordMetric(point: MetricPoint): void {
    this.metrics.push(point);
  }

  recordWebhookDispatch(entry: WebhookDispatchAuditEntry): void {
    this.auditEntries.push(entry);
  }
}
