import { join, resolve } from "node:path";

import {
  createProviderSignalIngress,
  type ApplicationPortContext,
  type EventLogPort,
  type ProviderSignalIngress,
} from "@omniwa/application";
import {
  type BaileysAuthStateStore,
  type BaileysSocketProvider,
  DurableJsonBaileysAuthStateStore,
  RealBaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import { createDurableJsonEventLogStore } from "@omniwa/infrastructure-persistence";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { randomUUID } from "node:crypto";

import {
  InMemoryProviderRuntimeSupervisorOwnershipGuard,
  ProviderRuntimeSupervisor,
  type ProviderRuntimeSupervisorOwnershipGuard,
} from "./provider-runtime-supervisor.js";

export const providerRuntimeCompositionProfiles = ["local", "test", "production"] as const;

export type ProviderRuntimeCompositionProfile = (typeof providerRuntimeCompositionProfiles)[number];

export type ProviderRuntimeCompositionPaths = Readonly<{
  stateDirectory: string;
  eventLogPath: string;
  authStatePath: string;
}>;

export type ProviderRuntimeCompositionDrainLoop = Readonly<{
  intervalMilliseconds: number;
  stop(): void;
  shutdown(): void;
}>;

export type ProviderRuntimeComposition = Readonly<{
  profile: ProviderRuntimeCompositionProfile;
  paths: ProviderRuntimeCompositionPaths;
  eventLog: EventLogPort;
  authStateStore: BaileysAuthStateStore;
  socketProvider: BaileysSocketProvider;
  signalIngress: ProviderSignalIngress;
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

  assertProviderRuntimeProfileIsComposable(profile);

  const paths = readProviderRuntimeCompositionPaths(env);
  const eventLog = overrides.eventLog ?? createDurableJsonEventLogStore(paths.eventLogPath);
  const authStateStore =
    overrides.authStateStore ?? new DurableJsonBaileysAuthStateStore(paths.authStatePath);
  const socketProvider =
    overrides.socketProvider ??
    new RealBaileysSocketProvider({
      authStateStore,
    });
  const signalIngress =
    overrides.signalIngress ??
    createProviderSignalIngress({
      eventLog,
      nowIso: overrides.nowIso ?? (() => new Date().toISOString()),
    });
  const ownerRef = overrides.ownerRef ?? readProviderRuntimeOwnerRef(env);
  const supervisor = new ProviderRuntimeSupervisor({
    socketProvider,
    signalIngress,
    ownershipGuard:
      overrides.ownershipGuard ?? new InMemoryProviderRuntimeSupervisorOwnershipGuard(),
    ...optional("ownerRef", ownerRef),
  });

  return Object.freeze({
    profile,
    paths,
    eventLog,
    authStateStore,
    socketProvider,
    signalIngress,
    supervisor,
    startDrainLoop(
      context: ApplicationPortContext = createProviderRuntimeCompositionContext(),
      intervalMilliseconds: number = readProviderRuntimeDrainIntervalMilliseconds(env),
    ): ProviderRuntimeCompositionDrainLoop {
      const loop = supervisor.startDrainLoop(context, intervalMilliseconds);

      return Object.freeze({
        intervalMilliseconds,
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

function assertProviderRuntimeProfileIsComposable(
  profile: ProviderRuntimeCompositionProfile,
): void {
  if (profile === "production") {
    throw new Error(
      "OmniWA provider runtime production profile requires encrypted auth state and distributed ownership before composition is allowed.",
    );
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
