import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createInstanceId, createSessionId } from "@omniwa/domain";
import { FakeBaileysSocketProvider } from "@omniwa/infrastructure-provider-baileys";
import { createInMemoryEventLogStore } from "@omniwa/infrastructure-persistence";
import { afterEach, describe, expect, it } from "vitest";

import { startProviderRuntimeLocalLiveOutboundWorker } from "./local-live-outbound-worker.js";
import {
  readProviderRuntimeLocalLiveApiServerConfig,
  startProviderRuntimeLocalLiveApiServer,
} from "./local-live-api-server.js";
import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];
const instanceId = createInstanceId("local_live_api_instance_1");
const sessionId = createSessionId("local_live_api_session_1");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("provider runtime local live API server", () => {
  it("is disabled by default", () => {
    expect(readProviderRuntimeLocalLiveApiServerConfig({}, "local_live")).toEqual({
      enabled: false,
      reasonCode: "local_live_api_disabled",
    });
  });

  it("serves the public REST API with the same worker composition", async () => {
    const stateDirectory = createTemporaryDirectory();
    const env = {
      ...envFor(stateDirectory),
      OMNIWA_LIVE_DEMO_MODE: "1",
      OMNIWA_LOCAL_LIVE_OUTBOUND_WORKER: "1",
      OMNIWA_LOCAL_LIVE_API: "1",
      OMNIWA_LOCAL_LIVE_API_PORT: "0",
      OMNIWA_API_KEY: "local-live-api-test-key",
      OMNIWA_LIVE_DEMO_INSTANCE_ID: String(instanceId),
      OMNIWA_LIVE_DEMO_SESSION_ID: String(sessionId),
      OMNIWA_WORKER_REPOSITORY_STATE_DIR: join(stateDirectory, "repositories"),
    };
    const composition = createProviderRuntimeComposition(env, {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });
    const workerHandle = await startProviderRuntimeLocalLiveOutboundWorker(
      composition,
      env,
      createProviderRuntimeCompositionContext(),
    );
    const apiHandle = await startProviderRuntimeLocalLiveApiServer(
      composition,
      workerHandle.workerComposition,
      env,
    );
    const address = apiHandle.server?.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/v1/health`, {
      headers: {
        "x-api-key": "local-live-api-test-key",
      },
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(apiHandle.status).toMatchObject({
      attempted: true,
      started: true,
      reasonCode: "local_live_api_started",
      host: "127.0.0.1",
      port: 0,
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).toContain("health");
    expect(workerHandle.workerComposition?.dispatcher).toBeDefined();
    expect(workerHandle.workerComposition?.outboundMessageIntentStore).toBeDefined();

    await apiHandle.stop();
    await workerHandle.stop();
    composition.shutdown();
  });
});

function envFor(stateDirectory: string): NodeJS.ProcessEnv {
  return {
    OMNIWA_PROVIDER_RUNTIME_PROFILE: "local",
    OMNIWA_PROVIDER_RUNTIME_STATE_DIR: stateDirectory,
    OMNIWA_PROVIDER_RUNTIME_OWNER_REF: "local-live-api-test",
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-local-live-api-"));
  temporaryDirectories.push(directory);

  return directory;
}
