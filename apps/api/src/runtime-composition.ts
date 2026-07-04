import { join } from "node:path";

import type { WorkerJobRepositoryPort } from "@omniwa/domain";
import { createSecretName, createSecretPurpose, type SecretProvider } from "@omniwa/config";
import {
  createApplicationDispatcher,
  createDomainEventPublisher,
  type ApplicationDispatcherRepositories,
} from "@omniwa/application";
import {
  DurableJsonGroupMutationIntentStore,
  DurableJsonOutboundMessageIntentStore,
  InMemoryGroupMutationIntentStore,
  InMemoryOutboundMessageIntentStore,
  createDurableJsonRepositorySet,
  createDurableJsonEventLogStore,
  createInMemoryEventLogStore,
  createInMemoryRepositorySet,
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";

import {
  createApiKeyVerifierFromPlaintext,
  createHashedApiKeyVerifier,
  hashApiKey,
  type ApiKeyVerifier,
  type HashedApiKeyConfig,
} from "./api-key-auth.js";
import { ApiKeyLifecycleService, DurableJsonApiKeyLifecycleStore } from "./api-key-lifecycle.js";
import {
  readApiKeysFromEnv,
  readHashedApiKeysFromEnv,
  type ApiHttpServerOptions,
  type ApiKeyConfig,
} from "./http-server.js";
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

export type ApiRuntimeSecretCompositionOptions = Readonly<{
  secretProvider: SecretProvider;
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
  const hashedApiKeys = readHashedApiKeysFromEnv(env);
  const apiKeyLifecycleStorePath = readApiKeyLifecycleStorePath(env);
  const apiKeyLifecycleStore =
    apiKeyLifecycleStorePath === undefined
      ? undefined
      : new DurableJsonApiKeyLifecycleStore(apiKeyLifecycleStorePath);
  const apiKeyVerifier = createRuntimeApiKeyVerifier(apiKeys, hashedApiKeys, apiKeyLifecycleStore);

  assertRuntimeProfileIsComposable(
    profile,
    apiKeys.length > 0 || hashedApiKeys.length > 0 || apiKeyLifecycleStorePath !== undefined,
  );

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
  const groupMutationIntentStore = createRuntimeGroupMutationIntentStore(env, repositoryProfile);
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
      ...optional("chatRepository", repositories.chatRepository),
      ...optional("contactRepository", repositories.contactRepository),
      ...optional("groupRepository", repositories.groupRepository),
      ...optional("guardrailDecisionRepository", repositories.guardrailDecisionRepository),
      ...optional("workerJobRepository", repositories.workerJobRepository),
      ...optional("webhookSubscriptionRepository", repositories.webhookSubscriptionRepository),
      ...optional("webhookDeliveryRepository", repositories.webhookDeliveryRepository),
    },
    outboundMessageIntentStore,
    groupMutationIntentStore,
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
      groupMutationIntentStore,
      ...optional("eventSource", eventSource),
      ...optional(
        "apiKeyLifecycleService",
        apiKeyLifecycleStore === undefined
          ? undefined
          : new ApiKeyLifecycleService({ store: apiKeyLifecycleStore }),
      ),
      ...(apiKeyVerifier === undefined ? { apiKeys } : { apiKeyVerifier }),
    }),
  });
}

export async function createApiRuntimeCompositionFromSecrets(
  env: NodeJS.ProcessEnv = process.env,
  options: ApiRuntimeSecretCompositionOptions,
): Promise<ApiRuntimeComposition> {
  const descriptor = readApiKeySecretDescriptor(env);

  if (descriptor === undefined) {
    return createApiRuntimeComposition(env);
  }

  assertNoApiKeySourceMixingWithSecret(env);

  const secret = await options.secretProvider.readSecret(descriptor);

  if (!secret.ok) {
    throw new Error(`OmniWA API key secret is unavailable: ${secret.error.code}`);
  }

  return createApiRuntimeComposition({
    ...env,
    OMNIWA_API_KEY_HASH: hashApiKey(secret.value.revealForUse()),
  });
}

function createRuntimeApiKeyVerifier(
  apiKeys: readonly ApiKeyConfig[],
  hashedApiKeys: readonly HashedApiKeyConfig[],
  apiKeyLifecycleStore: DurableJsonApiKeyLifecycleStore | undefined,
): ApiKeyVerifier | undefined {
  const configuredSources = [
    apiKeys.length > 0 ? "OMNIWA_API_KEY" : undefined,
    hashedApiKeys.length > 0 ? "OMNIWA_API_KEY_HASH" : undefined,
    apiKeyLifecycleStore !== undefined ? "OMNIWA_API_KEY_LIFECYCLE_STORE_PATH" : undefined,
  ].filter((source): source is string => source !== undefined);

  if (configuredSources.length > 1) {
    throw new Error(
      "Configure exactly one API key source: OMNIWA_API_KEY, OMNIWA_API_KEY_HASH, or OMNIWA_API_KEY_LIFECYCLE_STORE_PATH.",
    );
  }

  if (apiKeyLifecycleStore !== undefined) {
    const records = apiKeyLifecycleStore.listApiKeyRecordsSync();

    if (!records.some((record) => record.status === "active")) {
      throw new Error("OMNIWA_API_KEY_LIFECYCLE_STORE_PATH must contain an active API key.");
    }

    return createApiKeyLifecycleStoreVerifier(apiKeyLifecycleStore);
  }

  if (hashedApiKeys.length > 0) {
    return createHashedApiKeyVerifier(hashedApiKeys);
  }

  if (apiKeys.length > 0) {
    return createApiKeyVerifierFromPlaintext(apiKeys);
  }

  return undefined;
}

function createApiKeyLifecycleStoreVerifier(
  store: DurableJsonApiKeyLifecycleStore,
): ApiKeyVerifier {
  return {
    verify(providedKey: string | undefined) {
      return createHashedApiKeyVerifier(store.listApiKeyRecordsSync()).verify(providedKey);
    },
  };
}

function readApiKeyLifecycleStorePath(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.OMNIWA_API_KEY_LIFECYCLE_STORE_PATH?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function readApiKeySecretDescriptor(env: NodeJS.ProcessEnv) {
  const name = env.OMNIWA_API_KEY_SECRET_NAME?.trim();

  if (name === undefined || name.length === 0) {
    return undefined;
  }

  return Object.freeze({
    name: createSecretName(name),
    purpose: createSecretPurpose(env.OMNIWA_API_KEY_SECRET_PURPOSE?.trim() || "api-authentication"),
  });
}

function assertNoApiKeySourceMixingWithSecret(env: NodeJS.ProcessEnv): void {
  const configuredSources = [
    env.OMNIWA_API_KEY?.trim() ? "OMNIWA_API_KEY" : undefined,
    env.OMNIWA_API_KEY_HASH?.trim() ? "OMNIWA_API_KEY_HASH" : undefined,
    env.OMNIWA_API_KEY_LIFECYCLE_STORE_PATH?.trim()
      ? "OMNIWA_API_KEY_LIFECYCLE_STORE_PATH"
      : undefined,
  ].filter((source): source is string => source !== undefined);

  if (configuredSources.length > 0) {
    throw new Error(
      "Configure OMNIWA_API_KEY_SECRET_NAME without OMNIWA_API_KEY, OMNIWA_API_KEY_HASH, or OMNIWA_API_KEY_LIFECYCLE_STORE_PATH.",
    );
  }
}

function createRuntimeGroupMutationIntentStore(
  env: NodeJS.ProcessEnv,
  repositoryProfile: ApiRepositoryProfile,
): InMemoryGroupMutationIntentStore | DurableJsonGroupMutationIntentStore {
  if (repositoryProfile !== "durable-json") {
    return new InMemoryGroupMutationIntentStore();
  }

  const stateDirectory = env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_API_REPOSITORY_STATE_DIR is required when OMNIWA_API_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return new DurableJsonGroupMutationIntentStore(
    join(stateDirectory, "group-mutation-intents.json"),
  );
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

    const postgresqlRepositories = createPostgresqlRepositorySet(
      createPostgresqlConnectionPool(databaseUrl),
      {
        autoMigrate: readBooleanEnv(env.OMNIWA_POSTGRES_AUTO_MIGRATE),
      },
    );

    return Object.freeze({
      instanceRepository: postgresqlRepositories.instanceRepository,
      healthStatusRepository: postgresqlRepositories.healthStatusRepository,
      sessionRepository: postgresqlRepositories.sessionRepository,
      messageRepository: postgresqlRepositories.messageRepository,
      chatRepository: postgresqlRepositories.chatRepository,
      contactRepository: postgresqlRepositories.contactRepository,
      groupRepository: postgresqlRepositories.groupRepository,
      guardrailDecisionRepository: postgresqlRepositories.guardrailDecisionRepository,
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      webhookSubscriptionRepository: postgresqlRepositories.webhookSubscriptionRepository,
      webhookDeliveryRepository: postgresqlRepositories.webhookDeliveryRepository,
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
  hasConfiguredApiKey: boolean,
): void {
  if (profile === "production") {
    throw new Error(
      "OmniWA API production profile requires production persistence, secret, queue, and observability adapters before runtime composition is allowed.",
    );
  }

  if (profile !== "test" && !hasConfiguredApiKey) {
    throw new Error(
      "OmniWA API runtime requires OMNIWA_API_KEY or OMNIWA_API_KEY_HASH for local and production profiles.",
    );
  }
}
