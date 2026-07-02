import { createApplicationDispatcher } from "@omniwa/application";
import {
  createDurableJsonRepositorySet,
  createDurableJsonEventLogStore,
  createInMemoryRepositorySet,
} from "@omniwa/infrastructure-persistence";

import { createApiKeyVerifierFromPlaintext } from "./api-key-auth.js";
import { readApiKeysFromEnv, type ApiHttpServerOptions, type ApiKeyConfig } from "./http-server.js";
import { createEventLogRealtimeEventSource } from "./realtime-event-stream.js";

export const apiRuntimeProfiles = ["local", "test", "production"] as const;

export type ApiRuntimeProfile = (typeof apiRuntimeProfiles)[number];

export const apiRepositoryProfiles = ["in-memory", "durable-json"] as const;

export type ApiRepositoryProfile = (typeof apiRepositoryProfiles)[number];

export type ApiRuntimeComposition = Readonly<{
  profile: ApiRuntimeProfile;
  repositoryProfile: ApiRepositoryProfile;
  options: ApiHttpServerOptions;
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
  const eventSource =
    eventLogPath === undefined || eventLogPath.length === 0
      ? undefined
      : createEventLogRealtimeEventSource(createDurableJsonEventLogStore(eventLogPath));
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      healthStatusRepository: repositories.healthStatusRepository,
    },
  });

  return Object.freeze({
    profile,
    repositoryProfile,
    options: Object.freeze({
      dispatcher,
      ...optional("eventSource", eventSource),
      ...(apiKeys.length === 0
        ? { apiKeys }
        : { apiKeyVerifier: createApiKeyVerifierFromPlaintext(apiKeys) }),
    }),
  });
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
):
  | ReturnType<typeof createInMemoryRepositorySet>
  | ReturnType<typeof createDurableJsonRepositorySet> {
  if (repositoryProfile === "in-memory") {
    return createInMemoryRepositorySet();
  }

  const stateDirectory = env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_API_REPOSITORY_STATE_DIR is required when OMNIWA_API_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return createDurableJsonRepositorySet(stateDirectory);
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
