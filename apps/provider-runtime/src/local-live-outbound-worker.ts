import { join, resolve } from "node:path";

import type { ApplicationPortContext } from "@omniwa/application";
import {
  WorkerRuntimeLoop,
  createWorkerRuntimeComposition,
  readWorkerLoopIntervalMilliseconds,
  type WorkerRuntimeComposition,
} from "@omniwa/app-worker";
import {
  activateSession,
  createInstance,
  createInstanceId,
  createSession,
  createSessionId,
  markInstanceConnected,
  markInstanceConnecting,
  startSessionPairing,
  type InstanceId,
  type SessionId,
} from "@omniwa/domain";

import type { ProviderRuntimeComposition, ProviderRuntimeLiveMode } from "./runtime-composition.js";

export type ProviderRuntimeLocalLiveOutboundWorkerConfig =
  | Readonly<{
      enabled: false;
      reasonCode:
        | "local_live_mode_disabled"
        | "local_live_outbound_worker_disabled"
        | "local_live_outbound_worker_env_missing";
      missing: readonly string[];
    }>
  | Readonly<{
      enabled: true;
      instanceId: InstanceId;
      sessionId: SessionId;
      repositoryStateDirectory: string;
      intervalMilliseconds: number;
      reasonCode: "local_live_outbound_worker_enabled";
    }>;

export type ProviderRuntimeLocalLiveOutboundWorkerStatus = Readonly<{
  attempted: boolean;
  started: boolean;
  reasonCode: string;
  missing?: readonly string[];
  instanceId?: string;
  sessionId?: string;
  repositoryStateDirectory?: string;
  intervalMilliseconds?: number;
  errorCode?: string;
}>;

export type ProviderRuntimeLocalLiveOutboundWorkerHandle = Readonly<{
  status: ProviderRuntimeLocalLiveOutboundWorkerStatus;
  workerComposition?: WorkerRuntimeComposition;
  loop?: WorkerRuntimeLoop;
  stop(): Promise<void>;
}>;

type DeferredWorkerLoopStarter = Readonly<{
  stop(): void;
}>;

export async function startProviderRuntimeLocalLiveOutboundWorker(
  composition: Pick<
    ProviderRuntimeComposition,
    "liveMode" | "paths" | "socketProvider" | "supervisor"
  >,
  env: NodeJS.ProcessEnv,
  context: ApplicationPortContext,
): Promise<ProviderRuntimeLocalLiveOutboundWorkerHandle> {
  void context;

  const config = readProviderRuntimeLocalLiveOutboundWorkerConfig(
    env,
    composition.liveMode,
    composition.paths.stateDirectory,
  );

  if (!config.enabled) {
    return Object.freeze({
      status: Object.freeze({
        attempted: false,
        started: false,
        reasonCode: config.reasonCode,
        ...(config.missing.length === 0 ? {} : { missing: Object.freeze([...config.missing]) }),
      }),
      stop: () => Promise.resolve(),
    });
  }

  try {
    const workerComposition = createWorkerRuntimeComposition(
      {
        ...env,
        OMNIWA_WORKER_RUNTIME_PROFILE: "local",
        OMNIWA_WORKER_REPOSITORY_PROFILE: "durable-json",
        OMNIWA_WORKER_REPOSITORY_STATE_DIR: config.repositoryStateDirectory,
        OMNIWA_WORKER_PROVIDER_MODE: "same-process-local-demo",
        OMNIWA_EVENT_LOG_PATH: composition.paths.eventLogPath,
      },
      {
        socketProvider: composition.socketProvider,
      },
    );

    await prepareLocalLiveOutboundWorkerSessionState(workerComposition, {
      instanceId: config.instanceId,
      sessionId: config.sessionId,
    });

    const loop = new WorkerRuntimeLoop({
      app: workerComposition.app,
      intervalMilliseconds: config.intervalMilliseconds,
      onError: () => {
        // Runtime errors are intentionally redacted. The loop keeps running for local live demos.
      },
    });
    const deferredStarter = startWorkerLoopWhenConnected({
      composition,
      instanceId: config.instanceId,
      sessionId: config.sessionId,
      loop,
      intervalMilliseconds: readConnectedWaitIntervalMilliseconds(env),
    });

    return Object.freeze({
      status: Object.freeze({
        attempted: true,
        started: true,
        reasonCode: "local_live_outbound_worker_started",
        instanceId: String(config.instanceId),
        sessionId: String(config.sessionId),
        repositoryStateDirectory: config.repositoryStateDirectory,
        intervalMilliseconds: config.intervalMilliseconds,
      }),
      workerComposition,
      loop,
      stop: async () => {
        deferredStarter.stop();
        await loop.stop();
      },
    });
  } catch {
    return Object.freeze({
      status: Object.freeze({
        attempted: true,
        started: false,
        reasonCode: "local_live_outbound_worker_start_failed",
        instanceId: String(config.instanceId),
        sessionId: String(config.sessionId),
        repositoryStateDirectory: config.repositoryStateDirectory,
        intervalMilliseconds: config.intervalMilliseconds,
        errorCode: "local_live_outbound_worker_start_failed",
      }),
      stop: () => Promise.resolve(),
    });
  }
}

function startWorkerLoopWhenConnected(
  input: Readonly<{
    composition: Pick<ProviderRuntimeComposition, "supervisor">;
    instanceId: InstanceId;
    sessionId: SessionId;
    loop: WorkerRuntimeLoop;
    intervalMilliseconds: number;
  }>,
): DeferredWorkerLoopStarter {
  const startIfConnected = (): boolean => {
    const session = input.composition.supervisor
      .snapshot()
      .sessions.find(
        (candidate) =>
          candidate.instanceId === input.instanceId && candidate.sessionId === input.sessionId,
      );

    if (session?.state !== "CONNECTED") {
      return false;
    }

    input.loop.start();
    return true;
  };

  if (startIfConnected()) {
    return Object.freeze({
      stop: () => {},
    });
  }

  const timer = setInterval(() => {
    if (startIfConnected()) {
      clearInterval(timer);
    }
  }, input.intervalMilliseconds);

  return Object.freeze({
    stop: () => {
      clearInterval(timer);
    },
  });
}

export function readProviderRuntimeLocalLiveOutboundWorkerConfig(
  env: NodeJS.ProcessEnv,
  liveMode: ProviderRuntimeLiveMode,
  stateDirectory: string,
): ProviderRuntimeLocalLiveOutboundWorkerConfig {
  if (liveMode !== "local_live") {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_mode_disabled",
      missing: Object.freeze([]),
    });
  }

  if (!readBooleanEnv(env.OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER)) {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_outbound_worker_disabled",
      missing: Object.freeze([]),
    });
  }

  const instanceIdValue = readOptionalEnvValue(env, "OMNIWA_LIVE_DEMO_INSTANCE_ID");
  const sessionIdValue = readOptionalEnvValue(env, "OMNIWA_LIVE_DEMO_SESSION_ID");
  const missing = [
    ...(instanceIdValue === undefined ? ["OMNIWA_LIVE_DEMO_INSTANCE_ID"] : []),
    ...(sessionIdValue === undefined ? ["OMNIWA_LIVE_DEMO_SESSION_ID"] : []),
  ];

  if (instanceIdValue === undefined || sessionIdValue === undefined) {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_outbound_worker_env_missing",
      missing: Object.freeze(missing),
    });
  }

  try {
    return Object.freeze({
      enabled: true,
      instanceId: createInstanceId(instanceIdValue),
      sessionId: createSessionId(sessionIdValue),
      repositoryStateDirectory: readLocalLiveOutboundWorkerRepositoryStateDirectory(
        env,
        stateDirectory,
      ),
      intervalMilliseconds: readWorkerLoopIntervalMilliseconds(env),
      reasonCode: "local_live_outbound_worker_enabled",
    });
  } catch {
    throw new Error("Invalid OmniWA local live outbound worker configuration.");
  }
}

async function prepareLocalLiveOutboundWorkerSessionState(
  workerComposition: WorkerRuntimeComposition,
  input: Readonly<{
    instanceId: InstanceId;
    sessionId: SessionId;
  }>,
): Promise<void> {
  const repositories = workerComposition.repositories;

  await repositories.sessionRepository?.save(
    activateSession(startSessionPairing(createSession(input.sessionId, input.instanceId))),
  );
  await repositories.instanceRepository.save(
    markInstanceConnected(
      markInstanceConnecting(createInstance(input.instanceId)),
      input.sessionId,
    ),
  );
}

function readLocalLiveOutboundWorkerRepositoryStateDirectory(
  env: NodeJS.ProcessEnv,
  stateDirectory: string,
): string {
  const explicitWorkerDirectory = env.OMNIWA_WORKER_REPOSITORY_STATE_DIR?.trim();
  const explicitApiDirectory = env.OMNIWA_API_REPOSITORY_STATE_DIR?.trim();

  return resolve(
    explicitWorkerDirectory !== undefined && explicitWorkerDirectory.length > 0
      ? explicitWorkerDirectory
      : explicitApiDirectory !== undefined && explicitApiDirectory.length > 0
        ? explicitApiDirectory
        : join(stateDirectory, "repositories"),
  );
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readConnectedWaitIntervalMilliseconds(env: NodeJS.ProcessEnv): number {
  const value = env.OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER_CONNECT_WAIT_MS?.trim();

  if (value === undefined || value.length === 0) {
    return 250;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      "OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER_CONNECT_WAIT_MS must be a positive integer.",
    );
  }

  return parsed;
}

function readOptionalEnvValue(
  env: NodeJS.ProcessEnv,
  key: "OMNIWA_LIVE_DEMO_INSTANCE_ID" | "OMNIWA_LIVE_DEMO_SESSION_ID",
): string | undefined {
  const value = env[key]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}
