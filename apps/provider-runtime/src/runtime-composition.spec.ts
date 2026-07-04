import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type ApplicationPortContext } from "@omniwa/application";
import { createProviderId, createSessionId } from "@omniwa/domain";
import {
  DurableJsonBaileysAuthStateStore,
  FakeBaileysSocketProvider,
  RealBaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import { createInMemoryEventLogStore } from "@omniwa/infrastructure-persistence";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderRuntimeSupervisor } from "./provider-runtime-supervisor.js";
import {
  createProviderRuntimeComposition,
  createProviderRuntimeCompositionContext,
  readProviderRuntimeAuthStatePath,
  readProviderRuntimeCompositionPaths,
  readProviderRuntimeDrainIntervalMilliseconds,
  readProviderRuntimeEventLogPath,
  readProviderRuntimeLiveMode,
  readProviderRuntimeOwnershipLeasePath,
  readProviderRuntimeOwnershipMode,
  readProviderRuntimeStateDirectory,
} from "./runtime-composition.js";

const temporaryDirectories: string[] = [];
const rawAuthPayload = "raw-auth-state-secret-token";
const rawQrPayload = "raw-qr-provider-payload";
const rawProviderPayload = "raw-provider-payload";
const sessionId = createSessionId("provider-runtime-composition-session");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-runtime-composition-correlation"),
    requestId: createRequestId("provider-runtime-composition-request"),
  }),
  actorRef: "provider-runtime-composition-test",
  dataClassification: "internal",
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("provider runtime composition", () => {
  it("creates a supervisor with real provider runtime dependencies", () => {
    const stateDirectory = createTemporaryDirectory();
    const composition = createProviderRuntimeComposition(envFor(stateDirectory));

    expect(composition.profile).toBe("local");
    expect(composition.liveMode).toBe("disabled");
    expect(composition.readiness).toEqual({
      liveMode: "disabled",
      localOnly: false,
      productionReady: false,
      authStateEncryption: "not_configured",
      ownershipMode: "durable_json_local_lease",
    });
    expect(composition.localQrOutput).toEqual({
      mode: "disabled",
    });
    expect(composition.localInboundRecipientOutput).toEqual({
      mode: "disabled",
    });
    expect(composition.supervisor).toBeInstanceOf(ProviderRuntimeSupervisor);
    expect(composition.socketProvider).toBeInstanceOf(RealBaileysSocketProvider);
    expect(composition.authStateStore).toBeInstanceOf(DurableJsonBaileysAuthStateStore);
    expect(composition.paths).toEqual({
      stateDirectory,
      eventLogPath: join(stateDirectory, "event-log.json"),
      authStatePath: join(stateDirectory, "provider-runtime", "baileys-auth-state.json"),
      ownershipLeasePath: join(stateDirectory, "provider-runtime", "ownership-leases.json"),
    });

    composition.shutdown();
  });

  it("composes explicit local live mode with real provider deps and local-only readiness", () => {
    const stateDirectory = createTemporaryDirectory();
    const composition = createProviderRuntimeComposition({
      ...envFor(stateDirectory),
      OMNIWA_LIVE_DEMO_MODE: "1",
      OMNIWA_LOCAL_QR_OUTPUT: "file",
      OMNIWA_LOCAL_INBOUND_RECIPIENT_OUTPUT: "file",
    });

    expect(composition.profile).toBe("local");
    expect(composition.liveMode).toBe("local_live");
    expect(composition.readiness).toEqual({
      liveMode: "local_live",
      localOnly: true,
      productionReady: false,
      authStateEncryption: "not_configured",
      ownershipMode: "durable_json_local_lease",
    });
    expect(composition.socketProvider).toBeInstanceOf(RealBaileysSocketProvider);
    expect(composition.authStateStore).toBeInstanceOf(DurableJsonBaileysAuthStateStore);
    expect(composition.localQrOutput).toEqual({
      mode: "file",
      filePath: join(stateDirectory, "provider-runtime", "local-qr.secret.json"),
    });
    expect(composition.localInboundRecipientOutput).toEqual({
      mode: "file",
      filePath: join(stateDirectory, "provider-runtime", "local-inbound-recipient.secret.json"),
    });
    expect(composition.paths.authStatePath).toBe(
      join(stateDirectory, "provider-runtime", "baileys-auth-state.json"),
    );

    composition.shutdown();
  });

  it("blocks production local live mode until encryption and distributed ownership exist", () => {
    const unsafeStateDirectory = [rawAuthPayload, rawQrPayload, rawProviderPayload].join("-");
    let caught: unknown;

    try {
      createProviderRuntimeComposition({
        OMNIWA_PROVIDER_RUNTIME_PROFILE: "production",
        OMNIWA_LIVE_DEMO_MODE: "1",
        OMNIWA_PROVIDER_RUNTIME_STATE_DIR: unsafeStateDirectory,
      });
    } catch (error) {
      caught = error;
    }

    expect(String(caught)).toContain(
      "requires encrypted auth state and distributed ownership before composition is allowed",
    );
    expect(String(caught)).not.toContain(rawAuthPayload);
    expect(String(caught)).not.toContain(rawQrPayload);
    expect(String(caught)).not.toContain(rawProviderPayload);
  });

  it("uses the shared durable EventLog path", () => {
    const stateDirectory = createTemporaryDirectory();
    const firstComposition = createProviderRuntimeComposition(envFor(stateDirectory));
    const firstAppend = firstComposition.eventLog.appendEvent({
      id: "provider_runtime_composition_event",
      type: "provider.connection.v1",
      timestamp: "2026-07-03T00:00:00.000Z",
      dataClassification: "internal",
      source: "provider_runtime",
      payload: {
        providerId: String(createProviderId("provider.baileys")),
        signalKind: "connection",
      },
    });

    expect(firstAppend.ok).toBe(true);

    const restartedComposition = createProviderRuntimeComposition(envFor(stateDirectory));
    const replay = restartedComposition.eventLog.replayEvents({ limit: 10 });

    expect(replay.ok ? replay.value.events.map((event) => event.id) : []).toContain(
      "provider_runtime_composition_event",
    );
    expect(restartedComposition.paths.eventLogPath).toBe(join(stateDirectory, "event-log.json"));

    firstComposition.shutdown();
    restartedComposition.shutdown();
  });

  it("uses the durable AuthStateStore path", async () => {
    const stateDirectory = createTemporaryDirectory();
    const firstComposition = createProviderRuntimeComposition(envFor(stateDirectory));
    const saved = await firstComposition.authStateStore.save(sessionId, {
      creds: rawAuthPayload,
    });

    expect(saved.ok).toBe(true);

    const restartedComposition = createProviderRuntimeComposition(envFor(stateDirectory));
    const loaded = await restartedComposition.authStateStore.load(sessionId);

    expect(loaded.ok ? loaded.value?.revision : undefined).toBe(1);
    expect(loaded.ok ? loaded.value?.dataClassification : undefined).toBe("secret");
    expect(JSON.stringify(loaded.ok ? loaded.value : undefined)).not.toContain(rawAuthPayload);
    expect(restartedComposition.paths.authStatePath).toBe(
      join(stateDirectory, "provider-runtime", "baileys-auth-state.json"),
    );

    firstComposition.shutdown();
    restartedComposition.shutdown();
  });

  it("starts and shuts down the drain loop with fake dependencies", () => {
    const composition = createProviderRuntimeComposition(envFor(createTemporaryDirectory()), {
      eventLog: createInMemoryEventLogStore(),
      socketProvider: new FakeBaileysSocketProvider(),
    });

    const loop = composition.startDrainLoop(context, 5);

    expect(loop.intervalMilliseconds).toBe(5);
    expect(loop.keepsProcessAlive).toBe(true);
    loop.shutdown();
    expect(composition.supervisor.snapshot().sessions).toEqual([]);
  });

  it("can explicitly use the in-memory ownership mode for deterministic tests", () => {
    const composition = createProviderRuntimeComposition({
      ...envFor(createTemporaryDirectory()),
      OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "in-memory",
    });

    expect(composition.readiness.ownershipMode).toBe("single_instance_in_memory");

    composition.shutdown();
  });

  it("can select PostgreSQL ownership mode when a database URL is configured", () => {
    const composition = createProviderRuntimeComposition({
      ...envFor(createTemporaryDirectory()),
      OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "postgresql",
      OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL:
        "postgresql://omniwa:omniwa@127.0.0.1:5432/omniwa_test",
    });

    expect(composition.readiness.ownershipMode).toBe("postgresql_lease");

    composition.shutdown();
  });

  it("rejects PostgreSQL ownership mode without leaking database configuration", () => {
    const rawDatabaseUrl = "postgresql://raw-secret-user:raw-secret-password@localhost/omniwa";
    let caught: unknown;

    try {
      createProviderRuntimeComposition({
        ...envFor(createTemporaryDirectory()),
        OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "postgresql",
      });
    } catch (error) {
      caught = error;
    }

    expect(String(caught)).toContain("OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_DATABASE_URL");
    expect(String(caught)).not.toContain(rawDatabaseUrl);
  });

  it("replaces the provider-runtime index stub with runtime composition startup", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

    expect(source).toContain("createProviderRuntimeComposition");
    expect(source).toContain('status: "started"');
    expect(source).toContain("liveMode: composition.liveMode");
    expect(source).toContain("readiness: composition.readiness");
    expect(source).toContain("localQrOutput: composition.localQrOutput");
    expect(source).toContain(
      "localInboundRecipientOutput: composition.localInboundRecipientOutput",
    );
    expect(source).toContain("keepsProcessAlive: loop.keepsProcessAlive");
    expect(source).toContain("startProviderRuntimeLocalLiveSession");
    expect(source).toContain("startProviderRuntimeLocalLiveOutboundWorker");
    expect(source).toContain("startProviderRuntimeLocalLiveApiServer");
    expect(source).toContain("localLiveSession");
    expect(source).toContain("localLiveOutboundWorker");
    expect(source).toContain("localLiveApiServer");
    expect(source).not.toContain("requires MessagingProviderPort and SecretProvider");
  });

  it("does not leak raw auth, QR, or provider payloads through startup errors", () => {
    const unsafeStateDirectory = [rawAuthPayload, rawQrPayload, rawProviderPayload].join("-");
    let caught: unknown;

    try {
      createProviderRuntimeComposition({
        OMNIWA_PROVIDER_RUNTIME_PROFILE: "production",
        OMNIWA_PROVIDER_RUNTIME_STATE_DIR: unsafeStateDirectory,
      });
    } catch (error) {
      caught = error;
    }

    const serializedError = String(caught);

    expect(serializedError).not.toContain(rawAuthPayload);
    expect(serializedError).not.toContain(rawQrPayload);
    expect(serializedError).not.toContain(rawProviderPayload);
  });

  it("reads default and explicit provider runtime paths safely", () => {
    const stateDirectory = createTemporaryDirectory();
    const sharedDirectory = createTemporaryDirectory();
    const eventLogPath = join(stateDirectory, "shared-event-log.json");
    const authStatePath = join(stateDirectory, "auth-state.json");
    const ownershipLeasePath = join(stateDirectory, "ownership-leases.json");

    expect(readProviderRuntimeStateDirectory({})).toBe(resolve(".omniwa-local/state"));
    expect(readProviderRuntimeStateDirectory({ OMNIWA_RUNTIME_STATE_DIR: sharedDirectory })).toBe(
      sharedDirectory,
    );
    expect(
      readProviderRuntimeCompositionPaths({
        OMNIWA_PROVIDER_RUNTIME_STATE_DIR: stateDirectory,
        OMNIWA_EVENT_LOG_PATH: eventLogPath,
        OMNIWA_BAILEYS_AUTH_STATE_PATH: authStatePath,
        OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_LEASE_PATH: ownershipLeasePath,
      }),
    ).toEqual({
      stateDirectory,
      eventLogPath,
      authStatePath,
      ownershipLeasePath,
    });
    expect(readProviderRuntimeEventLogPath({}, stateDirectory)).toBe(
      join(stateDirectory, "event-log.json"),
    );
    expect(readProviderRuntimeAuthStatePath({}, stateDirectory)).toBe(
      join(stateDirectory, "provider-runtime", "baileys-auth-state.json"),
    );
    expect(readProviderRuntimeOwnershipLeasePath({}, stateDirectory)).toBe(
      join(stateDirectory, "provider-runtime", "ownership-leases.json"),
    );
    expect(readProviderRuntimeDrainIntervalMilliseconds({})).toBe(1_000);
    expect(
      readProviderRuntimeDrainIntervalMilliseconds({
        OMNIWA_PROVIDER_RUNTIME_DRAIN_INTERVAL_MS: "25",
      }),
    ).toBe(25);
    expect(readProviderRuntimeLiveMode({})).toBe("disabled");
    expect(readProviderRuntimeLiveMode({ OMNIWA_LIVE_DEMO_MODE: "1" })).toBe("local_live");
    expect(readProviderRuntimeLiveMode({ OMNIWA_LIVE_DEMO_MODE: "true" })).toBe("local_live");
    expect(readProviderRuntimeLiveMode({ OMNIWA_LIVE_DEMO_MODE: "local_live" })).toBe("local_live");
    expect(readProviderRuntimeLiveMode({ OMNIWA_LIVE_DEMO_MODE: "false" })).toBe("disabled");
    expect(() =>
      readProviderRuntimeLiveMode({ OMNIWA_LIVE_DEMO_MODE: rawProviderPayload }),
    ).toThrow("Unsupported OmniWA provider runtime live demo mode.");
  });

  it("normalizes provider runtime ownership mode", () => {
    expect(readProviderRuntimeOwnershipMode({})).toBe("durable_json_local_lease");
    expect(
      readProviderRuntimeOwnershipMode({ OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "durable" }),
    ).toBe("durable_json_local_lease");
    expect(
      readProviderRuntimeOwnershipMode({ OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "postgresql" }),
    ).toBe("postgresql_lease");
    expect(
      readProviderRuntimeOwnershipMode({
        OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "single_instance_in_memory",
      }),
    ).toBe("single_instance_in_memory");
    expect(() =>
      readProviderRuntimeOwnershipMode({
        OMNIWA_PROVIDER_RUNTIME_OWNERSHIP_MODE: "unsupported",
      }),
    ).toThrow("Unsupported OmniWA provider runtime ownership mode.");
  });

  it("creates a provider runtime application context", () => {
    const runtimeContext = createProviderRuntimeCompositionContext();

    expect(runtimeContext.actorRef).toBe("provider-runtime");
    expect(String(runtimeContext.requestContext.correlationId)).toContain("provider-runtime:");
    expect(String(runtimeContext.requestContext.requestId)).toContain("provider-runtime:");
  });
});

function envFor(stateDirectory: string): NodeJS.ProcessEnv {
  return {
    OMNIWA_PROVIDER_RUNTIME_PROFILE: "local",
    OMNIWA_PROVIDER_RUNTIME_STATE_DIR: stateDirectory,
    OMNIWA_PROVIDER_RUNTIME_OWNER_REF: "provider-runtime-composition-owner",
  };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-provider-runtime-"));
  temporaryDirectories.push(directory);

  return directory;
}
