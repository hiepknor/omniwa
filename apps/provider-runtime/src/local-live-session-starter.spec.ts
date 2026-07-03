import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { FakeBaileysSocketProvider } from "@omniwa/infrastructure-provider-baileys";
import { createInMemoryEventLogStore } from "@omniwa/infrastructure-persistence";
import { afterEach, describe, expect, it } from "vitest";

import {
  readProviderRuntimeLocalLiveSessionConfig,
  startProviderRuntimeLocalLiveSession,
} from "./local-live-session-starter.js";
import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];
const rawEnvPayload = "raw env payload with invalid spaces";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("provider runtime local live session starter", () => {
  it("does not start a session when local live mode is disabled", async () => {
    const composition = createProviderRuntimeComposition(envFor(createTemporaryDirectory()), {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });

    const result = await startProviderRuntimeLocalLiveSession(
      composition,
      envFor(createTemporaryDirectory()),
      createProviderRuntimeCompositionContext(),
    );

    expect(result).toEqual({
      attempted: false,
      started: false,
      reasonCode: "local_live_mode_disabled",
    });
    expect(composition.supervisor.snapshot().sessions).toEqual([]);
  });

  it("does not start a session when local live instance/session env is missing", async () => {
    const stateDirectory = createTemporaryDirectory();
    const env = {
      ...envFor(stateDirectory),
      OMNIWA_LIVE_DEMO_MODE: "1",
      OMNIWA_LIVE_DEMO_INSTANCE_ID: "local_live_instance_1",
    };
    const composition = createProviderRuntimeComposition(env, {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });

    const result = await startProviderRuntimeLocalLiveSession(
      composition,
      env,
      createProviderRuntimeCompositionContext(),
    );

    expect(result).toEqual({
      attempted: false,
      started: false,
      reasonCode: "local_live_session_env_missing",
      missing: ["OMNIWA_LIVE_DEMO_SESSION_ID"],
    });
    expect(composition.supervisor.snapshot().sessions).toEqual([]);
  });

  it("starts the configured local live session with the default Baileys provider id", async () => {
    const stateDirectory = createTemporaryDirectory();
    const env = liveEnvFor(stateDirectory);
    const socketProvider = new FakeBaileysSocketProvider();
    const composition = createProviderRuntimeComposition(env, {
      eventLog: createInMemoryEventLogStore(),
      socketProvider,
    });

    const result = await startProviderRuntimeLocalLiveSession(
      composition,
      env,
      createProviderRuntimeCompositionContext(),
    );

    expect(result).toEqual({
      attempted: true,
      started: true,
      reasonCode: "local_live_session_started",
      instanceId: "local_live_instance_1",
      providerId: "baileys",
      sessionId: "local_live_session_1",
      state: "STARTING",
    });
    expect(composition.supervisor.snapshot().sessions).toEqual([
      expect.objectContaining({
        instanceId: createInstanceId("local_live_instance_1"),
        providerId: createProviderId("baileys"),
        sessionId: createSessionId("local_live_session_1"),
        state: "STARTING",
      }),
    ]);
  });

  it("supports an explicit provider id and reason code", () => {
    const config = readProviderRuntimeLocalLiveSessionConfig(
      {
        OMNIWA_LIVE_DEMO_INSTANCE_ID: "local_live_instance_2",
        OMNIWA_LIVE_DEMO_PROVIDER_ID: "provider.baileys",
        OMNIWA_LIVE_DEMO_SESSION_ID: "local_live_session_2",
        OMNIWA_LIVE_DEMO_START_REASON_CODE: "manual_local_demo",
      },
      "local_live",
    );

    expect(config).toEqual({
      enabled: true,
      instanceId: createInstanceId("local_live_instance_2"),
      providerId: createProviderId("provider.baileys"),
      sessionId: createSessionId("local_live_session_2"),
      reasonCode: "manual_local_demo",
    });
  });

  it("returns a safe failure when the configured session is already active", async () => {
    const stateDirectory = createTemporaryDirectory();
    const env = liveEnvFor(stateDirectory);
    const composition = createProviderRuntimeComposition(env, {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });
    const context = createProviderRuntimeCompositionContext();

    await startProviderRuntimeLocalLiveSession(composition, env, context);
    const duplicate = await startProviderRuntimeLocalLiveSession(composition, env, context);

    expect(duplicate).toEqual({
      attempted: true,
      started: false,
      reasonCode: "local_live_session_start_failed",
      instanceId: "local_live_instance_1",
      providerId: "baileys",
      sessionId: "local_live_session_1",
      errorCode: "provider_runtime_supervisor_session_already_active",
    });
  });

  it("does not leak invalid raw env values through configuration errors", () => {
    expect(() =>
      readProviderRuntimeLocalLiveSessionConfig(
        {
          OMNIWA_LIVE_DEMO_INSTANCE_ID: rawEnvPayload,
          OMNIWA_LIVE_DEMO_SESSION_ID: "local_live_session_1",
        },
        "local_live",
      ),
    ).toThrow("Invalid OmniWA local live session configuration.");
    expect(() =>
      readProviderRuntimeLocalLiveSessionConfig(
        {
          OMNIWA_LIVE_DEMO_INSTANCE_ID: rawEnvPayload,
          OMNIWA_LIVE_DEMO_SESSION_ID: "local_live_session_1",
        },
        "local_live",
      ),
    ).not.toThrow(rawEnvPayload);
  });
});

function envFor(stateDirectory: string): NodeJS.ProcessEnv {
  return {
    OMNIWA_PROVIDER_RUNTIME_PROFILE: "local",
    OMNIWA_PROVIDER_RUNTIME_STATE_DIR: stateDirectory,
    OMNIWA_PROVIDER_RUNTIME_OWNER_REF: "provider-runtime-local-live-owner",
  };
}

function liveEnvFor(stateDirectory: string): NodeJS.ProcessEnv {
  return {
    ...envFor(stateDirectory),
    OMNIWA_LIVE_DEMO_MODE: "1",
    OMNIWA_LIVE_DEMO_INSTANCE_ID: "local_live_instance_1",
    OMNIWA_LIVE_DEMO_SESSION_ID: "local_live_session_1",
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-provider-runtime-local-live-"));
  temporaryDirectories.push(directory);

  return directory;
}
