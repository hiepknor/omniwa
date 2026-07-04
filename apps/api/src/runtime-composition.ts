import { join } from "node:path";

import type {
  AuditRecordRepositoryPort,
  LabelRepositoryPort,
  MediaAssetRepositoryPort,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";
import { createSecretName, createSecretPurpose, type SecretProvider } from "@omniwa/config";
import {
  SecurityAuditEvidenceApplicationService,
  createApplicationDispatcher,
  createDomainEventPublisher,
  type AuditRecordSourceSignalRecorder,
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
  InMemoryFixedWindowRateLimiter,
  RedisRateLimitCounterStore,
  SharedFixedWindowRateLimiter,
  type ApiRateLimiter,
  type ApiRateLimitEndpointClass,
  type RedisRateLimitScriptClient,
} from "./api-rate-limiter.js";
import {
  DomainAuditRecordApiSecurityAuditSink,
  DurableJsonApiSecurityAuditSink,
  InMemoryApiSecurityAuditSink,
  type ApiSecurityAuditSink,
} from "./api-security-audit.js";
import { createNodeRedisRateLimitScriptClient } from "./redis-rate-limit-client.js";
import { RepositoryApiResourceOwnershipResolver } from "./repository-resource-ownership-resolver.js";
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

export type ApiRuntimeCompositionAdapterOptions = Readonly<{
  redisRateLimitScriptClient?: RedisRateLimitScriptClient;
}>;

export type ApiRuntimeSecretCompositionOptions = Readonly<{
  secretProvider: SecretProvider;
  adapters?: ApiRuntimeCompositionAdapterOptions;
}>;

type ApiSecurityAuditSinkKind = "none" | "in-memory" | "durable-json" | "audit-records";

type ApiRuntimeRepositorySet = ApplicationDispatcherRepositories &
  Readonly<{
    workerJobRepository: WorkerJobRepositoryPort;
    auditRecordRepository?: AuditRecordRepositoryPort & AuditRecordSourceSignalRecorder;
    labelRepository?: LabelRepositoryPort;
    mediaAssetRepository?: MediaAssetRepositoryPort;
  }>;

export function createApiRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  adapters: ApiRuntimeCompositionAdapterOptions = {},
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
  const rateLimitBackend = readRateLimitBackend(env);
  const repositoryOwnershipResolutionEnabled = readBooleanEnv(
    env.OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY,
  );
  const redisRateLimitScriptClient = createRuntimeRedisRateLimitScriptClient(
    env,
    adapters,
    rateLimitBackend,
  );

  assertRuntimeProfileIsComposable(profile, {
    hasConfiguredApiKey:
      apiKeys.length > 0 || hashedApiKeys.length > 0 || apiKeyLifecycleStorePath !== undefined,
    repositoryProfile,
    postgresDatabaseUrl: env.OMNIWA_POSTGRES_DATABASE_URL,
    rateLimitBackend,
    rateLimitMaxRequests: readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_MAX_REQUESTS"),
    rateLimitWindowMilliseconds: readOptionalPositiveIntegerEnv(
      env,
      "OMNIWA_API_RATE_LIMIT_WINDOW_MS",
    ),
    hasRedisRateLimitScriptClient: redisRateLimitScriptClient !== undefined,
    securityAuditSinkKind: readSecurityAuditSinkKind(env),
    repositoryOwnershipResolutionEnabled,
  });

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
  const rateLimiter = createRuntimeRateLimiter(env, {
    ...adapters,
    ...optional("redisRateLimitScriptClient", redisRateLimitScriptClient),
  });
  const securityAuditSink = createRuntimeSecurityAuditSink(env, repositories);
  const resourceOwnershipResolver = createRuntimeResourceOwnershipResolver(env, repositories);
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
      ...optional("rateLimiter", rateLimiter),
      ...optional("securityAuditSink", securityAuditSink),
      ...optional("resourceOwnershipResolver", resourceOwnershipResolver),
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
    return createApiRuntimeComposition(env, options.adapters);
  }

  assertNoApiKeySourceMixingWithSecret(env);

  const secret = await options.secretProvider.readSecret(descriptor);

  if (!secret.ok) {
    throw new Error(`OmniWA API key secret is unavailable: ${secret.error.code}`);
  }

  return createApiRuntimeComposition(
    {
      ...env,
      OMNIWA_API_KEY_HASH: hashApiKey(secret.value.revealForUse()),
    },
    options.adapters,
  );
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

function createRuntimeRateLimiter(
  env: NodeJS.ProcessEnv,
  adapters: ApiRuntimeCompositionAdapterOptions,
): ApiRateLimiter | undefined {
  const maxRequests = readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_MAX_REQUESTS");
  const windowMilliseconds = readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_WINDOW_MS");
  const endpointClassLimits = readEndpointClassRateLimitEnv(env);
  const backend = readRateLimitBackend(env);
  const hasEndpointClassLimits = Object.keys(endpointClassLimits).length > 0;

  if (
    maxRequests === undefined &&
    windowMilliseconds === undefined &&
    !hasEndpointClassLimits &&
    backend === undefined
  ) {
    return undefined;
  }

  if (maxRequests === undefined || windowMilliseconds === undefined) {
    throw new Error(
      "Configure OMNIWA_API_RATE_LIMIT_MAX_REQUESTS and OMNIWA_API_RATE_LIMIT_WINDOW_MS together.",
    );
  }

  const backendOrDefault = backend ?? "in-memory";

  if (backendOrDefault === "redis") {
    if (adapters.redisRateLimitScriptClient === undefined) {
      throw new Error(
        "OMNIWA_API_RATE_LIMIT_BACKEND=redis requires OMNIWA_API_RATE_LIMIT_REDIS_URL or an injected Redis rate-limit script client.",
      );
    }

    return new SharedFixedWindowRateLimiter({
      maxRequests,
      windowMilliseconds,
      endpointClassLimits,
      store: new RedisRateLimitCounterStore({
        client: adapters.redisRateLimitScriptClient,
        ...optional("keyPrefix", readRateLimitRedisKeyPrefix(env)),
      }),
    });
  }

  return new InMemoryFixedWindowRateLimiter({
    maxRequests,
    windowMilliseconds,
    endpointClassLimits,
  });
}

function createRuntimeRedisRateLimitScriptClient(
  env: NodeJS.ProcessEnv,
  adapters: ApiRuntimeCompositionAdapterOptions,
  backend: "in-memory" | "redis" | undefined,
): RedisRateLimitScriptClient | undefined {
  if (backend !== "redis") {
    return adapters.redisRateLimitScriptClient;
  }

  if (adapters.redisRateLimitScriptClient !== undefined) {
    return adapters.redisRateLimitScriptClient;
  }

  const redisUrl = env.OMNIWA_API_RATE_LIMIT_REDIS_URL?.trim();

  if (redisUrl === undefined || redisUrl.length === 0) {
    throw new Error(
      "OMNIWA_API_RATE_LIMIT_BACKEND=redis requires OMNIWA_API_RATE_LIMIT_REDIS_URL or an injected Redis rate-limit script client.",
    );
  }

  return createNodeRedisRateLimitScriptClient({
    url: redisUrl,
    ...optional(
      "connectTimeoutMilliseconds",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS"),
    ),
    ...optional(
      "clientName",
      readOptionalStringEnv(env, "OMNIWA_API_RATE_LIMIT_REDIS_CLIENT_NAME"),
    ),
  });
}

function readRateLimitBackend(env: NodeJS.ProcessEnv): "in-memory" | "redis" | undefined {
  const value = env.OMNIWA_API_RATE_LIMIT_BACKEND?.trim();

  switch (value) {
    case undefined:
    case "":
      return undefined;
    case "in-memory":
    case "redis":
      return value;
    default:
      throw new Error("OMNIWA_API_RATE_LIMIT_BACKEND must be in-memory or redis.");
  }
}

function readRateLimitRedisKeyPrefix(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.OMNIWA_API_RATE_LIMIT_REDIS_KEY_PREFIX?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function createRuntimeSecurityAuditSink(
  env: NodeJS.ProcessEnv,
  repositories: ApiRuntimeRepositorySet,
): ApiSecurityAuditSink | undefined {
  const durablePath = env.OMNIWA_API_SECURITY_AUDIT_LOG_PATH?.trim();
  const sinkKind = readSecurityAuditSinkKind(env);

  if (sinkKind === "audit-records") {
    if (repositories.auditRecordRepository === undefined) {
      throw new Error(
        "OMNIWA_API_SECURITY_AUDIT_RECORDS requires an AuditRecordRepositoryPort-backed repository profile.",
      );
    }

    return new DomainAuditRecordApiSecurityAuditSink(
      new SecurityAuditEvidenceApplicationService({
        auditRecordRepository: repositories.auditRecordRepository,
      }),
    );
  }

  if (sinkKind === "durable-json" && durablePath !== undefined && durablePath.length > 0) {
    return new DurableJsonApiSecurityAuditSink(durablePath);
  }

  return sinkKind === "in-memory" ? new InMemoryApiSecurityAuditSink() : undefined;
}

function readSecurityAuditSinkKind(env: NodeJS.ProcessEnv): ApiSecurityAuditSinkKind {
  const durablePath = env.OMNIWA_API_SECURITY_AUDIT_LOG_PATH?.trim();
  const hasDurablePath = durablePath !== undefined && durablePath.length > 0;
  const useInMemory = readBooleanEnv(env.OMNIWA_API_SECURITY_AUDIT_IN_MEMORY);
  const useAuditRecords = readBooleanEnv(env.OMNIWA_API_SECURITY_AUDIT_RECORDS);
  const configuredSinkCount = [hasDurablePath, useInMemory, useAuditRecords].filter(Boolean).length;

  if (configuredSinkCount > 1) {
    throw new Error(
      "Configure only one API security audit sink: OMNIWA_API_SECURITY_AUDIT_LOG_PATH, OMNIWA_API_SECURITY_AUDIT_IN_MEMORY, or OMNIWA_API_SECURITY_AUDIT_RECORDS.",
    );
  }

  if (useAuditRecords) return "audit-records";
  if (hasDurablePath) return "durable-json";
  if (useInMemory) return "in-memory";

  return "none";
}

function createRuntimeResourceOwnershipResolver(
  env: NodeJS.ProcessEnv,
  repositories: ApiRuntimeRepositorySet,
): RepositoryApiResourceOwnershipResolver | undefined {
  return readBooleanEnv(env.OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY)
    ? new RepositoryApiResourceOwnershipResolver({
        ...optional("sessionRepository", repositories.sessionRepository),
        ...optional("messageRepository", repositories.messageRepository),
        ...optional("mediaAssetRepository", repositories.mediaAssetRepository),
        ...optional("chatRepository", repositories.chatRepository),
        ...optional("contactRepository", repositories.contactRepository),
        ...optional("labelRepository", repositories.labelRepository),
        ...optional("groupRepository", repositories.groupRepository),
        workerJobRepository: repositories.workerJobRepository,
      })
    : undefined;
}

function readEndpointClassRateLimitEnv(
  env: NodeJS.ProcessEnv,
): Partial<Record<ApiRateLimitEndpointClass, number>> {
  return {
    ...optional(
      "read",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_READ_MAX_REQUESTS"),
    ),
    ...optional(
      "write",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_WRITE_MAX_REQUESTS"),
    ),
    ...optional(
      "message_send",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_MESSAGE_SEND_MAX_REQUESTS"),
    ),
    ...optional(
      "admin",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_ADMIN_MAX_REQUESTS"),
    ),
    ...optional(
      "event_stream",
      readOptionalPositiveIntegerEnv(env, "OMNIWA_API_RATE_LIMIT_EVENT_STREAM_MAX_REQUESTS"),
    ),
  };
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
      mediaAssetRepository: postgresqlRepositories.mediaAssetRepository,
      chatRepository: postgresqlRepositories.chatRepository,
      contactRepository: postgresqlRepositories.contactRepository,
      labelRepository: postgresqlRepositories.labelRepository,
      groupRepository: postgresqlRepositories.groupRepository,
      guardrailDecisionRepository: postgresqlRepositories.guardrailDecisionRepository,
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      auditRecordRepository: postgresqlRepositories.auditRecordRepository,
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

function readOptionalPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readOptionalStringEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function assertRuntimeProfileIsComposable(
  profile: ApiRuntimeProfile,
  options: Readonly<{
    hasConfiguredApiKey: boolean;
    repositoryProfile: ApiRepositoryProfile;
    postgresDatabaseUrl: string | undefined;
    rateLimitBackend: "in-memory" | "redis" | undefined;
    rateLimitMaxRequests: number | undefined;
    rateLimitWindowMilliseconds: number | undefined;
    hasRedisRateLimitScriptClient: boolean;
    securityAuditSinkKind: ApiSecurityAuditSinkKind;
    repositoryOwnershipResolutionEnabled: boolean;
  }>,
): void {
  if (profile === "production") {
    if (options.repositoryProfile !== "postgresql") {
      throw new Error(
        "OmniWA API production profile requires OMNIWA_API_REPOSITORY_PROFILE=postgresql.",
      );
    }

    assertProductionPostgresqlDatabaseUrl(options.postgresDatabaseUrl);
    assertProductionRateLimitConfiguration(options);
    assertProductionSecurityAuditConfiguration(options.securityAuditSinkKind);
    assertProductionResourceOwnershipConfiguration(options.repositoryOwnershipResolutionEnabled);

    throw new Error(
      "OmniWA API production profile remains disabled until production queue and observability adapters are implemented.",
    );
  }

  if (profile !== "test" && !options.hasConfiguredApiKey) {
    throw new Error(
      "OmniWA API runtime requires OMNIWA_API_KEY or OMNIWA_API_KEY_HASH for local and production profiles.",
    );
  }
}

function assertProductionSecurityAuditConfiguration(sinkKind: ApiSecurityAuditSinkKind): void {
  if (sinkKind !== "audit-records") {
    throw new Error(
      "OmniWA API production profile requires OMNIWA_API_SECURITY_AUDIT_RECORDS=true.",
    );
  }
}

function assertProductionResourceOwnershipConfiguration(enabled: boolean): void {
  if (!enabled) {
    throw new Error(
      "OmniWA API production profile requires OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true.",
    );
  }
}

function assertProductionRateLimitConfiguration(options: {
  rateLimitBackend: "in-memory" | "redis" | undefined;
  rateLimitMaxRequests: number | undefined;
  rateLimitWindowMilliseconds: number | undefined;
  hasRedisRateLimitScriptClient: boolean;
}): void {
  if (
    options.rateLimitMaxRequests === undefined ||
    options.rateLimitWindowMilliseconds === undefined
  ) {
    throw new Error(
      "OmniWA API production profile requires OMNIWA_API_RATE_LIMIT_MAX_REQUESTS and OMNIWA_API_RATE_LIMIT_WINDOW_MS.",
    );
  }

  if (options.rateLimitBackend !== "redis") {
    throw new Error("OmniWA API production profile requires OMNIWA_API_RATE_LIMIT_BACKEND=redis.");
  }

  if (!options.hasRedisRateLimitScriptClient) {
    throw new Error(
      "OmniWA API production profile requires a configured Redis rate-limit script client.",
    );
  }
}

function assertProductionPostgresqlDatabaseUrl(value: string | undefined): void {
  const databaseUrl = value?.trim();

  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      "OmniWA API production profile requires OMNIWA_POSTGRES_DATABASE_URL with production credentials.",
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("OMNIWA_POSTGRES_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("OMNIWA_POSTGRES_DATABASE_URL must use the postgres or postgresql protocol.");
  }

  if (isLocalDatabaseHost(parsed.hostname)) {
    throw new Error(
      "OmniWA API production profile must not use local PostgreSQL host credentials.",
    );
  }

  if (parsed.username.length === 0 || parsed.password.length === 0) {
    throw new Error("OmniWA API production profile requires a PostgreSQL username and password.");
  }

  if (isKnownDevelopmentDatabaseCredential(parsed.username, parsed.password)) {
    throw new Error(
      "OmniWA API production profile must not use known development PostgreSQL credentials.",
    );
  }
}

function isLocalDatabaseHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isKnownDevelopmentDatabaseCredential(username: string, password: string): boolean {
  const normalizedUsername = decodeURIComponent(username).trim().toLowerCase();
  const normalizedPassword = decodeURIComponent(password).trim().toLowerCase();

  return (
    normalizedUsername === "omniwa" ||
    normalizedUsername === "postgres" ||
    normalizedPassword === "omniwa" ||
    normalizedPassword === "postgres" ||
    normalizedPassword === "password" ||
    normalizedPassword === "local-dev-secret-change-me"
  );
}
