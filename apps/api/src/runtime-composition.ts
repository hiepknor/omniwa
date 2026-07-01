import { createApplicationDispatcher } from "@omniwa/application";
import { createInMemoryRepositorySet } from "@omniwa/infrastructure-persistence";

import { readApiKeysFromEnv, type ApiHttpServerOptions, type ApiKeyConfig } from "./http-server.js";

export const apiRuntimeProfiles = ["local", "test", "production"] as const;

export type ApiRuntimeProfile = (typeof apiRuntimeProfiles)[number];

export type ApiRuntimeComposition = Readonly<{
  profile: ApiRuntimeProfile;
  options: ApiHttpServerOptions;
}>;

export function createApiRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
): ApiRuntimeComposition {
  const profile = readRuntimeProfile(env);
  const apiKeys = readApiKeysFromEnv(env);

  assertRuntimeProfileIsComposable(profile, apiKeys);

  const repositories = createInMemoryRepositorySet();
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      healthStatusRepository: repositories.healthStatusRepository,
    },
  });

  return Object.freeze({
    profile,
    options: Object.freeze({
      dispatcher,
      apiKeys,
    }),
  });
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
