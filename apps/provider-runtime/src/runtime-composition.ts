import { join, resolve } from "node:path";

import {
  createProviderSignalIngress,
  type ApplicationPortContext,
  type EventLogPort,
  type MessagingProviderPort,
  type ProviderSignalIngress,
} from "@omniwa/application";
import type { SecretProvider } from "@omniwa/config";
import {
  BaileysMessagingProviderAdapter,
  type BaileysAuthStateStore,
  type BaileysOutboundMessageResolver,
  BaileysSocketGateway,
  type BaileysSocketProvider,
  DurableJsonBaileysAuthStateStore,
  OutboundMessageIntentBaileysResolver,
  RealBaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import {
  createDurableJsonEventLogStore,
  createPostgresqlConnectionPool,
  DurableJsonOutboundMessageIntentStore,
  InMemoryOutboundMessageIntentStore,
} from "@omniwa/infrastructure-persistence";
import { EnvSecretProvider } from "@omniwa/infrastructure-secrets";
import type { ProviderCommandTransport } from "@omniwa/infrastructure-provider-bridge";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

import { ProviderRuntimeCommandReceiver } from "./provider-command-receiver.js";
import { createProviderRuntimeApp, type ProviderRuntimeApp } from "./provider-runtime-app.js";
import {
  InMemoryProviderRuntimeSupervisorOwnershipGuard,
  ProviderRuntimeSupervisor,
  type ProviderRuntimeSupervisorOwnershipGuard,
} from "./provider-runtime-supervisor.js";
import {
  DurableJsonProviderRuntimeSupervisorOwnershipGuard,
  PostgresqlProviderRuntimeSupervisorOwnershipGuard,
} from "./provider-runtime-ownership-guard.js";
import {
  createLocalQrOperatorSink,
  readLocalQrOperatorOutputConfig,
  type LocalQrOperatorOutputConfig,
} from "./local-qr-operator-output.js";
import {
  createLocalInboundRecipientOperatorSink,
  readLocalInboundRecipientOperatorOutputConfig,
  type LocalInboundRecipientOperatorOutputConfig,
} from "./local-inbound-recipient-operator-output.js";

export const providerRuntimeCompositionProfiles = ["local", "test", "production"] as const;

export type ProviderRuntimeCompositionProfile = (typeof providerRuntimeCompositionProfiles)[number];

export const providerRuntimeLiveModes = ["disabled", "local_live"] as const;

export type ProviderRuntimeLiveMode = (typeof providerRuntimeLiveModes)[number];

export type ProviderRuntimeReadiness = Readonly<{
  liveMode: ProviderRuntimeLiveMode;
  localOnly: boolean;
  productionReady: false;
  authStateEncryption: ProviderRuntimeAuthStateEncryptionStatus;
  ownershipMode: ProviderRuntimeOwnershipMode;
}>;

export type ProviderRuntimeAuthStateEncryptionStatus = "not_configured" | "configured";

export type ProviderRuntimeCompositionPaths = Readonly<{
  stateDirectory: string;
  eventLogPath: string;
  authStatePath: string;
  ownershipLeasePath: string;
}>;

export const providerRuntimeOwnershipModes = [
  "single_instance_in_memory",
  "durable_json_local_lease",
  "postgresql_lease",
] as const;

export type ProviderRuntimeOwnershipMode = (typeof providerRuntimeOwnershipModes)[number];

export type ProviderRuntimeCompositionDrainLoop = Readonly<{
  intervalMilliseconds: number;
  keepsProcessAlive: boolean;
  stop(): void;
  shutdown(): void;
}>;

export type ProviderRuntimeComposition = Readonly<{
  profile: ProviderRuntimeCompositionProfile;
  liveMode: ProviderRuntimeLiveMode;
  readiness: ProviderRuntimeReadiness;
  localQrOutput: LocalQrOperatorOutputConfig;
  localInboundRecipientOutput: LocalInboundRecipientOperatorOutputConfig;
  paths: ProviderRuntimeCompositionPaths;
  eventLog: EventLogPort;
  authStateStore: BaileysAuthStateStore;
  socketProvider: BaileysSocketProvider;
  signalIngress: ProviderSignalIngress;
  outboundMessageIntentStore:
    InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore;
  outboundMessageResolver: BaileysOutboundMessageResolver;
  messagingProvider: MessagingProviderPort;
  providerRuntimeApp: ProviderRuntimeApp;
  providerCommandTransport?: ProviderCommandTransport;
  supervisor: ProviderRuntimeSupervisor;
  startDrainLoop(
    context?: ApplicationPortContext,
    intervalMilliseconds?: number,
  ): ProviderRuntimeCompositionDrainLoop;
  shutdown(): void;
}>;

export type ProviderRuntimeCompositionOverrides = Readonly<{
  eventLog?: EventLogPort;
  authStateStore?: BaileysAuthStateStore;
  socketProvider?: BaileysSocketProvider;
  signalIngress?: ProviderSignalIngress;
  outboundMessageIntentStore?:
    InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore;
  outboundMessageResolver?: BaileysOutboundMessageResolver;
  messagingProvider?: MessagingProviderPort;
  secretProvider?: SecretProvider;
  providerRuntimeApp?: ProviderRuntimeApp;
  providerCommandTransport?: ProviderCommandTransport;
  ownershipGuard?: ProviderRuntimeSupervisorOwnershipGuard;
  ownerRef?: string;
  nowIso?: () => string;
}>;

export const providerRuntimeActorRef = "provider-runtime";

export function createProviderRuntimeComposition(
  env: NodeJS.ProcessEnv = process.env,
  overrides: ProviderRuntimeCompositionOverrides = {},
): ProviderRuntimeComposition {
  const profile = readProviderRuntimeCompositionProfile(env);
  const liveMode = readProviderRuntimeLiveMode(env);
  const paths = readProviderRuntimeCompositionPaths(env);
  const ownershipMode = readProviderRuntimeOwnershipMode(env);
  const authStateEncryptionKey = readProviderRuntimeAuthStateEncryptionKey(env);
  const authStateEncryption = providerRuntimeAuthStateEncryptionStatus(authStateEncryptionKey);
  const ownerRef = overrides.ownerRef ?? readProviderRuntimeOwnerRef(env);
  const outboundMessageIntentStorePath = readProviderRuntimeOutboundMessageIntentStorePath(env);

  assertProviderRuntimeProfileIsComposable({
    profile,
    liveMode,
    ownershipMode,
    authStateEncryption,
    ownerRef,
    outboundMessageIntentStorePath,
    hasOwnershipDatabaseUrl: hasProviderRuntimeOwnershipDatabaseUrl(env),
    commandBridgeHttpEnabled: readBooleanEnv(env.OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP),
    commandBridgeTokenConfigured:
      readOptionalEnvValue(env.OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN) !== undefined,
    hasExplicitStateDirectory: hasProviderRuntimeStateDirectory(env),
  });

  const localQrOutput = readLocalQrOperatorOutputConfig(env, paths.stateDirectory);
  const localInboundRecipientOutput = readLocalInboundRecipientOperatorOutputConfig(
    env,
    paths.stateDirectory,
  );
  const qrCodeOperatorSink = createLocalQrOperatorSink(localQrOutput);
  const inboundRecipientOperatorSink = createLocalInboundRecipientOperatorSink(
    localInboundRecipientOutput,
  );
  const eventLog = overrides.eventLog ?? createDurableJsonEventLogStore(paths.eventLogPath);
  const authStateStore =
    overrides.authStateStore ??
    new DurableJsonBaileysAuthStateStore(
      paths.authStatePath,
      authStateEncryptionKey === undefined ? {} : { encryptionKey: authStateEncryptionKey },
    );
  const socketProvider =
    overrides.socketProvider ??
    new RealBaileysSocketProvider({
      authStateStore,
      ...optional("qrCodeOperatorSink", qrCodeOperatorSink),
      ...optional("inboundRecipientOperatorSink", inboundRecipientOperatorSink),
    });
  const outboundMessageIntentStore =
    overrides.outboundMessageIntentStore ??
    createProviderRuntimeOutboundMessageIntentStore(outboundMessageIntentStorePath);
  const outboundMessageResolver =
    overrides.outboundMessageResolver ??
    new OutboundMessageIntentBaileysResolver({
      intentStore: outboundMessageIntentStore,
    });
  const messagingProvider =
    overrides.messagingProvider ??
    new BaileysMessagingProviderAdapter({
      gateway: new BaileysSocketGateway({
        socketProvider,
        outboundMessageResolver,
      }),
    });
  const providerRuntimeApp =
    overrides.providerRuntimeApp ??
    createProviderRuntimeApp({
      provider: messagingProvider,
      secretProvider: overrides.secretProvider ?? new EnvSecretProvider({ env }),
      ...optional("ownerRef", ownerRef),
    });
  const providerCommandTransport =
    overrides.providerCommandTransport ??
    new ProviderRuntimeCommandReceiver({
      app: providerRuntimeApp,
      provider: messagingProvider,
    });
  const signalIngress =
    overrides.signalIngress ??
    createProviderSignalIngress({
      eventLog,
      nowIso: overrides.nowIso ?? (() => new Date().toISOString()),
    });
  const supervisor = new ProviderRuntimeSupervisor({
    socketProvider,
    signalIngress,
    ownershipGuard:
      overrides.ownershipGuard ??
      createProviderRuntimeOwnershipGuard(ownershipMode, paths.ownershipLeasePath, env),
    ...optional("ownerRef", ownerRef),
  });

  return Object.freeze({
    profile,
    liveMode,
    readiness: providerRuntimeReadiness(liveMode, ownershipMode, authStateEncryption),
    localQrOutput,
    localInboundRecipientOutput,
    paths,
    eventLog,
    authStateStore,
    socketProvider,
    signalIngress,
    outboundMessageIntentStore,
    outboundMessageResolver,
    messagingProvider,
    providerRuntimeApp,
    providerCommandTransport,
    supervisor,
    startDrainLoop(
      context: ApplicationPortContext = createProviderRuntimeCompositionContext(),
      intervalMilliseconds: number = readProviderRuntimeDrainIntervalMilliseconds(env),
    ): ProviderRuntimeCompositionDrainLoop {
      const loop = supervisor.startDrainLoop(context, intervalMilliseconds);

      return Object.freeze({
        intervalMilliseconds,
        keepsProcessAlive: loop.keepsProcessAlive,
        stop: loop.stop,
        shutdown(): void {
          loop.stop();
          supervisor.shutdown();
        },
      });
    },
    shutdown(): void {
      supervisor.shutdown();
    },
  });
}

export function createProviderRuntimeCompositionContext(): ApplicationPortContext {
  const id = randomUUID();

  return Object.freeze({
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`provider-runtime:${id}`),
      requestId: createRequestId(`provider-runtime:${id}`),
    }),
    actorRef: providerRuntimeActorRef,
    idempotencyKey: `provider-runtime:${id}`,
    dataClassification: "internal",
  });
}

export function readProviderRuntimeLiveMode(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeLiveMode {
  const value = env.OMNIWA_LIVE_DEMO_MODE?.trim().toLowerCase();

  switch (value) {
    case "1":
    case "true":
    case "local":
    case "local_live":
      return "local_live";
    case "0":
    case "false":
    case "disabled":
    case undefined:
    case "":
      return "disabled";
    default:
      throw new Error("Unsupported OmniWA provider runtime live demo mode.");
  }
}

export function readProviderRuntimeCompositionProfile(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeCompositionProfile {
  const value = env.OMNIWA_PROVIDER_RUNTIME_PROFILE?.trim() ?? env.NODE_ENV?.trim();

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
      throw new Error("Unsupported OmniWA provider runtime profile.");
  }
}

export function readProviderRuntimeCompositionPaths(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeCompositionPaths {
  const stateDirectory = readProviderRuntimeStateDirectory(env);

  return Object.freeze({
    stateDirectory,
    eventLogPath: readProviderRuntimeEventLogPath(env, stateDirectory),
    authStatePath: readProviderRuntimeAuthStatePath(env, stateDirectory),
    ownershipLeasePath: readProviderRuntimeOwnershipLeasePath(env, stateDirectory),
  });
}

export function readProviderRuntimeStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const explicitProviderStateDirectory = env.OMNIWA_PROVIDER_RUNTIME_STATE_DIR?.trim();
  const sharedStateDirectory = env.OMNIWA_RUNTIME_STATE_DIR?.trim();

  return resolve(
    explicitProviderStateDirectory !== undefined && explicitProviderStateDirectory.length > 0
      ? explicitProviderStateDirectory
      : sharedStateDirectory !== undefined && sharedStateDirectory.length > 0
        ? sharedStateDirectory
        : ".omniwa-local/state",
  );
}

export function readProviderRuntimeEventLogPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = readProviderRuntimeStateDirectory(env),
): string {
  const value = env.OMNIWA_EVENT_LOG_PATH?.trim();

  return resolve(
    value === undefined || value.length === 0 ? join(stateDirectory, "event-log.json") : value,
  );
}

export function readProviderRuntimeAuthStatePath(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = readProviderRuntimeStateDirectory(env),
): string {
  const value = env.OMNIWA_BAILEYS_AUTH_STATE_PATH?.trim();

  return resolve(
    value === undefined || value.length === 0
      ? join(stateDirectory, "provider-runtime", "baileys-auth-state.json")
      : value,
  );
}

export function readProviderRuntimeOwnershipLeasePath(
  env: NodeJS.ProcessEnv = process.env,
  stateDirectory = readProviderRuntimeStateDirectory(env),
): string {
  const value = env.OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_LEASE_PATH?.trim();

  return resolve(
    value === undefined || value.length === 0
      ? join(stateDirectory, "provider-runtime", "ownership-leases.json")
      : value,
  );
}

export function readProviderRuntimeDrainIntervalMilliseconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.OMNIWA_PROVIDER_RUNTIME_DRAIN_INTERVAL_MS?.trim();

  if (value === undefined || value.length === 0) {
    return 1_000;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("OMNIWA_PROVIDER_RUNTIME_DRAIN_INTERVAL_MS must be a positive integer.");
  }

  return parsed;
}

function readProviderRuntimeOwnerRef(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.OMNIWA_PROVIDER_RUNTIME_OWNER_REF?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function hasProviderRuntimeStateDirectory(env: NodeJS.ProcessEnv): boolean {
  return (
    readOptionalEnvValue(env.OMNIWA_PROVIDER_RUNTIME_STATE_DIR) !== undefined ||
    readOptionalEnvValue(env.OMNIWA_RUNTIME_STATE_DIR) !== undefined
  );
}

export function readProviderRuntimeOwnershipMode(
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeOwnershipMode {
  const value = env.OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE?.trim();

  switch (value) {
    case "in-memory":
    case "single_instance_in_memory":
      return "single_instance_in_memory";
    case "durable":
    case "durable-json":
    case "durable_json_local_lease":
      return "durable_json_local_lease";
    case "postgres":
    case "postgresql":
    case "postgresql_lease":
      return "postgresql_lease";
    case undefined:
    case "":
      return "durable_json_local_lease";
    default:
      throw new Error("Unsupported OmniWA provider runtime ownership mode.");
  }
}

export function readProviderRuntimeAuthStateEncryptionKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env.OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}

function readProviderRuntimeOutboundMessageIntentStorePath(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return readOptionalEnvValue(env.OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH);
}

function createProviderRuntimeOutboundMessageIntentStore(
  path: string | undefined,
): InMemoryOutboundMessageIntentStore | DurableJsonOutboundMessageIntentStore {
  return path === undefined
    ? new InMemoryOutboundMessageIntentStore()
    : new DurableJsonOutboundMessageIntentStore(path);
}

function createProviderRuntimeOwnershipGuard(
  ownershipMode: ProviderRuntimeOwnershipMode,
  ownershipLeasePath: string,
  env: NodeJS.ProcessEnv,
): ProviderRuntimeSupervisorOwnershipGuard {
  if (ownershipMode === "single_instance_in_memory") {
    return new InMemoryProviderRuntimeSupervisorOwnershipGuard();
  }

  if (ownershipMode === "postgresql_lease") {
    return new PostgresqlProviderRuntimeSupervisorOwnershipGuard({
      connection: createPostgresqlConnectionPool(readProviderRuntimeOwnershipDatabaseUrl(env)),
    });
  }

  return new DurableJsonProviderRuntimeSupervisorOwnershipGuard({
    filePath: ownershipLeasePath,
  });
}

function readProviderRuntimeOwnershipDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value =
    env.OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL?.trim() ??
    env.OMNIWA_POSTGRES_DATABASE_URL?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(
      "OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL or OMNIWA_POSTGRES_DATABASE_URL is required when OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE=postgresql.",
    );
  }

  return value;
}

function hasProviderRuntimeOwnershipDatabaseUrl(env: NodeJS.ProcessEnv): boolean {
  return (
    readOptionalEnvValue(env.OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL) !== undefined ||
    readOptionalEnvValue(env.OMNIWA_POSTGRES_DATABASE_URL) !== undefined
  );
}

type ProviderRuntimeProfileValidationInput = Readonly<{
  profile: ProviderRuntimeCompositionProfile;
  liveMode: ProviderRuntimeLiveMode;
  ownershipMode: ProviderRuntimeOwnershipMode;
  authStateEncryption: ProviderRuntimeAuthStateEncryptionStatus;
  ownerRef: string | undefined;
  outboundMessageIntentStorePath: string | undefined;
  hasOwnershipDatabaseUrl: boolean;
  commandBridgeHttpEnabled: boolean;
  commandBridgeTokenConfigured: boolean;
  hasExplicitStateDirectory: boolean;
}>;

function assertProviderRuntimeProfileIsComposable(
  input: ProviderRuntimeProfileValidationInput,
): void {
  if (input.profile !== "production") {
    return;
  }

  const missingRequirements: string[] = [];

  if (input.liveMode !== "disabled") {
    missingRequirements.push("OMNIWA_LIVE_DEMO_MODE=disabled");
  }

  if (!input.hasExplicitStateDirectory) {
    missingRequirements.push("OMNIWA_RUNTIME_STATE_DIR or OMNIWA_PROVIDER_RUNTIME_STATE_DIR");
  }

  if (input.authStateEncryption !== "configured") {
    missingRequirements.push("OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY");
  }

  if (input.ownershipMode !== "postgresql_lease") {
    missingRequirements.push("OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE=postgresql");
  }

  if (!input.hasOwnershipDatabaseUrl) {
    missingRequirements.push(
      "OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL or OMNIWA_POSTGRES_DATABASE_URL",
    );
  }

  if (input.ownerRef === undefined) {
    missingRequirements.push("OMNIWA_PROVIDER_RUNTIME_OWNER_REF");
  }

  if (input.outboundMessageIntentStorePath === undefined) {
    missingRequirements.push("OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH");
  }

  if (!input.commandBridgeHttpEnabled) {
    missingRequirements.push("OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP=true");
  }

  if (!input.commandBridgeTokenConfigured) {
    missingRequirements.push("OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN");
  }

  if (missingRequirements.length > 0) {
    throw new Error(
      `OmniWA provider runtime production profile is not composable. Missing: ${missingRequirements.join(", ")}.`,
    );
  }
}

function providerRuntimeReadiness(
  liveMode: ProviderRuntimeLiveMode,
  ownershipMode: ProviderRuntimeOwnershipMode,
  authStateEncryption: ProviderRuntimeAuthStateEncryptionStatus,
): ProviderRuntimeReadiness {
  return Object.freeze({
    liveMode,
    localOnly: liveMode === "local_live",
    productionReady: false,
    authStateEncryption,
    ownershipMode,
  });
}

function providerRuntimeAuthStateEncryptionStatus(
  encryptionKey: string | undefined,
): ProviderRuntimeAuthStateEncryptionStatus {
  return encryptionKey === undefined ? "not_configured" : "configured";
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readOptionalEnvValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
