import type { ApplicationPortContext } from "@omniwa/application";
import {
  createInstanceId,
  createProviderId,
  createSessionId,
  type InstanceId,
  type ProviderId,
  type SessionId,
} from "@omniwa/domain";

import type { ProviderRuntimeComposition, ProviderRuntimeLiveMode } from "./runtime-composition.js";

export type ProviderRuntimeLocalLiveSessionConfig =
  | Readonly<{
      enabled: false;
      reasonCode: "local_live_mode_disabled" | "local_live_session_env_missing";
      missing: readonly string[];
    }>
  | Readonly<{
      enabled: true;
      instanceId: InstanceId;
      providerId: ProviderId;
      sessionId: SessionId;
      reasonCode: string;
    }>;

export type ProviderRuntimeLocalLiveSessionStartResult = Readonly<{
  attempted: boolean;
  started: boolean;
  reasonCode: string;
  missing?: readonly string[];
  instanceId?: string;
  providerId?: string;
  sessionId?: string;
  state?: string;
  errorCode?: string;
}>;

const defaultLocalLiveProviderId = "baileys";
const defaultLocalLiveStartReasonCode = "local_live_demo_start_session";

export async function startProviderRuntimeLocalLiveSession(
  composition: Pick<ProviderRuntimeComposition, "liveMode" | "supervisor">,
  env: NodeJS.ProcessEnv,
  context: ApplicationPortContext,
): Promise<ProviderRuntimeLocalLiveSessionStartResult> {
  const config = readProviderRuntimeLocalLiveSessionConfig(env, composition.liveMode);

  if (!config.enabled) {
    return Object.freeze({
      attempted: false,
      started: false,
      reasonCode: config.reasonCode,
      ...(config.missing.length === 0 ? {} : { missing: Object.freeze([...config.missing]) }),
    });
  }

  const result = await composition.supervisor.startSession(
    {
      instanceId: config.instanceId,
      providerId: config.providerId,
      sessionId: config.sessionId,
      reasonCode: config.reasonCode,
    },
    context,
  );

  if (!result.ok) {
    return Object.freeze({
      attempted: true,
      started: false,
      reasonCode: "local_live_session_start_failed",
      instanceId: String(config.instanceId),
      providerId: String(config.providerId),
      sessionId: String(config.sessionId),
      errorCode: result.error.code,
    });
  }

  return Object.freeze({
    attempted: true,
    started: true,
    reasonCode: "local_live_session_started",
    instanceId: String(result.value.instanceId),
    providerId: String(result.value.providerId),
    sessionId: String(result.value.sessionId),
    state: result.value.state,
  });
}

export function readProviderRuntimeLocalLiveSessionConfig(
  env: NodeJS.ProcessEnv,
  liveMode: ProviderRuntimeLiveMode,
): ProviderRuntimeLocalLiveSessionConfig {
  if (liveMode !== "local_live") {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_mode_disabled",
      missing: Object.freeze([]),
    });
  }

  const instanceIdValue = readRequiredEnvValue(env, "OMNIWA_LIVE_DEMO_INSTANCE_ID");
  const sessionIdValue = readRequiredEnvValue(env, "OMNIWA_LIVE_DEMO_SESSION_ID");
  const missing = [
    ...(instanceIdValue === undefined ? ["OMNIWA_LIVE_DEMO_INSTANCE_ID"] : []),
    ...(sessionIdValue === undefined ? ["OMNIWA_LIVE_DEMO_SESSION_ID"] : []),
  ];

  if (instanceIdValue === undefined || sessionIdValue === undefined) {
    return Object.freeze({
      enabled: false,
      reasonCode: "local_live_session_env_missing",
      missing: Object.freeze(missing),
    });
  }

  try {
    return Object.freeze({
      enabled: true,
      instanceId: createInstanceId(instanceIdValue),
      providerId: createProviderId(
        readOptionalEnvValue(env, "OMNIWA_LIVE_DEMO_PROVIDER_ID") ?? defaultLocalLiveProviderId,
      ),
      sessionId: createSessionId(sessionIdValue),
      reasonCode:
        readOptionalEnvValue(env, "OMNIWA_LIVE_DEMO_START_REASON_CODE") ??
        defaultLocalLiveStartReasonCode,
    });
  } catch {
    throw new Error("Invalid OmniWA local live session configuration.");
  }
}

function readRequiredEnvValue(
  env: NodeJS.ProcessEnv,
  key: "OMNIWA_LIVE_DEMO_INSTANCE_ID" | "OMNIWA_LIVE_DEMO_SESSION_ID",
): string | undefined {
  return readOptionalEnvValue(env, key);
}

function readOptionalEnvValue(
  env: NodeJS.ProcessEnv,
  key:
    | "OMNIWA_LIVE_DEMO_PROVIDER_ID"
    | "OMNIWA_LIVE_DEMO_START_REASON_CODE"
    | "OMNIWA_LIVE_DEMO_INSTANCE_ID"
    | "OMNIWA_LIVE_DEMO_SESSION_ID",
): string | undefined {
  const value = env[key]?.trim();

  return value === undefined || value.length === 0 ? undefined : value;
}
