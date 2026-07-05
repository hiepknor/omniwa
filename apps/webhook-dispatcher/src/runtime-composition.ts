import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createApplicationPortFailure, type WebhookTransportPort } from "@omniwa/application";
import type {
  WebhookDeliveryRepositoryPort,
  WebhookSubscriptionRepositoryPort,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";
import {
  createDurableJsonRepositorySet,
  createInMemoryRepositorySet,
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { JsonLineFileSink, JsonLineMetricRecorder } from "@omniwa/infrastructure-observability";
import { DurableWorkerJobQueueProvider, InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { EnvSecretProvider } from "@omniwa/infrastructure-secrets";
import {
  FetchWebhookHttpGateway,
  HttpWebhookTransportAdapter,
  WebhookHmacSignatureProvider,
  type WebhookFetch,
} from "@omniwa/infrastructure-webhook";
import type { MetricRecorder } from "@omniwa/observability";

import {
  RepositoryWebhookDeliveryEnvelopeResolver,
  WebhookDispatcherApp,
  createWebhookDispatcherRuntime,
  type WebhookDispatchAuditSink,
} from "./webhook-dispatcher-app.js";
import { JsonLineWebhookDispatchAuditSink } from "./webhook-dispatcher-observability.js";

export const webhookDispatcherRuntimeProfiles = ["local", "test", "production"] as const;

export type WebhookDispatcherRuntimeProfile = (typeof webhookDispatcherRuntimeProfiles)[number];

export const webhookDispatcherRepositoryProfiles = [
  "in-memory",
  "durable-json",
  "postgresql",
] as const;

export type WebhookDispatcherRepositoryProfile =
  (typeof webhookDispatcherRepositoryProfiles)[number];

export const webhookDispatcherQueueProfiles = ["in-memory", "durable-worker-job"] as const;

export type WebhookDispatcherQueueProfile = (typeof webhookDispatcherQueueProfiles)[number];

export type WebhookDispatcherRuntimeComposition = Readonly<{
  profile: WebhookDispatcherRuntimeProfile;
  repositoryProfile: WebhookDispatcherRepositoryProfile;
  queueProfile: WebhookDispatcherQueueProfile;
  queueProvider: (InMemoryQueueProvider | DurableWorkerJobQueueProvider) &
    WebhookDispatcherQueueRecoveryCapable;
  app: WebhookDispatcherApp;
  dispose?: () => Promise<void>;
}>;

export type WebhookDispatcherRuntimeCompositionAdapterOptions = Readonly<{
  webhookFetch?: WebhookFetch;
  metricRecorder?: MetricRecorder;
  auditSink?: WebhookDispatchAuditSink;
}>;

export type WebhookDispatcherQueueRecoveryCapable = Readonly<{
  recoverVisibleJobs?: () => Promise<Readonly<{ recovered: number }>>;
}>;

type WebhookDispatcherRepositories = Readonly<{
  workerJobRepository: WorkerJobRepositoryPort;
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  webhookSubscriptionRepository: WebhookSubscriptionRepositoryPort;
  dispose?: () => Promise<void>;
}>;

type WebhookDispatcherHttpGateway = "disabled" | "fetch";
type WebhookDispatcherRuntimeObservability = Readonly<{
  metricRecorder?: MetricRecorder;
  auditSink?: WebhookDispatchAuditSink;
}>;

export function createWebhookDispatcherRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  adapters: WebhookDispatcherRuntimeCompositionAdapterOptions = {},
): WebhookDispatcherRuntimeComposition {
  const profile = readWebhookDispatcherRuntimeProfile(env);
  const repositoryProfile = readWebhookDispatcherRepositoryProfile(env);
  const queueProfile = readWebhookDispatcherQueueProfile(env);
  const signingSecretName = readOptionalStringEnv(env, "OMNIWA_WEBHOOK_SIGNING_SECRET_NAME");
  const httpGateway = readWebhookDispatcherHttpGateway(env);
  const observability = createWebhookDispatcherRuntimeObservability(env, adapters);

  assertWebhookDispatcherRuntimeProfileIsComposable({
    profile,
    repositoryProfile,
    queueProfile,
    httpGateway,
    signingSecretName,
    env,
    observability,
  });

  const repositories = createWebhookDispatcherRepositories(env, repositoryProfile);
  const queueProvider = createWebhookDispatcherQueueProvider({
    queueProfile,
    workerJobRepository: repositories.workerJobRepository,
    ...optional("metricRecorder", observability.metricRecorder),
  });
  const runtime = createWebhookDispatcherRuntime({
    queueProvider,
    webhookDeliveryRepository: repositories.webhookDeliveryRepository,
    envelopeResolver: new RepositoryWebhookDeliveryEnvelopeResolver({
      webhookDeliveryRepository: repositories.webhookDeliveryRepository,
      webhookSubscriptionRepository: repositories.webhookSubscriptionRepository,
      ...optional(
        "signingSecretRefForDelivery",
        signingSecretName === undefined ? undefined : () => signingSecretName,
      ),
    }),
    transport: createWebhookDispatcherTransport(env, adapters, signingSecretName, httpGateway),
    retryDelayMilliseconds: readNonNegativeIntegerEnv(
      env.OMNIWA_WEBHOOK_DISPATCHER_RETRY_DELAY_MS,
      1_000,
      "OMNIWA_WEBHOOK_DISPATCHER_RETRY_DELAY_MS",
    ),
    ...optional("metricRecorder", observability.metricRecorder),
    ...optional("auditSink", observability.auditSink),
  });

  return Object.freeze({
    profile,
    repositoryProfile,
    queueProfile,
    queueProvider,
    app: new WebhookDispatcherApp({ runtime }),
    ...optional("dispose", repositories.dispose),
  });
}

function createWebhookDispatcherTransport(
  env: NodeJS.ProcessEnv,
  adapters: WebhookDispatcherRuntimeCompositionAdapterOptions,
  signingSecretName: string | undefined,
  gateway: WebhookDispatcherHttpGateway,
): WebhookTransportPort {
  if (gateway === "disabled") {
    return new DisabledWebhookTransport();
  }

  if (signingSecretName === undefined) {
    throw new Error(
      "OMNIWA_WEBHOOK_SIGNING_SECRET_NAME is required when OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch.",
    );
  }

  return new HttpWebhookTransportAdapter({
    gateway: new FetchWebhookHttpGateway({
      ...optional("fetch", adapters.webhookFetch),
    }),
    signatureProvider: new WebhookHmacSignatureProvider({
      secretProvider: new EnvSecretProvider({ env }),
    }),
    timeoutMilliseconds: readPositiveIntegerEnv(
      env.OMNIWA_WEBHOOK_DISPATCHER_HTTP_TIMEOUT_MS,
      10_000,
      "OMNIWA_WEBHOOK_DISPATCHER_HTTP_TIMEOUT_MS",
    ),
  });
}

function createWebhookDispatcherRuntimeObservability(
  env: NodeJS.ProcessEnv,
  adapters: WebhookDispatcherRuntimeCompositionAdapterOptions,
): WebhookDispatcherRuntimeObservability {
  return Object.freeze({
    ...optional(
      "metricRecorder",
      adapters.metricRecorder ?? createJsonLineMetricRecorderFromEnv(env),
    ),
    ...optional("auditSink", adapters.auditSink ?? createJsonLineAuditSinkFromEnv(env)),
  });
}

function createJsonLineMetricRecorderFromEnv(env: NodeJS.ProcessEnv): MetricRecorder | undefined {
  const filePath = readOptionalStringEnv(env, "OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH");

  return filePath === undefined
    ? undefined
    : new JsonLineMetricRecorder({
        sink: new JsonLineFileSink({ filePath }),
      });
}

function createJsonLineAuditSinkFromEnv(
  env: NodeJS.ProcessEnv,
): WebhookDispatchAuditSink | undefined {
  const filePath = readOptionalStringEnv(env, "OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH");

  return filePath === undefined
    ? undefined
    : new JsonLineWebhookDispatchAuditSink({
        sink: new JsonLineFileSink({ filePath }),
      });
}

function readWebhookDispatcherHttpGateway(env: NodeJS.ProcessEnv): WebhookDispatcherHttpGateway {
  const value = env.OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY?.trim();

  switch (value) {
    case "fetch":
      return "fetch";
    case "disabled":
    case undefined:
    case "":
      return "disabled";
    default:
      throw new Error(`Unsupported OmniWA Webhook Dispatcher HTTP gateway: ${value}`);
  }
}

export function readWebhookDispatcherRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): WebhookDispatcherRuntimeProfile {
  const value = env.OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE?.trim() ?? env.NODE_ENV?.trim();

  switch (value) {
    case "production":
      return "production";
    case "test":
      return "test";
    case "local":
    case "development":
    case undefined:
    case "":
      return "local";
    default:
      throw new Error(`Unsupported OmniWA Webhook Dispatcher runtime profile: ${value}`);
  }
}

export function readWebhookDispatcherRepositoryProfile(
  env: NodeJS.ProcessEnv = process.env,
): WebhookDispatcherRepositoryProfile {
  const value = env.OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE?.trim();

  switch (value) {
    case "postgresql":
      return "postgresql";
    case "durable-json":
      return "durable-json";
    case "in-memory":
    case undefined:
    case "":
      return "in-memory";
    default:
      throw new Error(`Unsupported OmniWA Webhook Dispatcher repository profile: ${value}`);
  }
}

export function readWebhookDispatcherQueueProfile(
  env: NodeJS.ProcessEnv = process.env,
): WebhookDispatcherQueueProfile {
  const value = env.OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE?.trim();

  switch (value) {
    case "durable":
    case "durable-worker-job":
      return "durable-worker-job";
    case "in-memory":
    case undefined:
    case "":
      return "in-memory";
    default:
      throw new Error(`Unsupported OmniWA Webhook Dispatcher queue profile: ${value}`);
  }
}

function createWebhookDispatcherQueueProvider(
  input: Readonly<{
    queueProfile: WebhookDispatcherQueueProfile;
    workerJobRepository: WorkerJobRepositoryPort;
    metricRecorder?: MetricRecorder;
  }>,
): InMemoryQueueProvider | DurableWorkerJobQueueProvider {
  if (input.queueProfile === "durable-worker-job") {
    return new DurableWorkerJobQueueProvider({
      workerJobRepository: input.workerJobRepository,
      metricRuntimeRole: "webhook",
      ...optional("metricRecorder", input.metricRecorder),
    });
  }

  return new InMemoryQueueProvider({
    workerJobRepository: input.workerJobRepository,
    metricRuntimeRole: "webhook",
    ...optional("metricRecorder", input.metricRecorder),
  });
}

function createWebhookDispatcherRepositories(
  env: NodeJS.ProcessEnv,
  repositoryProfile: WebhookDispatcherRepositoryProfile,
): WebhookDispatcherRepositories {
  if (repositoryProfile === "in-memory") {
    return createInMemoryRepositorySet();
  }

  if (repositoryProfile === "postgresql") {
    const databaseUrl = env.OMNIWA_POSTGRES_DATABASE_URL?.trim();

    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error(
        "OMNIWA_POSTGRES_DATABASE_URL is required when OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE=postgresql.",
      );
    }

    const connection = createPostgresqlConnectionPool(databaseUrl);
    const postgresqlRepositories = createPostgresqlRepositorySet(connection, {
      autoMigrate: readBooleanEnv(env.OMNIWA_POSTGRES_AUTO_MIGRATE),
    });

    return Object.freeze({
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      webhookDeliveryRepository: postgresqlRepositories.webhookDeliveryRepository,
      webhookSubscriptionRepository: postgresqlRepositories.webhookSubscriptionRepository,
      ...optional("dispose", connection.end?.bind(connection)),
    });
  }

  const stateDirectory =
    env.OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR?.trim() ??
    env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR is required when OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return createDurableJsonRepositorySet(stateDirectory);
}

function assertWebhookDispatcherRuntimeProfileIsComposable(
  input: Readonly<{
    profile: WebhookDispatcherRuntimeProfile;
    repositoryProfile: WebhookDispatcherRepositoryProfile;
    queueProfile: WebhookDispatcherQueueProfile;
    httpGateway: WebhookDispatcherHttpGateway;
    signingSecretName: string | undefined;
    env: NodeJS.ProcessEnv;
    observability: WebhookDispatcherRuntimeObservability;
  }>,
): void {
  if (input.profile !== "production") {
    return;
  }

  const missing: string[] = [];

  if (input.repositoryProfile !== "postgresql") {
    missing.push("OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE=postgresql");
  }

  if (input.queueProfile !== "durable-worker-job") {
    missing.push("OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job");
  }

  if (input.httpGateway !== "fetch") {
    missing.push("OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch");
  }

  if (input.signingSecretName === undefined) {
    missing.push("OMNIWA_WEBHOOK_SIGNING_SECRET_NAME");
  } else if (readOptionalStringEnv(input.env, input.signingSecretName) === undefined) {
    missing.push("configured webhook signing secret value");
  }

  if (input.observability.metricRecorder === undefined) {
    missing.push("metric recorder adapter");
  }

  if (input.observability.auditSink === undefined) {
    missing.push("webhook dispatch audit sink");
  }

  const metricsJsonlPath = readOptionalStringEnv(
    input.env,
    "OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH",
  );
  const auditJsonlPath = readOptionalStringEnv(
    input.env,
    "OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH",
  );

  if (
    metricsJsonlPath !== undefined &&
    auditJsonlPath !== undefined &&
    resolve(metricsJsonlPath) === resolve(auditJsonlPath)
  ) {
    missing.push("distinct webhook dispatcher metric and audit JSONL paths");
  }

  if (metricsJsonlPath !== undefined) {
    assertJsonLineTargetPathWritable(
      metricsJsonlPath,
      "writable webhook dispatcher metric JSONL path",
      missing,
    );
  }

  if (auditJsonlPath !== undefined) {
    assertJsonLineTargetPathWritable(
      auditJsonlPath,
      "writable webhook dispatcher audit JSONL path",
      missing,
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `OmniWA Webhook Dispatcher production profile is not composable. Missing: ${missing.join(", ")}.`,
    );
  }
}

function assertJsonLineTargetPathWritable(
  filePath: string,
  safeRequirementLabel: string,
  missing: string[],
): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const descriptor = openSync(filePath, "a");
    closeSync(descriptor);
  } catch {
    missing.push(safeRequirementLabel);
  }
}

function readNonNegativeIntegerEnv(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function readPositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalStringEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

class DisabledWebhookTransport implements WebhookTransportPort {
  deliver() {
    return Promise.resolve(
      Object.freeze({
        ok: false as const,
        error: createApplicationPortFailure({
          category: "rejected",
          code: "webhook_http_gateway_not_configured",
          message: "Webhook HTTP gateway is not configured for this runtime profile.",
          retryable: false,
          ownerContext: "webhook_delivery",
          failureCategory: "configuration",
        }),
      }),
    );
  }
}
