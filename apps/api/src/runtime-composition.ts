import { join } from "node:path";

import type { WorkerJobRepositoryPort } from "@omniwa/domain";
import {
  createApplicationDispatcher,
  createDomainEventPublisher,
  type ApplicationDispatcherRepositories,
} from "@omniwa/application";
import {
  DurableJsonOutboundMessageIntentStore,
  InMemoryOutboundMessageIntentStore,
  createDurableJsonRepositorySet,
  createDurableJsonEventLogStore,
  createInMemoryEventLogStore,
  createInMemoryRepositorySet,
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";

import { createApiKeyVerifierFromPlaintext } from "./api-key-auth.js";
import { readApiKeysFromEnv, type ApiHttpServerOptions, type ApiKeyConfig } from "./http-server.js";
import { createEventLogRealtimeEventSource } from "./realtime-event-stream.js";

export const apiRuntimeProfiles = ["local", "test", "production"] as const;

export type ApiRuntimeProfile = (typeof apiRuntimeProfiles)[number];

export const apiRepositoryProfiles = ["in-memory", "durable-json", "postgresql"] as const;

export type ApiRepositoryProfile = (typeof apiRepositoryProfiles)[number];

export type ApiRuntimeComposition = Readonly<{
  profile: ApiRuntimeProfile;
  repositoryProfile: ApiRepositoryProfile;
  options: ApiHttpServerOptions;
}>;

type ApiRuntimeRepositorySet = ApplicationDispatcherRepositories &
  Readonly<{
    workerJobRepository: WorkerJobRepositoryPort;
  }>;

export function createApiRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
): ApiRuntimeComposition {
  const profile = readRuntimeProfile(env);
  const repositoryProfile = readRepositoryProfile(env);
  const apiKeys = readApiKeysFromEnv(env);

  assertRuntimeProfileIsComposable(profile, apiKeys);

  const repositories = createRuntimeRepositories(env, repositoryProfile);
  const eventLogPath = env.OMNIWA_EVENT_LOG_PATH?.trim();
  const eventLog =
    eventLogPath === undefined || eventLogPath.length === 0
      ? createInMemoryEventLogStore()
      : createDurableJsonEventLogStore(eventLogPath);
  const eventSource =
    eventLogPath === undefined || eventLogPath.length === 0
      ? undefined
      : createEventLogRealtimeEventSource(eventLog);
  const outboundMessageIntentStore = createRuntimeOutboundMessageIntentStore(
    env,
    repositoryProfile,
  );
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: repositories.workerJobRepository,
  });
  const domainEventPublisher = createDomainEventPublisher({
    eventLog,
    nowIso: () => new Date().toISOString(),
  });
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      ...optional("healthStatusRepository", repositories.healthStatusRepository),
      ...optional("sessionRepository", repositories.sessionRepository),
      ...optional("messageRepository", repositories.messageRepository),
      ...optional("guardrailDecisionRepository", repositories.guardrailDecisionRepository),
      ...optional("workerJobRepository", repositories.workerJobRepository),
      ...optional("webhookSubscriptionRepository", repositories.webhookSubscriptionRepository),
      ...optional("webhookDeliveryRepository", repositories.webhookDeliveryRepository),
    },
    outboundMessageIntentStore,
    queueProvider,
    domainEventPublisher,
    eventLog,
  });

  return Object.freeze({
    profile,
    repositoryProfile,
    options: Object.freeze({
      dispatcher,
      outboundMessageIntentStore,
      ...optional("eventSource", eventSource),
      ...(apiKeys.length === 0
        ? { apiKeys }
        : { apiKeyVerifier: createApiKeyVerifierFromPlaintext(apiKeys) }),
    }),
  });
}

function createRuntimeOutboundMessageIntentStore(
  env: NodeJS.ProcessEnv,
  repositoryProfile: ApiRepositoryProfile,
): InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore {
  if (repositoryProfile !== "durable-json") {
    return new InMemoryOutboundMessageIntentStore();
  }

  const stateDirectory = env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_API_REPOSITORY_STATE_DIR is required when OMNIWA_API_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return new DurableJsonOutboundMessageIntentStore(
    join(stateDirectory, "outbound-message-intents.json"),
  );
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

export function readRuntimeProfile(env: NodeJS.ProcessEnv = process.env): ApiRuntimeProfile {
  const value = env.OMNIWA_API_RUNTIME_PROFILE?.trim() ?? env.NODE_ENV?.trim();

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
      throw new Error(`Unsupported OmniWA API runtime profile: ${value}`);
  }
}

export function readRepositoryProfile(env: NodeJS.ProcessEnv = process.env): ApiRepositoryProfile {
  const value = env.OMNIWA_API_REPOSITORY_PROFILE?.trim();

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
      throw new Error(`Unsupported OmniWA API repository profile: ${value}`);
  }
}

function createRuntimeRepositories(
  env: NodeJS.ProcessEnv,
  repositoryProfile: ApiRepositoryProfile,
): ApiRuntimeRepositorySet {
  if (repositoryProfile === "in-memory") {
    return createInMemoryRepositorySet();
  }

  if (repositoryProfile === "postgresql") {
    const databaseUrl = env.OMNIWA_POSTGRES_DATABASE_URL?.trim();

    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error(
        "OMNIWA_POSTGRES_DATABASE_URL is required when OMNIWA_API_REPOSITORY_PROFILE=postgresql.",
      );
    }

    const localProjectionRepositories = createInMemoryRepositorySet();
    const postgresqlRepositories = createPostgresqlRepositorySet(
      createPostgresqlConnectionPool(databaseUrl),
      {
        autoMigrate: readBooleanEnv(env.OMNIWA_POSTGRES_AUTO_MIGRATE),
      },
    );

    return Object.freeze({
      instanceRepository: postgresqlRepositories.instanceRepository,
      healthStatusRepository: localProjectionRepositories.healthStatusRepository,
      sessionRepository: localProjectionRepositories.sessionRepository,
      messageRepository: localProjectionRepositories.messageRepository,
      guardrailDecisionRepository: localProjectionRepositories.guardrailDecisionRepository,
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      webhookSubscriptionRepository: localProjectionRepositories.webhookSubscriptionRepository,
      webhookDeliveryRepository: localProjectionRepositories.webhookDeliveryRepository,
    });
  }

  const stateDirectory = env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_API_REPOSITORY_STATE_DIR is required when OMNIWA_API_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return createDurableJsonRepositorySet(stateDirectory);
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function assertRuntimeProfileIsComposable(
  profile: ApiRuntimeProfile,
  apiKeys: readonly ApiKeyConfig[],
): void {
  if (profile === "production") {
    throw new Error(
      "OmniWA API production profile requires production persistence, secret, queue, and observability adapters before runtime composition is allowed.",
    );
  }

  if (profile !== "test" && apiKeys.length === 0) {
    throw new Error(
      "OmniWA API runtime requires OMNIWA_API_KEY for local and production profiles.",
    );
  }
}
