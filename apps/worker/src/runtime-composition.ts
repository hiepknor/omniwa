import { createApplicationDispatcher, type ApplicationDispatcher } from "@omniwa/application";
import type {
  HealthStatusRepositoryPort,
  InstanceRepositoryPort,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";
import {
  createDurableJsonRepositorySet,
  createInMemoryRepositorySet,
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
} from "@omniwa/infrastructure-persistence";
import { InMemoryQueueProvider } from "@omniwa/infrastructure-queue";

import { WorkerRuntimeApp } from "./worker-app.js";
import { createApplicationWorkerHandlers } from "./worker-application-handlers.js";
import { WorkerRuntime } from "./worker-runtime.js";

export const workerRuntimeProfiles = ["local", "test", "production"] as const;

export type WorkerRuntimeProfile = (typeof workerRuntimeProfiles)[number];

export const workerRepositoryProfiles = ["in-memory", "durable-json", "postgresql"] as const;

export type WorkerRepositoryProfile = (typeof workerRepositoryProfiles)[number];

export type WorkerRuntimeComposition = Readonly<{
  profile: WorkerRuntimeProfile;
  repositoryProfile: WorkerRepositoryProfile;
  dispatcher: ApplicationDispatcher;
  queueProvider: InMemoryQueueProvider;
  app: WorkerRuntimeApp;
}>;

type WorkerRuntimeRepositories = Readonly<{
  instanceRepository: InstanceRepositoryPort;
  workerJobRepository: WorkerJobRepositoryPort;
  healthStatusRepository?: HealthStatusRepositoryPort;
}>;

export function createWorkerRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeComposition {
  const profile = readWorkerRuntimeProfile(env);
  const repositoryProfile = readWorkerRepositoryProfile(env);

  assertWorkerRuntimeProfileIsComposable(profile);

  const repositories = createWorkerRuntimeRepositories(env, repositoryProfile);
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      ...optional("healthStatusRepository", repositories.healthStatusRepository),
    },
  });
  const queueProvider = new InMemoryQueueProvider({
    workerJobRepository: repositories.workerJobRepository,
  });
  const runtime = new WorkerRuntime({
    queueProvider,
    handlers: createApplicationWorkerHandlers({
      dispatcher,
      retryDelayMilliseconds: readPositiveIntegerEnv(
        env.OMNIWA_WORKER_APPLICATION_RETRY_DELAY_MS,
        5_000,
        "OMNIWA_WORKER_APPLICATION_RETRY_DELAY_MS",
      ),
    }),
    unexpectedFailureRetryDelayMilliseconds: readPositiveIntegerEnv(
      env.OMNIWA_WORKER_UNEXPECTED_FAILURE_RETRY_DELAY_MS,
      5_000,
      "OMNIWA_WORKER_UNEXPECTED_FAILURE_RETRY_DELAY_MS",
    ),
  });

  return Object.freeze({
    profile,
    repositoryProfile,
    dispatcher,
    queueProvider,
    app: new WorkerRuntimeApp({
      runtime,
      queueProvider,
    }),
  });
}

export function readWorkerRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRuntimeProfile {
  const value = env.OMNIWA_WORKER_RUNTIME_PROFILE?.trim() ?? env.NODE_ENV?.trim();

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
      throw new Error(`Unsupported OmniWA Worker runtime profile: ${value}`);
  }
}

export function readWorkerRepositoryProfile(
  env: NodeJS.ProcessEnv = process.env,
): WorkerRepositoryProfile {
  const value =
    env.OMNIWA_WORKER_REPOSITORY_PROFILE?.trim() ?? env.OMNIWA_API_REPOSITORY_PROFILE?.trim();

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
      throw new Error(`Unsupported OmniWA Worker repository profile: ${value}`);
  }
}

function createWorkerRuntimeRepositories(
  env: NodeJS.ProcessEnv,
  repositoryProfile: WorkerRepositoryProfile,
): WorkerRuntimeRepositories {
  if (repositoryProfile === "in-memory") {
    return createInMemoryRepositorySet();
  }

  if (repositoryProfile === "postgresql") {
    const databaseUrl = env.OMNIWA_POSTGRES_DATABASE_URL?.trim();

    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error(
        "OMNIWA_POSTGRES_DATABASE_URL is required when OMNIWA_WORKER_REPOSITORY_PROFILE=postgresql.",
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
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      healthStatusRepository: localProjectionRepositories.healthStatusRepository,
    });
  }

  const stateDirectory =
    env.OMNIWA_WORKER_REPOSITORY_STATE_DIR?.trim() ?? env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_WORKER_REPOSITORY_STATE_DIR is required when OMNIWA_WORKER_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return createDurableJsonRepositorySet(stateDirectory);
}

function assertWorkerRuntimeProfileIsComposable(profile: WorkerRuntimeProfile): void {
  if (profile === "production") {
    throw new Error(
      "OmniWA Worker production profile requires distributed queue, provider, secret, and observability adapters before runtime composition is allowed.",
    );
  }
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
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

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
