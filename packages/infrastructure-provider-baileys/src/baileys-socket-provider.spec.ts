import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { type ApplicationPortContext, type TranslatedProviderSignal } from "@omniwa/application";
import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import type {
  AuthenticationCreds,
  BaileysEventMap,
  UserFacingSocketConfig,
  WASocket,
} from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";

import {
  InMemoryBaileysAuthStateStore,
  type BaileysAuthStateSnapshot,
  type BaileysAuthStateStore,
  type BaileysAuthStateStoreResult,
  type BaileysAuthStateRecord,
  type BaileysAuthStateMetadata,
} from "./baileys-auth-state-store.js";
import { BaileysProviderError } from "./baileys-messaging-provider.adapter.js";
import {
  type BaileysSocketFactory,
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
  RealBaileysSocketProvider,
  type BaileysSocketRequest,
} from "./baileys-socket-provider.js";

const instanceId = createInstanceId("instance_socket_provider_1");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("session_socket_provider_1");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("socket-provider-correlation"),
    requestId: createRequestId("socket-provider-request"),
  }),
  actorRef: "provider-runtime.socket-provider",
  dataClassification: "internal",
};

describe("Baileys socket provider contract", () => {
  it("returns a fake socket by instance/session", () => {
    const provider = new FakeBaileysSocketProvider();
    const socket = new FakeBaileysSocket();

    provider.registerSocket(socketRequest(), socket);

    expect(provider.getSocket(socketRequest(), context)).toBe(socket);
  });

  it("returns safe errors when a socket is missing", () => {
    const provider = new FakeBaileysSocketProvider();

    let caught: unknown;

    try {
      provider.getSocket(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_missing",
      category: "rejected",
      failureCategory: "provider",
      retryable: false,
      message: "Baileys socket is not available for the requested session.",
    });
    expect(String(caught)).not.toContain(String(sessionId));
  });

  it("emits QR, connected, and disconnected lifecycle signals without raw provider payloads", async () => {
    const provider = new FakeBaileysSocketProvider();
    const request = socketRequest();

    const started = provider.startSession(request, context);
    const qr = provider.emitQrRequired(request, context, {
      qr: "raw-qr-secret-token",
      phone: "12025550123@s.whatsapp.net",
    });
    const connected = provider.emitConnected(request, context);
    const disconnected = provider.emitDisconnected(request, context);
    const closed = await provider.closeSession(request, context);

    expect([...started, qr, connected, disconnected, ...closed].map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "auth",
        signalRef: "provider.baileys.qr_required",
        targetRef: sessionId,
        dataClassification: "confidential",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.connected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.disconnected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.disconnected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);

    const drained = provider.drainSignals({ sessionId });

    expect(drained).toHaveLength(5);
    expect(JSON.stringify(drained)).not.toContain("raw-qr-secret-token");
    expect(JSON.stringify(drained)).not.toContain("12025550123");
  });

  it("maps provider-native errors to safe BaileysProviderError values", () => {
    const provider = new FakeBaileysSocketProvider();
    const rawError = Object.assign(new Error("raw provider payload with session-secret-token"), {
      output: { statusCode: 503 },
    });
    provider.failNextGetSocket(rawError);

    let caught: unknown;

    try {
      provider.getSocket(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_provider_failure",
      category: "unavailable",
      failureCategory: "network",
      retryable: true,
      message: "Baileys socket provider failed with a sanitized provider error.",
    });
    expect(String(caught)).not.toContain("session-secret-token");
    expect(JSON.stringify(caught)).not.toContain("session-secret-token");
  });

  it("keeps direct Baileys imports isolated to infrastructure-provider-baileys", () => {
    const offenders = findWorkspaceSourceFiles()
      .filter((filePath) => !filePath.includes("packages/infrastructure-provider-baileys/"))
      .filter((filePath) => readFileSync(filePath, "utf8").includes("@whiskeysockets/baileys"))
      .map((filePath) => relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});

describe("RealBaileysSocketProvider", () => {
  it("loads auth state before creating a socket", async () => {
    const store = new RecordingAuthStateStore();
    const harness = createRealProviderHarness({ authStateStore: store });

    const started = await harness.provider.startSession(socketRequest(), context);

    expect(started.map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);
    expect(store.loads).toEqual([sessionId]);
    expect(harness.factoryCalls).toHaveLength(1);
    expect(harness.factoryCalls[0]?.auth).toBeDefined();
  });

  it("saves auth state when Baileys emits creds.update", async () => {
    const store = new RecordingAuthStateStore();
    const harness = createRealProviderHarness({ authStateStore: store });
    const rawAuthSecret = "raw-auth-update-secret-token";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("creds.update", {
      advSecretKey: rawAuthSecret,
    } as Partial<AuthenticationCreds>);
    await Promise.resolve();

    expect(store.saves).toHaveLength(1);
    expect(store.saveResults).toEqual([
      expect.objectContaining({
        sessionId,
        revision: 1,
        dataClassification: "secret",
      }),
    ]);
    expect(JSON.stringify(store.saveResults)).not.toContain(rawAuthSecret);
  });

  it("returns the created socket by instance/session", async () => {
    const harness = createRealProviderHarness();

    await harness.provider.startSession(socketRequest(), context);

    expect(harness.provider.getSocket(socketRequest(), context)).toBe(harness.socket);
  });

  it("returns safe errors when real provider socket is missing", () => {
    const harness = createRealProviderHarness();

    let caught: unknown;

    try {
      harness.provider.getSocket(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_missing",
      category: "rejected",
      failureCategory: "provider",
      retryable: false,
    });
    expect(String(caught)).not.toContain(String(sessionId));
  });

  it("maps connection.update QR/open/close to safe translated provider signals", async () => {
    const harness = createRealProviderHarness();
    const rawQrSecret = "raw-real-provider-qr-secret-token";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: rawQrSecret,
    });
    harness.socket.ev.emit("connection.update", {
      connection: "open",
    });
    harness.socket.ev.emit("connection.update", {
      connection: "close",
      lastDisconnect: {
        error: Object.assign(new Error("raw disconnect with jid 12025550123@s.whatsapp.net"), {
          output: { statusCode: 503 },
        }),
        date: new Date("2026-07-03T00:00:00.000Z"),
      },
    });

    const signals = harness.provider.drainSignals({ sessionId });

    expect(signals.map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "auth",
        signalRef: "provider.baileys.qr_required",
        targetRef: sessionId,
        dataClassification: "confidential",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.connected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "connection",
        signalRef: "provider.baileys.disconnected",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);
    expect(JSON.stringify(signals)).not.toContain(rawQrSecret);
    expect(JSON.stringify(signals)).not.toContain("12025550123");
  });

  it("maps provider factory errors without leaking raw provider payload or auth state", async () => {
    const rawAuthSecret = "raw-auth-state-secret-token";
    const rawProviderPayload = "raw provider payload with jid 12025550123@s.whatsapp.net";
    const provider = new RealBaileysSocketProvider({
      authStateStore: new RecordingAuthStateStore({
        creds: {
          advSecretKey: rawAuthSecret,
        },
      }),
      socketFactory: () => {
        throw Object.assign(new Error(rawProviderPayload), {
          output: { statusCode: 503 },
        });
      },
    });

    let caught: unknown;

    try {
      await provider.startSession(socketRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_socket_provider_failure",
      category: "unavailable",
      failureCategory: "network",
      retryable: true,
    });
    expect(String(caught)).not.toContain(rawProviderPayload);
    expect(JSON.stringify(caught)).not.toContain(rawProviderPayload);
    expect(JSON.stringify(caught)).not.toContain(rawAuthSecret);
    expect(JSON.stringify(provider.drainSignals())).toEqual("[]");
  });
});

function socketRequest(): BaileysSocketRequest {
  return {
    instanceId,
    providerId,
    sessionId,
    reasonCode: "socket_provider_test",
  };
}

function createRealProviderHarness(
  options: Readonly<{
    authStateStore?: BaileysAuthStateStore;
  }> = {},
): Readonly<{
  provider: RealBaileysSocketProvider;
  socket: MockRealBaileysSocket;
  factoryCalls: UserFacingSocketConfig[];
}> {
  const socket = new MockRealBaileysSocket();
  const factoryCalls: UserFacingSocketConfig[] = [];
  const socketFactory: BaileysSocketFactory = (config) => {
    factoryCalls.push(config);
    return socket.asWASocket();
  };
  const provider = new RealBaileysSocketProvider({
    authStateStore: options.authStateStore ?? new RecordingAuthStateStore(),
    socketFactory,
  });

  return {
    provider,
    socket,
    factoryCalls,
  };
}

function signalSummary(
  signal: TranslatedProviderSignal,
): Pick<TranslatedProviderSignal, "kind" | "signalRef" | "targetRef" | "dataClassification"> {
  return {
    kind: signal.kind,
    signalRef: signal.signalRef,
    targetRef: signal.targetRef,
    dataClassification: signal.dataClassification,
  };
}

class RecordingAuthStateStore implements BaileysAuthStateStore {
  readonly loads = [] as (typeof sessionId)[];
  readonly saves: BaileysAuthStateSnapshot[] = [];
  readonly saveResults: BaileysAuthStateMetadata[] = [];
  private readonly delegate = new InMemoryBaileysAuthStateStore();

  constructor(initialState?: BaileysAuthStateSnapshot) {
    if (initialState !== undefined) {
      void this.delegate.save(sessionId, initialState);
    }
  }

  async load(
    requestedSessionId: typeof sessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateRecord | undefined>> {
    this.loads.push(requestedSessionId);
    return this.delegate.load(requestedSessionId);
  }

  async save(
    requestedSessionId: typeof sessionId,
    state: BaileysAuthStateSnapshot,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata>> {
    this.saves.push(state);
    const result = await this.delegate.save(requestedSessionId, state);

    if (result.ok) {
      this.saveResults.push(result.value);
    }

    return result;
  }

  clear(
    requestedSessionId: typeof sessionId,
  ): Promise<BaileysAuthStateStoreResult<BaileysAuthStateMetadata | undefined>> {
    return this.delegate.clear(requestedSessionId);
  }
}

class MockRealBaileysSocket {
  readonly ev = new MockBaileysEventEmitter();
  readonly user = {
    id: "mock-real-baileys-user",
  };
  logoutCalled = false;

  sendMessage: FakeBaileysSocket["sendMessage"] = async () =>
    ({
      key: {
        id: "real-provider-fake-receipt",
      },
    }) as Awaited<ReturnType<FakeBaileysSocket["sendMessage"]>>;

  logout: FakeBaileysSocket["logout"] = async () => {
    this.logoutCalled = true;
  };

  requestPairingCode: FakeBaileysSocket["requestPairingCode"] = async () => "pairing-code";

  asWASocket(): WASocket {
    return this as unknown as WASocket;
  }
}

class MockBaileysEventEmitter {
  private readonly listeners = new Map<string, Set<(arg: unknown) => void>>();

  on<TEvent extends keyof BaileysEventMap>(
    event: TEvent,
    listener: (arg: BaileysEventMap[TEvent]) => void,
  ): void {
    const listeners = this.listeners.get(event) ?? new Set<(arg: unknown) => void>();
    listeners.add(listener as (arg: unknown) => void);
    this.listeners.set(event, listeners);
  }

  off<TEvent extends keyof BaileysEventMap>(
    event: TEvent,
    listener: (arg: BaileysEventMap[TEvent]) => void,
  ): void {
    this.listeners.get(event)?.delete(listener as (arg: unknown) => void);
  }

  removeAllListeners<TEvent extends keyof BaileysEventMap>(event: TEvent): void {
    this.listeners.delete(event);
  }

  emit<TEvent extends keyof BaileysEventMap>(event: TEvent, arg: BaileysEventMap[TEvent]): boolean {
    const listeners = this.listeners.get(event);

    if (listeners === undefined) {
      return false;
    }

    for (const listener of listeners) {
      listener(arg);
    }

    return true;
  }
}

function findWorkspaceSourceFiles(): string[] {
  return ["apps", "packages", "tooling"].flatMap((root) => {
    const rootPath = join(process.cwd(), root);
    return existsSync(rootPath) ? findFiles(rootPath) : [];
  });
}

function findFiles(rootPath: string): string[] {
  const entries = readdirSync(rootPath);
  const output: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootPath, entry);

    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") {
      continue;
    }

    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      output.push(...findFiles(entryPath));
      continue;
    }

    if (/\.(?:ts|tsx|js|mjs|json)$/.test(entry)) {
      output.push(entryPath);
    }
  }

  return output;
}
