import {
  createApplicationPortFailure,
  type QueueProviderPort,
  type WebhookTransportPort,
} from "@omniwa/application";
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
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { EnvSecretProvider } from "@omniwa/infrastructure-secrets";
import {
  FetchWebhookHttpGateway,
  HttpWebhookTransportAdapter,
  WebhookHmacSignatureProvider,
  type WebhookFetch,
} from "@omniwa/infrastructure-webhook";

import {
  RepositoryWebhookDeliveryEnvelopeResolver,
  WebhookDispatcherApp,
  createWebhookDispatcherRuntime,
} from "./webhook-dispatcher-app.js";

export const webhookDispatcherRuntimeProfiles = ["local", "test", "production"] as const;

export type WebhookDispatcherRuntimeProfile = (typeof webhookDispatcherRuntimeProfiles)[number];

export const webhookDispatcherRepositoryProfiles = [
  "in-memory",
  "durable-json",
  "postgresql",
] as const;

export type WebhookDispatcherRepositoryProfile =
  (typeof webhookDispatcherRepositoryProfiles)[number];

export type WebhookDispatcherRuntimeComposition = Readonly<{
  profile: WebhookDispatcherRuntimeProfile;
  repositoryProfile: WebhookDispatcherRepositoryProfile;
  queueProvider: QueueProviderPort & WebhookDispatcherQueueRecoveryCapable;
  app: WebhookDispatcherApp;
}>;

export type WebhookDispatcherRuntimeCompositionAdapterOptions = Readonly<{
  webhookFetch?: WebhookFetch;
}>;

export type WebhookDispatcherQueueRecoveryCapable = Readonly<{
  recoverVisibleJobs?: () => Promise<Readonly<{ recovered: number }>>;
}>;

type WebhookDispatcherRepositories = Readonly<{
  workerJobRepository: WorkerJobRepositoryPort;
  webhookDeliveryRepository: WebhookDeliveryRepositoryPort;
  webhookSubscriptionRepository: WebhookSubscriptionRepositoryPort;
}>;

export function createWebhookDispatcherRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  adapters: WebhookDispatcherRuntimeCompositionAdapterOptions = {},
): WebhookDispatcherRuntimeComposition {
  const profile = readWebhookDispatcherRuntimeProfile(env);
  const repositoryProfile = readWebhookDispatcherRepositoryProfile(env);
  const signingSecretName = readOptionalStringEnv(env, "OMNIWA_WEBHOOK_SIGNING_SECRET_NAME");

  assertWebhookDispatcherRuntimeProfileIsComposable(profile);

  const repositories = createWebhookDispatcherRepositories(env, repositoryProfile);
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: repositories.workerJobRepository,
  });
  const runtime = createWebhookDispatcherRuntime({
    queueProvider,
    envelopeResolver: new RepositoryWebhookDeliveryEnvelopeResolver({
      webhookDeliveryRepository: repositories.webhookDeliveryRepository,
      webhookSubscriptionRepository: repositories.webhookSubscriptionRepository,
      ...optional(
        "signingSecretRefForDelivery",
        signingSecretName === undefined ? undefined : () => signingSecretName,
      ),
    }),
    transport: createWebhookDispatcherTransport(env, adapters, signingSecretName),
    retryDelayMilliseconds: readNonNegativeIntegerEnv(
      env.OMNIWA_WEBHOOK_DISPATCHER_RETRY_DELAY_MS,
      1_000,
      "OMNIWA_WEBHOOK_DISPATCHER_RETRY_DELAY_MS",
    ),
  });

  return Object.freeze({
    profile,
    repositoryProfile,
    queueProvider,
    app: new WebhookDispatcherApp({ runtime }),
  });
}

function createWebhookDispatcherTransport(
  env: NodeJS.ProcessEnv,
  adapters: WebhookDispatcherRuntimeCompositionAdapterOptions,
  signingSecretName: string | undefined,
): WebhookTransportPort {
  const gateway = readWebhookDispatcherHttpGateway(env);

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

function readWebhookDispatcherHttpGateway(env: NodeJS.ProcessEnv): "disabled" | "fetch" {
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

    const postgresqlRepositories = createPostgresqlRepositorySet(
      createPostgresqlConnectionPool(databaseUrl),
      {
        autoMigrate: readBooleanEnv(env.OMNIWA_POSTGRES_AUTO_MIGRATE),
      },
    );

    return Object.freeze({
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      webhookDeliveryRepository: postgresqlRepositories.webhookDeliveryRepository,
      webhookSubscriptionRepository: postgresqlRepositories.webhookSubscriptionRepository,
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
  profile: WebhookDispatcherRuntimeProfile,
): void {
  if (profile === "production") {
    throw new Error(
      "OmniWA Webhook Dispatcher production profile requires production queue, webhook HTTP gateway, secret, and observability adapters before runtime composition is allowed.",
    );
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
