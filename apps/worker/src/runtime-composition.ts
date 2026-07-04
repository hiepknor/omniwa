import { join } from "node:path";

import {
  createApplicationDispatcher,
  createApplicationPortFailure,
  createDomainEventPublisher,
  type ApplicationDispatcher,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type MessagingProviderPort,
  type ProviderCapabilitySummary,
  type ProviderConnectionRequest,
  type ProviderConnectionResult,
  type ProviderOutboundMessageRequest,
  type ProviderOutboundMessageResult,
  type ProviderQrPairingChallenge,
  type ProviderQrPairingRequest,
} from "@omniwa/application";
import type {
  HealthStatusRepositoryPort,
  GuardrailDecisionRepositoryPort,
  InstanceRepositoryPort,
  MessageRepositoryPort,
  ProviderId,
  SessionRepositoryPort,
  WorkerJobRepositoryPort,
} from "@omniwa/domain";
import {
  DurableJsonOutboundMessageIntentStore,
  InMemoryOutboundMessageIntentStore,
  createDurableJsonEventLogStore,
  createDurableJsonRepositorySet,
  createInMemoryEventLogStore,
  createInMemoryRepositorySet,
  createPostgresqlConnectionPool,
  createPostgresqlRepositorySet,
} from "@omniwa/infrastructure-persistence";
import {
  BaileysMessagingProviderAdapter,
  BaileysSocketGateway,
  FakeBaileysSocketProvider,
  OutboundMessageIntentBaileysResolver,
  type BaileysOutboundMessageResolver,
  type BaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import { DurableWorkerJobQueueProvider, InMemoryQueueProvider } from "@omniwa/infrastructure-queue";
import { err, ok } from "@omniwa/shared";

import { WorkerRuntimeApp } from "./worker-app.js";
import { createApplicationWorkerHandlers } from "./worker-application-handlers.js";
import { WorkerRuntime } from "./worker-runtime.js";

export const workerRuntimeProfiles = ["local", "test", "production"] as const;

export type WorkerRuntimeProfile = (typeof workerRuntimeProfiles)[number];

export const workerRepositoryProfiles = ["in-memory", "durable-json", "postgresql"] as const;

export type WorkerRepositoryProfile = (typeof workerRepositoryProfiles)[number];

export const workerProviderModes = [
  "same-process-local-demo",
  "multi-process-unsupported",
] as const;

export type WorkerProviderMode = (typeof workerProviderModes)[number];

export const workerQueueProfiles = ["in-memory", "durable-worker-job"] as const;

export type WorkerQueueProfile = (typeof workerQueueProfiles)[number];

export type WorkerRuntimeComposition = Readonly<{
  profile: WorkerRuntimeProfile;
  repositoryProfile: WorkerRepositoryProfile;
  providerMode: WorkerProviderMode;
  queueProfile: WorkerQueueProfile;
  repositories: WorkerRuntimeRepositories;
  outboundMessageIntentStore:
    InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore;
  messagingProvider: MessagingProviderPort;
  dispatcher: ApplicationDispatcher;
  queueProvider: InMemoryQueueProvider | DurableWorkerJobQueueProvider;
  app: WorkerRuntimeApp;
  socketProvider?: BaileysSocketProvider;
  outboundMessageResolver?: BaileysOutboundMessageResolver;
}>;

export type WorkerRuntimeCompositionOverrides = Readonly<{
  socketProvider?: BaileysSocketProvider;
  outboundMessageResolver?: BaileysOutboundMessageResolver;
}>;

type WorkerRuntimeRepositories = Readonly<{
  instanceRepository: InstanceRepositoryPort;
  sessionRepository?: SessionRepositoryPort;
  messageRepository?: MessageRepositoryPort;
  workerJobRepository: WorkerJobRepositoryPort;
  guardrailDecisionRepository?: GuardrailDecisionRepositoryPort;
  healthStatusRepository?: HealthStatusRepositoryPort;
}>;

export function createWorkerRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  overrides: WorkerRuntimeCompositionOverrides = {},
): WorkerRuntimeComposition {
  const profile = readWorkerRuntimeProfile(env);
  const repositoryProfile = readWorkerRepositoryProfile(env);
  const providerMode = readWorkerProviderMode(env);
  const queueProfile = readWorkerQueueProfile(env);

  assertWorkerRuntimeProfileIsComposable(profile);

  const repositories = createWorkerRuntimeRepositories(env, repositoryProfile);
  const eventLogPath = env.OMNIWA_EVENT_LOG_PATH?.trim();
  const eventLog =
    eventLogPath === undefined || eventLogPath.length === 0
      ? createInMemoryEventLogStore()
      : createDurableJsonEventLogStore(eventLogPath);
  const outboundMessageIntentStore = createRuntimeOutboundMessageIntentStore(
    env,
    repositoryProfile,
  );
  const domainEventPublisher = createDomainEventPublisher({
    eventLog,
    nowIso: () => new Date().toISOString(),
  });
  const providerComposition = createWorkerMessagingProvider({
    providerMode,
    outboundMessageIntentStore,
    ...optional("socketProvider", overrides.socketProvider),
    ...optional("outboundMessageResolver", overrides.outboundMessageResolver),
  });
  const queueProvider = createWorkerQueueProvider({
    queueProfile,
    workerJobRepository: repositories.workerJobRepository,
  });
  const dispatcher = createApplicationDispatcher({
    repositories: {
      instanceRepository: repositories.instanceRepository,
      ...optional("sessionRepository", repositories.sessionRepository),
      ...optional("messageRepository", repositories.messageRepository),
      ...optional("guardrailDecisionRepository", repositories.guardrailDecisionRepository),
      ...optional("healthStatusRepository", repositories.healthStatusRepository),
    },
    outboundMessageIntentStore,
    queueProvider,
    messagingProvider: providerComposition.messagingProvider,
    domainEventPublisher,
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
    providerMode,
    queueProfile,
    repositories,
    outboundMessageIntentStore,
    messagingProvider: providerComposition.messagingProvider,
    dispatcher,
    queueProvider,
    app: new WorkerRuntimeApp({
      runtime,
      queueProvider,
    }),
    ...optional("socketProvider", providerComposition.socketProvider),
    ...optional("outboundMessageResolver", providerComposition.outboundMessageResolver),
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

export function readWorkerProviderMode(env: NodeJS.ProcessEnv = process.env): WorkerProviderMode {
  const value = env.OMNIWA_WORKER_PROVIDER_MODE?.trim();

  switch (value) {
    case "multi-process-unsupported":
      return "multi-process-unsupported";
    case "same-process-local-demo":
    case "local-demo":
    case undefined:
    case "":
      return "same-process-local-demo";
    default:
      throw new Error("Unsupported OmniWA Worker provider mode.");
  }
}

export function readWorkerQueueProfile(env: NodeJS.ProcessEnv = process.env): WorkerQueueProfile {
  const value = env.OMNIWA_WORKER_QUEUE_PROFILE?.trim();

  switch (value) {
    case "durable-worker-job":
    case "durable":
      return "durable-worker-job";
    case "in-memory":
    case undefined:
    case "":
      return "in-memory";
    default:
      throw new Error("Unsupported OmniWA Worker queue profile.");
  }
}

function createWorkerQueueProvider(
  input: Readonly<{
    queueProfile: WorkerQueueProfile;
    workerJobRepository: WorkerJobRepositoryPort;
  }>,
): InMemoryQueueProvider | DurableWorkerJobQueueProvider {
  if (input.queueProfile === "durable-worker-job") {
    return new DurableWorkerJobQueueProvider({
      workerJobRepository: input.workerJobRepository,
    });
  }

  return new InMemoryQueueProvider({
    workerJobRepository: input.workerJobRepository,
  });
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

    const postgresqlRepositories = createPostgresqlRepositorySet(
      createPostgresqlConnectionPool(databaseUrl),
      {
        autoMigrate: readBooleanEnv(env.OMNIWA_POSTGRES_AUTO_MIGRATE),
      },
    );

    return Object.freeze({
      instanceRepository: postgresqlRepositories.instanceRepository,
      workerJobRepository: postgresqlRepositories.workerJobRepository,
      sessionRepository: postgresqlRepositories.sessionRepository,
      messageRepository: postgresqlRepositories.messageRepository,
      guardrailDecisionRepository: postgresqlRepositories.guardrailDecisionRepository,
      healthStatusRepository: postgresqlRepositories.healthStatusRepository,
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

function createRuntimeOutboundMessageIntentStore(
  env: NodeJS.ProcessEnv,
  repositoryProfile: WorkerRepositoryProfile,
): InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore {
  if (repositoryProfile !== "durable-json") {
    return new InMemoryOutboundMessageIntentStore();
  }

  const stateDirectory =
    env.OMNIWA_WORKER_REPOSITORY_STATE_DIR?.trim() ?? env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  if (stateDirectory === undefined || stateDirectory.length === 0) {
    throw new Error(
      "OMNIWA_WORKER_REPOSITORY_STATE_DIR is required when OMNIWA_WORKER_REPOSITORY_PROFILE=durable-json.",
    );
  }

  return new DurableJsonOutboundMessageIntentStore(
    join(stateDirectory, "outbound-message-intents.json"),
  );
}

type WorkerMessagingProviderComposition = Readonly<{
  messagingProvider: MessagingProviderPort;
  socketProvider?: BaileysSocketProvider;
  outboundMessageResolver?: BaileysOutboundMessageResolver;
}>;

function createWorkerMessagingProvider(
  input: Readonly<{
    providerMode: WorkerProviderMode;
    outboundMessageIntentStore:
      InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore;
    socketProvider?: BaileysSocketProvider;
    outboundMessageResolver?: BaileysOutboundMessageResolver;
  }>,
): WorkerMessagingProviderComposition {
  if (input.providerMode === "multi-process-unsupported") {
    return Object.freeze({
      messagingProvider: createUnavailableMessagingProvider({
        code: "worker_messaging_provider_ipc_required",
        message:
          "Worker MessagingProvider cannot access provider-runtime sockets before IPC or shared socket ownership is implemented.",
      }),
    });
  }

  const socketProvider = input.socketProvider ?? new FakeBaileysSocketProvider();
  const outboundMessageResolver =
    input.outboundMessageResolver ??
    new OutboundMessageIntentBaileysResolver({
      intentStore: input.outboundMessageIntentStore,
    });
  const messagingProvider = new BaileysMessagingProviderAdapter({
    gateway: new BaileysSocketGateway({
      socketProvider,
      outboundMessageResolver,
    }),
  });

  return Object.freeze({
    messagingProvider,
    socketProvider,
    outboundMessageResolver,
  });
}

function createUnavailableMessagingProvider(
  input: Readonly<{
    code: string;
    message: string;
  }> = {
    code: "worker_messaging_provider_not_configured",
    message: "Worker MessagingProvider is not configured.",
  },
): MessagingProviderPort {
  return Object.freeze({
    requestConnection: (
      request: ProviderConnectionRequest,
    ): Promise<ApplicationPortResult<ProviderConnectionResult>> =>
      Promise.resolve(
        ok({
          instanceId: request.instanceId,
          providerId: request.providerId,
          state: "action_required",
          failureCategory: "provider",
        }),
      ),
    requestQrPairing: (
      request: ProviderQrPairingRequest,
      context: ApplicationPortContext,
    ): Promise<ApplicationPortResult<ProviderQrPairingChallenge>> => {
      void request;
      return Promise.resolve(err(unavailableProviderFailure(context, input)));
    },
    disconnect: (
      request: ProviderConnectionRequest,
    ): Promise<ApplicationPortResult<ProviderConnectionResult>> =>
      Promise.resolve(
        ok({
          instanceId: request.instanceId,
          providerId: request.providerId,
          state: "disconnected",
          failureCategory: "provider",
        }),
      ),
    sendOutboundMessage: (
      request: ProviderOutboundMessageRequest,
      context: ApplicationPortContext,
    ): Promise<ApplicationPortResult<ProviderOutboundMessageResult>> => {
      void request;
      return Promise.resolve(err(unavailableProviderFailure(context, input)));
    },
    getCapabilitySummary: (
      providerId: ProviderId,
      context: ApplicationPortContext,
    ): Promise<ApplicationPortResult<ProviderCapabilitySummary>> => {
      void context;
      return Promise.resolve(
        ok({
          providerId,
          supportedMessageTypes: Object.freeze([]),
          degraded: true,
          failureCategory: "provider",
        }),
      );
    },
  });
}

function unavailableProviderFailure(
  context: ApplicationPortContext,
  input: Readonly<{
    code: string;
    message: string;
  }>,
) {
  return createApplicationPortFailure({
    category: "unavailable",
    code: input.code,
    message: input.message,
    retryable: true,
    ownerContext: "provider_integration",
    failureCategory: "provider",
    safeMetadata: {
      correlationId: String(context.requestContext.correlationId),
    },
  });
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
