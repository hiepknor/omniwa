import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApplicationPortContext } from "@omniwa/application";
import { SecretValue, type SecretDescriptor, type SecretProvider } from "@omniwa/config";
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
import { fail, type OmniwaError, succeed } from "@omniwa/errors";
import { createDurableJsonRepositorySet } from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import {
  HttpWebhookTransportAdapter,
  WebhookHmacSignatureProvider,
  verifyWebhookSignature,
  type WebhookHttpGateway,
  type WebhookOutboundRequest,
  type WebhookOutboundResult,
} from "@omniwa/infrastructure-webhook";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  type Result,
} from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryWebhookDeliveryEnvelopeResolver,
  WebhookDispatcherApp,
  createWebhookDispatcherRuntime,
  type WebhookDispatchAuditEntry,
  type WebhookDispatchAuditSink,
} from "./webhook-dispatcher-app.js";

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("webhook-dispatcher-app-correlation"),
    requestId: createRequestId("webhook-dispatcher-app-request"),
  }),
  actorRef: "webhook-dispatcher-test",
  idempotencyKey: "webhook-dispatcher-app-test",
  dataClassification: "internal",
};

const retryPolicy = createRetryPolicy({
  maxAttempts: 2,
  initialDelayMilliseconds: 0,
  backoffMultiplier: 1,
});
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("WebhookDispatcherApp", () => {
  it("recovers durable webhook delivery work after queue process restart", async () => {
    const stateDirectory = await createTempStateDirectory();
    const deliveryId = createWebhookDeliveryId("webhook-delivery-app-restart");
    const webhookId = createWebhookId("webhook-app-restart");
    const repositories = createDurableJsonRepositorySet(stateDirectory);
    await seedWebhookWork(repositories, webhookId, deliveryId);

    const firstQueue = new InMemoryQueueProvider({
      workerJobRepository: repositories.workerJobRepository,
    });
    await firstQueue.enqueue(
      {
        jobId: createJobId(String(deliveryId)),
        ownerContext: "webhook_delivery",
        ownerRef: String(deliveryId),
        workType: "webhook_delivery",
        retryPolicy,
        idempotencyKey: "webhook-dispatcher-app-restart",
      },
      context,
    );

    const restartedRepositories = createDurableJsonRepositorySet(stateDirectory);
    const recoveredQueue = new InMemoryQueueProvider({
      workerJobRepository: restartedRepositories.workerJobRepository,
    });
    const recovery = await recoveredQueue.recoverVisibleJobs();
    const gateway = new RecordingWebhookHttpGateway([{ statusCode: 202 }]);
    const telemetry = new RecordingWebhookDispatcherTelemetry();
    const app = new WebhookDispatcherApp({
      runtime: createWebhookDispatcherRuntime({
        queueProvider: recoveredQueue,
        envelopeResolver: createResolver(restartedRepositories),
        transport: createSignedTransport(gateway),
        retryDelayMilliseconds: 0,
        metricRecorder: telemetry,
        auditSink: telemetry,
      }),
      contextFactory: () => context,
    });

    const result = await app.runOnce();

    expect(recovery).toEqual({ recovered: 1 });
    expect(result).toMatchObject({ outcome: "delivered" });
    expect(gateway.requests).toHaveLength(1);
    const request = gateway.requests[0];
    expect(request?.headers).toMatchObject({
      "x-omniwa-signature-timestamp": "1234567890000",
      "x-omniwa-signature-scheme": "v1",
    });
    expect(
      request === undefined
        ? undefined
        : verifyWebhookSignature({
            body: request.body,
            timestamp: request.headers["x-omniwa-signature-timestamp"] ?? "",
            signature: request.headers["x-omniwa-signature"] ?? "",
            secret: SecretValue.fromString("webhook-dispatcher-app-secret"),
            nowEpochMilliseconds: 1234567890100,
          }),
    ).toMatchObject({ verified: true });
    expect(
      await restartedRepositories.workerJobRepository.load(createJobId(String(deliveryId))),
    ).toMatchObject({
      status: "completed",
    });
    expect(telemetry.metrics).toEqual([
      expect.objectContaining({
        name: "webhook_dispatcher.dispatch.total",
        labels: expect.objectContaining({ outcome: "delivered" }),
      }),
    ]);
    expect(telemetry.auditEntries).toEqual([
      expect.objectContaining({
        outcome: "delivered",
        correlationId: "webhook-dispatcher-app-correlation",
      }),
    ]);
  });

  it("retries failed webhook deliveries and then moves terminal failures to dead letter", async () => {
    const stateDirectory = await createTempStateDirectory();
    const deliveryId = createWebhookDeliveryId("webhook-delivery-app-dlq");
    const webhookId = createWebhookId("webhook-app-dlq");
    const repositories = createDurableJsonRepositorySet(stateDirectory);
    await seedWebhookWork(repositories, webhookId, deliveryId);
    const queue = new InMemoryQueueProvider({
      workerJobRepository: repositories.workerJobRepository,
    });
    await queue.enqueue(
      {
        jobId: createJobId(String(deliveryId)),
        ownerContext: "webhook_delivery",
        ownerRef: String(deliveryId),
        workType: "webhook_delivery",
        retryPolicy,
        idempotencyKey: "webhook-dispatcher-app-dlq",
      },
      context,
    );
    const gateway = new RecordingWebhookHttpGateway([
      { statusCode: 503 },
      { statusCode: 404, failureReasonCode: "receiver_subscription_missing" },
    ]);
    const app = new WebhookDispatcherApp({
      runtime: createWebhookDispatcherRuntime({
        queueProvider: queue,
        envelopeResolver: createResolver(repositories),
        transport: createSignedTransport(gateway),
        retryDelayMilliseconds: 0,
      }),
      contextFactory: () => context,
    });

    const retry = await app.runOnce();
    const deadLetter = await app.runOnce();

    expect(retry).toMatchObject({
      outcome: "retry_scheduled",
      reasonCode: "receiver_retryable_failure",
    });
    expect(deadLetter).toMatchObject({
      outcome: "dead_lettered",
      reasonCode: "receiver_subscription_missing",
    });
    expect(
      await repositories.workerJobRepository.load(createJobId(String(deliveryId))),
    ).toMatchObject({
      status: "dead",
      deadLetterReason: expect.objectContaining({
        code: "receiver_subscription_missing",
      }),
    });
  });
});

async function createTempStateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "omniwa-webhook-dispatcher-"));
  tempDirectories.push(directory);
  return directory;
}

async function seedWebhookWork(
  repositories: ReturnType<typeof createDurableJsonRepositorySet>,
  webhookId: ReturnType<typeof createWebhookId>,
  deliveryId: ReturnType<typeof createWebhookDeliveryId>,
): Promise<void> {
  await repositories.webhookSubscriptionRepository.save(
    activateWebhookSubscription(
      validateWebhookSubscription(
        createWebhookSubscription(webhookId, createWebhookUrl("https://receiver.example.test/a")),
      ),
    ),
  );
  await repositories.webhookDeliveryRepository.save(
    scheduleWebhookDelivery(deliveryId, webhookId, "message.delivered.v1", retryPolicy),
  );
}

function createResolver(
  repositories: ReturnType<typeof createDurableJsonRepositorySet>,
): RepositoryWebhookDeliveryEnvelopeResolver {
  return new RepositoryWebhookDeliveryEnvelopeResolver({
    webhookDeliveryRepository: repositories.webhookDeliveryRepository,
    webhookSubscriptionRepository: repositories.webhookSubscriptionRepository,
    signingSecretRefForDelivery: () => "OMNIWA_WEBHOOK_SIGNING_SECRET",
  });
}

function createSignedTransport(gateway: WebhookHttpGateway): HttpWebhookTransportAdapter {
  return new HttpWebhookTransportAdapter({
    gateway,
    signatureProvider: new WebhookHmacSignatureProvider({
      secretProvider: new FakeSecretProvider({
        OMNIWA_WEBHOOK_SIGNING_SECRET: "webhook-dispatcher-app-secret",
      }),
      clock: {
        epochMilliseconds: () => 1234567890000,
      },
    }),
  });
}

class RecordingWebhookHttpGateway implements WebhookHttpGateway {
  readonly requests: WebhookOutboundRequest[] = [];
  private readonly responses: WebhookOutboundResult[];

  constructor(responses: readonly WebhookOutboundResult[]) {
    this.responses = [...responses];
  }

  sendWebhook(request: WebhookOutboundRequest): WebhookOutboundResult {
    this.requests.push(request);
    return this.responses.shift() ?? { statusCode: 200 };
  }
}

class FakeSecretProvider implements SecretProvider {
  constructor(private readonly secrets: Readonly<Record<string, string>> = {}) {}

  readSecret(descriptor: SecretDescriptor): Promise<Result<SecretValue, OmniwaError>> {
    const value = this.secrets[String(descriptor.name)];

    if (value === undefined) {
      return Promise.resolve(
        fail({
          category: "configuration",
          code: "secret_not_found",
          message: "Secret is not configured.",
          retryable: false,
        }),
      );
    }

    return Promise.resolve(succeed(SecretValue.fromString(value)));
  }
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
