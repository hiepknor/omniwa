import type { Server } from "node:http";

import {
  createApiHttpServer,
  createEventLogRealtimeEventSource,
  readApiKeysFromEnv,
} from "@omniwa/app-api";
import type { WorkerRuntimeComposition } from "@omniwa/app-worker";

import type { ProviderRuntimeComposition, ProviderRuntimeLiveMode } from "./runtime-composition.js";

export type ProviderRuntimeLocalLiveApiServerConfig =
  | Readonly<{
      enabled: false;
      reasonCode:
        "local_live_mode_disabled" | "local_live_api_disabled" | "local_live_api_worker_missing";
    }>
  | Readonly<{
      enabled: true;
      host: string;
      port: number;
      reasonCode: "local_live_api_enabled";
    }>;

export type ProviderRuntimeLocalLiveApiServerStatus = Readonly<{
  attempted: boolean;
  started: boolean;
  reasonCode: string;
  host?: string;
  port?: number;
  errorCode?: string;
}>;

export type ProviderRuntimeLocalLiveApiServerHandle = Readonly<{
  status: ProviderRuntimeLocalLiveApiServerStatus;
  server?: Server;
  stop(): Promise<void>;
}>;

export async function startProviderRuntimeLocalLiveApiServer(
  composition: Pick<ProviderRuntimeComposition, "eventLog" | "liveMode">,
  workerComposition: WorkerRuntimeComposition | undefined,
  env: NodeJS.ProcessEnv,
): Promise<ProviderRuntimeLocalLiveApiServerHandle> {
  const config = readProviderRuntimeLocalLiveApiServerConfig(env, composition.liveMode);

  if (!config.enabled) {
    return Object.freeze({
      status: Object.freeze({
        attempted: false,
        started: false,
        reasonCode: config.reasonCode,
      }),
      stop: () => Promise.resolve(),
    });
  }

  if (workerComposition === undefined) {
    return Object.freeze({
      status: Object.freeze({
        attempted: false,
        started: false,
        reasonCode: "local_live_api_worker_missing",
      }),
      stop: () => Promise.resolve(),
    });
  }

  const server = createApiHttpServer({
    dispatcher: workerComposition.dispatcher,
    outboundMessageIntentStore: workerComposition.outboundMessageIntentStore,
    eventSource: createEventLogRealtimeEventSource(composition.eventLog),
    apiKeys: readApiKeysFromEnv(env),
  });

  try {
    await listen(server, config.port, config.host);
  } catch {
    return Object.freeze({
      status: Object.freeze({
        attempted: true,
        started: false,
        reasonCode: "local_live_api_start_failed",
        host: config.host,
        port: config.port,
        errorCode: "local_live_api_start_failed",
      }),
      stop: () => closeServer(server),
    });
  }

  return Object.freeze({
    status: Object.freeze({
      attempted: true,
      started: true,
      reasonCode: "local_live_api_started",
      host: config.host,
      port: config.port,
    }),
    server,
    stop: () => closeServer(server),
  });
}

export function readProviderRuntimeLocalLiveApiServerConfig(
  env: NodeJS.ProcessEnv,
  liveMode: ProviderRuntimeLiveMode,
): ProviderRuntimeLocalLiveApiServerConfig {
  if (liveMode !== "local_live") {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_mode_disabled",
    });
  }

  if (!readBooleanEnv(env.OMNIWA_LOCAL_LIVE_API)) {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_api_disabled",
    });
  }

  return Object.freeze({
    enabled: true,
    host: readOptionalEnvValue(env, "OMNIWA_LOCAL_LIVE_API_HOST") ?? "127.0.0.1",
    port: readPortEnv(env.OMNIWA_LOCAL_LIVE_API_PORT, 3001),
    reasonCode: "local_live_api_enabled",
  });
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function readPortEnv(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("OMNIWA_LOCAL_LIVE_API_PORT must be a valid TCP port.");
  }

  return parsed;
}

function readOptionalEnvValue(
  env: NodeJS.ProcessEnv,
  key: "OMNIWA_LOCAL_LIVE_API_HOST",
): string | undefined {
  const value = env[key]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}
