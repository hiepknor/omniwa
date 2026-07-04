import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { FakeBaileysSocketProvider } from "@omniwa/infrastructure-provider-baileys";
import { createInMemoryEventLogStore } from "@omniwa/infrastructure-persistence";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
} from "./runtime-composition.js";
import {
  readProviderRuntimeLocalLiveOutboundWorkerConfig,
  startProviderRuntimeLocalLiveOutboundWorker,
} from "./local-live-outbound-worker.js";

const temporaryDirectories: string[] = [];
const instanceId = createInstanceId("local_live_outbound_instance_1");
const sessionId = createSessionId("local_live_outbound_session_1");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("provider runtime local live outbound worker", () => {
  it("is disabled by default", async () => {
    const stateDirectory = createTemporaryDirectory();
    const composition = createProviderRuntimeComposition(envFor(stateDirectory), {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });
    const handle = await startProviderRuntimeLocalLiveOutboundWorker(
      composition,
      envFor(stateDirectory),
      createProviderRuntimeCompositionContext(),
    );

    expect(handle.status).toEqual({
      attempted: false,
      started: false,
      reasonCode: "local_live_mode_disabled",
    });

    await handle.stop();
    composition.shutdown();
  });

  it("requires explicit local live outbound worker enablement", () => {
    expect(
      readProviderRuntimeLocalLiveOutboundWorkerConfig(
        {
          OMNIWA_LIVE_DEMO_INSTANCE_ID: String(instanceId),
          OMNIWA_LIVE_DEMO_SESSION_ID: String(sessionId),
        },
        "local_live",
        createTemporaryDirectory(),
      ),
    ).toEqual({
      enabled: false,
      reasonCode: "local_live_outbound_worker_disabled",
      missing: [],
    });
  });

  it("starts a same-process durable-json worker with the provider-runtime socket", async () => {
    const stateDirectory = createTemporaryDirectory();
    const repositoryStateDirectory = join(stateDirectory, "repositories");
    const socketProvider = new FakeBaileysSocketProvider();
    const env = {
      ...envFor(stateDirectory),
      OMNIWA_LIVE_DEMO_MODE: "1",
      OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER: "1",
      OMNIWA_LIVE_DEMO_INSTANCE_ID: String(instanceId),
      OMNIWA_LIVE_DEMO_SESSION_ID: String(sessionId),
      OMNIWA_WORKER_REPOSITORY_STATE_DIR: repositoryStateDirectory,
      OMNIWA_WORKER_LOOP_INTERVAL_MS: "50",
      OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER_CONNECT_WAIT_MS: "10",
    };
    const composition = createProviderRuntimeComposition(env, {
      eventLog: createInMemoryEventLogStore(),
      socketProvider,
    });
    const handle = await startProviderRuntimeLocalLiveOutboundWorker(
      composition,
      env,
      createProviderRuntimeCompositionContext(),
    );

    expect(handle.status).toEqual({
      attempted: true,
      started: true,
      reasonCode: "local_live_outbound_worker_started",
      instanceId: String(instanceId),
      sessionId: String(sessionId),
      repositoryStateDirectory,
      intervalMilliseconds: 50,
    });
    expect(handle.workerComposition?.repositoryProfile).toBe("durable-json");
    expect(handle.workerComposition?.providerMode).toBe("same-process-local-demo");
    expect(handle.workerComposition?.socketProvider).toBe(socketProvider);
    expect(handle.loop?.snapshot()).toEqual({
      running: false,
      intervalMilliseconds: 50,
    });

    const instance =
      await handle.workerComposition?.repositories.instanceRepository.load(instanceId);
    const session = await handle.workerComposition?.repositories.sessionRepository?.load(sessionId);

    expect(instance?.status).toBe("connected");
    expect(instance?.currentSessionId).toBe(sessionId);
    expect(session?.status).toBe("active");

    const context = createProviderRuntimeCompositionContext();
    const socketRequest = {
      instanceId,
      providerId: createProviderId("baileys"),
      sessionId,
      reasonCode: "local_live_outbound_worker_test",
    };

    await composition.supervisor.startSession(socketRequest, context);
    socketProvider.emitConnected(socketRequest, context);
    await composition.supervisor.tick(context);
    await wait(30);

    expect(handle.loop?.snapshot().running).toBe(true);

    await handle.stop();
    expect(handle.loop?.snapshot().running).toBe(false);
    composition.shutdown();
  });

  it("reports missing live session env without unsafe values", () => {
    const config = readProviderRuntimeLocalLiveOutboundWorkerConfig(
      {
        OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER: "1",
      },
      "local_live",
      createTemporaryDirectory(),
    );

    expect(config).toEqual({
      enabled: false,
      reasonCode: "local_live_outbound_worker_env_missing",
      missing: ["OMNIWA_LIVE_DEMO_INSTANCE_ID", "OMNIWA_LIVE_DEMO_SESSION_ID"],
    });
  });
});

function envFor(stateDirectory: string): NodeJS.ProcessEnv {
  return {
    OMNIWA_PROVIDER_RUNTIME_PROFILE: "local",
    OMNIWA_PROVIDER_RUNTIME_STATE_DIR: stateDirectory,
    OMNIWA_PROVIDER_RUNTIME_OWNER_REF: "local-live-outbound-worker-test",
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-local-live-outbound-worker-"));
  temporaryDirectories.push(directory);

  return directory;
}
