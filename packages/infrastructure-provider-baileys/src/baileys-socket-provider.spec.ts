import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { type ApplicationPortContext, type TranslatedProviderSignal } from "@omniwa/application";
import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import type {
  AuthenticationCreds,
  BaileysEventMap,
  UserFacingSocketConfig,
  WAMessage,
  WAMessageUpdate,
  WASocket,
} from "@whiskeysockets/baileys";
import { DisconnectReason, WAMessageStatus } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";

import {
  DurableJsonBaileysAuthStateStore,
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
  mapBaileysDisconnectReason,
  type BaileysInboundRecipientOperatorEvent,
  type BaileysInboundRecipientOperatorSink,
  type BaileysQrCodeOperatorEvent,
  type BaileysQrCodeOperatorSink,
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
    const order: string[] = [];
    const socket = new MockRealBaileysSocket();
    const factoryCalls: UserFacingSocketConfig[] = [];
    const provider = new RealBaileysSocketProvider({
      authStateStore: {
        load: async (requestedSessionId) => {
          order.push("load");
          return store.load(requestedSessionId);
        },
        save: (requestedSessionId, state) => store.save(requestedSessionId, state),
        clear: (requestedSessionId) => store.clear(requestedSessionId),
      },
      socketFactory: (config) => {
        order.push("factory");
        factoryCalls.push(config);
        return socket.asWASocket();
      },
    });

    const started = await provider.startSession(socketRequest(), context);

    expect(started.map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);
    expect(store.loads).toEqual([sessionId]);
    expect(order).toEqual(["load", "factory"]);
    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]?.auth).toBeDefined();
    expect(factoryCalls[0]?.logger?.level).toBe("silent");
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

  it("reloads durable-json auth state into a recreated real provider after restart", async () => {
    const filePath = join(
      mkdtempSync(join(tmpdir(), "omniwa-real-provider-auth-")),
      "auth-state.json",
    );
    const rawAuthSecret = "raw-restart-auth-secret-token";

    const firstHarness = createRealProviderHarness({
      authStateStore: new DurableJsonBaileysAuthStateStore(filePath),
    });

    await firstHarness.provider.startSession(socketRequest(), context);
    firstHarness.socket.ev.emit("creds.update", {
      advSecretKey: rawAuthSecret,
    } as Partial<AuthenticationCreds>);
    await flushAsyncSignals();

    const rawFile = readFileSync(filePath, "utf8");
    expect(rawFile).not.toContain(rawAuthSecret);

    const secondHarness = createRealProviderHarness({
      authStateStore: new DurableJsonBaileysAuthStateStore(filePath),
    });

    await secondHarness.provider.startSession(socketRequest(), context);

    expect(secondHarness.factoryCalls).toHaveLength(1);
    expect(secondHarness.factoryCalls[0]?.auth.creds).toMatchObject({
      advSecretKey: rawAuthSecret,
    });
    expect(JSON.stringify(secondHarness.provider.drainSignals({ sessionId }))).not.toContain(
      rawAuthSecret,
    );
  });

  it("restarts from durable auth without requiring another QR when stored credentials are accepted", async () => {
    const filePath = join(
      mkdtempSync(join(tmpdir(), "omniwa-real-provider-auth-restart-")),
      "auth-state.json",
    );
    const rawFirstQr = "raw-first-live-demo-qr-secret-token";
    const rawSecondQr = "raw-second-live-demo-qr-secret-token";
    const rawAuthSecret = "raw-live-demo-restart-auth-secret-token";
    const firstQrEvents: BaileysQrCodeOperatorEvent[] = [];
    const secondQrEvents: BaileysQrCodeOperatorEvent[] = [];

    const firstHarness = createRealProviderHarness({
      authStateStore: new DurableJsonBaileysAuthStateStore(filePath),
      qrCodeOperatorSink: {
        captureQrCode: (event) => {
          firstQrEvents.push(event);
        },
      },
    });

    await firstHarness.provider.startSession(socketRequest(), context);
    firstHarness.socket.ev.emit("connection.update", {
      qr: rawFirstQr,
    });
    firstHarness.socket.ev.emit("creds.update", {
      advSecretKey: rawAuthSecret,
    } as Partial<AuthenticationCreds>);
    await flushAsyncSignals();

    const firstSignals = firstHarness.provider.drainSignals({ sessionId });
    expect(firstSignals.map((signal) => signal.signalRef)).toContain(
      "provider.baileys.qr_required",
    );
    expect(firstQrEvents).toHaveLength(1);
    expect(JSON.stringify(firstSignals)).not.toContain(rawFirstQr);
    expect(JSON.stringify(firstSignals)).not.toContain(rawAuthSecret);

    const secondSocket = new MockRealBaileysSocket();
    const secondFactoryCalls: UserFacingSocketConfig[] = [];
    const secondProvider = new RealBaileysSocketProvider({
      authStateStore: new DurableJsonBaileysAuthStateStore(filePath),
      qrCodeOperatorSink: {
        captureQrCode: (event) => {
          secondQrEvents.push(event);
        },
      },
      socketFactory: (config) => {
        secondFactoryCalls.push(config);

        queueMicrotask(() => {
          const loadedAuthSecret = (config.auth.creds as Partial<AuthenticationCreds>).advSecretKey;
          secondSocket.ev.emit(
            "connection.update",
            loadedAuthSecret === rawAuthSecret ? { connection: "open" } : { qr: rawSecondQr },
          );
        });

        return secondSocket.asWASocket();
      },
    });

    await secondProvider.startSession(socketRequest(), context);
    await flushAsyncSignals();

    const secondSignals = secondProvider.drainSignals({ sessionId });

    expect(secondFactoryCalls).toHaveLength(1);
    expect(secondFactoryCalls[0]?.auth.creds).toMatchObject({
      advSecretKey: rawAuthSecret,
    });
    expect(secondSignals.map((signal) => signal.signalRef)).toEqual([
      "provider.baileys.connecting",
      "provider.baileys.connected",
    ]);
    expect(secondQrEvents).toEqual([]);
    expect(JSON.stringify(secondSignals)).not.toContain(rawFirstQr);
    expect(JSON.stringify(secondSignals)).not.toContain(rawSecondQr);
    expect(JSON.stringify(secondSignals)).not.toContain(rawAuthSecret);
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
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
      qrChallengeTtlMs: 90_000,
    });
    const rawQrSecret = "raw-real-provider-qr-secret-token";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: rawQrSecret,
    });
    harness.socket.ev.emit("connection.update", {
      connection: "open",
    });
    harness.socket.ev.emit("connection.update", closeUpdate(DisconnectReason.connectionClosed));
    await flushAsyncSignals();

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
        signalRef: "provider.baileys.reconnecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
    ]);
    const qrSignal = signals.find((signal) => signal.signalRef === "provider.baileys.qr_required");
    expect(qrSignal).toMatchObject({
      safeMetadata: {
        challengeRef: expect.stringMatching(/^qr_challenge_[a-f0-9]{16}$/u),
        expiresAtEpochMilliseconds: 1_804_000_090_000,
        refreshPolicy: "replace_active",
      },
    });
    expect(qrSignal?.occurrenceRef).toContain(qrSignal?.safeMetadata?.challengeRef);
    expect(JSON.stringify(signals)).not.toContain(rawQrSecret);
    expect(JSON.stringify(signals)).not.toContain("12025550123");
  });

  it("sends raw QR only to the local-only operator sink and keeps signals safe", async () => {
    const capturedQrEvents: BaileysQrCodeOperatorEvent[] = [];
    const rawQrSecret = "raw-local-operator-qr-secret-token";
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
      qrCodeOperatorSink: {
        captureQrCode: (event) => {
          capturedQrEvents.push(event);
        },
      },
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: rawQrSecret,
    });
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });
    const qrSignal = signals.find((signal) => signal.signalRef === "provider.baileys.qr_required");

    expect(capturedQrEvents).toEqual([
      {
        instanceId,
        providerId,
        sessionId,
        challengeRef: qrSignal?.safeMetadata?.challengeRef,
        expiresAtEpochMilliseconds: 1_804_000_060_000,
        qrCode: rawQrSecret,
        dataClassification: "secret",
        localOnly: true,
      },
    ]);
    expect(JSON.stringify(signals)).not.toContain(rawQrSecret);
  });

  it("maps local QR operator sink failures to safe provider signals", async () => {
    const rawQrSecret = "raw-failing-operator-qr-secret-token";
    const harness = createRealProviderHarness({
      qrCodeOperatorSink: {
        captureQrCode: () => {
          throw new Error(`sink failed for ${rawQrSecret}`);
        },
      },
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: rawQrSecret,
    });
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });

    expect(signals.map((signal) => signal.signalRef)).toContain(
      "provider.baileys.qr_operator_sink_failed",
    );
    expect(signals.at(-1)).toMatchObject({
      kind: "failure",
      signalRef: "provider.baileys.qr_operator_sink_failed",
      dataClassification: "confidential",
      safeMetadata: {
        reasonCode: "qr_operator_sink_failed",
        challengeRef: expect.stringMatching(/^qr_challenge_[a-f0-9]{16}$/u),
      },
    });
    expect(JSON.stringify(signals)).not.toContain(rawQrSecret);
  });

  it("creates stable QR occurrence refs and distinct refresh challenge refs", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
      qrChallengeTtlMs: 60_000,
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: "raw-qr-secret-token-a",
    });
    harness.socket.ev.emit("connection.update", {
      qr: "raw-qr-secret-token-a",
    });
    harness.socket.ev.emit("connection.update", {
      qr: "raw-qr-secret-token-b",
    });
    await flushAsyncSignals();

    const qrSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.signalRef === "provider.baileys.qr_required");

    expect(qrSignals).toHaveLength(3);
    expect(qrSignals[0]?.occurrenceRef).toBe(qrSignals[1]?.occurrenceRef);
    expect(qrSignals[0]?.safeMetadata?.challengeRef).toBe(qrSignals[1]?.safeMetadata?.challengeRef);
    expect(qrSignals[2]?.occurrenceRef).not.toBe(qrSignals[0]?.occurrenceRef);
    expect(qrSignals[2]?.safeMetadata?.challengeRef).not.toBe(
      qrSignals[0]?.safeMetadata?.challengeRef,
    );
    expect(qrSignals.map((signal) => signal.safeMetadata)).toEqual([
      expect.objectContaining({
        expiresAtEpochMilliseconds: 1_804_000_060_000,
        refreshPolicy: "replace_active",
      }),
      expect.objectContaining({
        expiresAtEpochMilliseconds: 1_804_000_060_000,
        refreshPolicy: "replace_active",
      }),
      expect.objectContaining({
        expiresAtEpochMilliseconds: 1_804_000_060_000,
        refreshPolicy: "replace_active",
      }),
    ]);
    expect(JSON.stringify(qrSignals)).not.toContain("raw-qr-secret-token");
  });

  it("fails safe for malformed QR updates without leaking provider payloads", async () => {
    const harness = createRealProviderHarness();

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", {
      qr: "   ",
    });
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });

    expect(signals.map(signalSummary).at(-1)).toEqual({
      kind: "failure",
      signalRef: "provider.baileys.qr_update_invalid",
      targetRef: sessionId,
      dataClassification: "confidential",
    });
    expect(signals.at(-1)?.safeMetadata).toEqual({
      reasonCode: "malformed_qr",
    });
    expect(JSON.stringify(signals)).not.toContain("   ");
  });

  it("maps messages.upsert into safe inbound_message signals", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
    });
    const rawJid = "12025550123@s.whatsapp.net";
    const rawText = "raw inbound text secret";
    const rawProviderMessageId = "BAILEYS_RAW_MESSAGE_ID_1";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.upsert",
      inboundUpsert({
        key: {
          id: rawProviderMessageId,
          remoteJid: rawJid,
          fromMe: false,
        },
        messageTimestamp: 1_804_000_001,
        message: {
          conversation: rawText,
        },
      }),
    );
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });
    const inboundSignal = signals.find(
      (signal) => signal.signalRef === "provider.baileys.inbound_message",
    );

    expect(inboundSignal).toMatchObject({
      kind: "inbound_message",
      targetRef: sessionId,
      dataClassification: "confidential",
      safeMetadata: {
        instanceId,
        sessionId,
        providerMessageRef: expect.stringMatching(/^provider_msg_[a-f0-9]{16}$/u),
        conversationRef: expect.stringMatching(/^conversation_[a-f0-9]{16}$/u),
        occurredAt: "2027-03-02T15:06:41.000Z",
        contentKind: "text",
        conversationKind: "private",
      },
    });
    expect(inboundSignal?.occurrenceRef).toContain(
      String(inboundSignal?.safeMetadata?.providerMessageRef),
    );
    expect(JSON.stringify(signals)).not.toContain(rawJid);
    expect(JSON.stringify(signals)).not.toContain(rawText);
    expect(JSON.stringify(signals)).not.toContain(rawProviderMessageId);
  });

  it("can capture inbound recipient JID only through an explicit local secret sink", async () => {
    const captured: BaileysInboundRecipientOperatorEvent[] = [];
    const sink: BaileysInboundRecipientOperatorSink = {
      captureInboundRecipient(event): void {
        captured.push(event);
      },
    };
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
      inboundRecipientOperatorSink: sink,
    });
    const rawJid = "12025550123@s.whatsapp.net";
    const rawText = "raw inbound recipient text secret";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.upsert",
      inboundUpsert({
        key: {
          id: "BAILEYS_INBOUND_RECIPIENT_MESSAGE_ID",
          remoteJid: rawJid,
          fromMe: false,
        },
        messageTimestamp: 1_804_000_001,
        message: {
          conversation: rawText,
        },
      }),
    );
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });

    expect(captured).toEqual([
      {
        instanceId,
        providerId,
        sessionId,
        conversationRef: expect.stringMatching(/^conversation_[a-f0-9]{16}$/u),
        conversationKind: "private",
        occurredAt: "2027-03-02T15:06:41.000Z",
        recipientJid: rawJid,
        dataClassification: "secret",
        localOnly: true,
      },
    ]);
    expect(JSON.stringify(signals)).not.toContain(rawJid);
    expect(JSON.stringify(signals)).not.toContain(rawText);
  });

  it("uses deterministic occurrence refs for duplicate inbound provider messages", async () => {
    const harness = createRealProviderHarness();
    const message = {
      key: {
        id: "BAILEYS_DUPLICATE_MESSAGE_ID",
        remoteJid: "12025550123@s.whatsapp.net",
        fromMe: false,
      },
      messageTimestamp: 1_804_000_001,
      message: {
        extendedTextMessage: {
          text: "raw duplicate inbound text",
        },
      },
    };

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("messages.upsert", inboundUpsert(message));
    harness.socket.ev.emit("messages.upsert", inboundUpsert(message));
    await flushAsyncSignals();

    const inboundSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "inbound_message");

    expect(inboundSignals).toHaveLength(2);
    expect(inboundSignals[0]?.occurrenceRef).toBe(inboundSignals[1]?.occurrenceRef);
    expect(inboundSignals[0]?.safeMetadata?.providerMessageRef).toBe(
      inboundSignals[1]?.safeMetadata?.providerMessageRef,
    );
    expect(JSON.stringify(inboundSignals)).not.toContain("BAILEYS_DUPLICATE_MESSAGE_ID");
    expect(JSON.stringify(inboundSignals)).not.toContain("raw duplicate inbound text");
  });

  it("normalizes group inbound metadata without exposing the group JID", async () => {
    const harness = createRealProviderHarness();
    const rawGroupJid = "12025550123-1111111111@g.us";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.upsert",
      inboundUpsert({
        key: {
          id: "BAILEYS_GROUP_MESSAGE_ID",
          remoteJid: rawGroupJid,
          fromMe: false,
        },
        messageTimestamp: 1_804_000_001,
        message: {
          imageMessage: {
            caption: "raw group image caption",
          },
        },
      }),
    );
    await flushAsyncSignals();

    const inboundSignal = harness.provider
      .drainSignals({ sessionId })
      .find((signal) => signal.kind === "inbound_message");

    expect(inboundSignal?.safeMetadata).toMatchObject({
      contentKind: "image",
      conversationKind: "group",
      conversationRef: expect.stringMatching(/^conversation_[a-f0-9]{16}$/u),
    });
    expect(JSON.stringify(inboundSignal)).not.toContain(rawGroupJid);
    expect(JSON.stringify(inboundSignal)).not.toContain("raw group image caption");
  });

  it("normalizes LID inbound metadata as private conversation without exposing the LID", async () => {
    const harness = createRealProviderHarness();
    const rawLid = "36232981651679:16@lid";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.upsert",
      inboundUpsert({
        key: {
          id: "BAILEYS_LID_MESSAGE_ID",
          remoteJid: rawLid,
          fromMe: false,
        },
        messageTimestamp: 1_804_000_001,
        message: {
          conversation: "raw LID inbound text",
        },
      }),
    );
    await flushAsyncSignals();

    const inboundSignal = harness.provider
      .drainSignals({ sessionId })
      .find((signal) => signal.kind === "inbound_message");

    expect(inboundSignal?.safeMetadata).toMatchObject({
      contentKind: "text",
      conversationKind: "private",
      conversationRef: expect.stringMatching(/^conversation_[a-f0-9]{16}$/u),
    });
    expect(JSON.stringify(inboundSignal)).not.toContain(rawLid);
    expect(JSON.stringify(inboundSignal)).not.toContain("raw LID inbound text");
    expect(JSON.stringify(inboundSignal)).not.toContain("BAILEYS_LID_MESSAGE_ID");
  });

  it("fails safe for unsupported or malformed inbound provider messages", async () => {
    const harness = createRealProviderHarness();
    const rawJid = "12025550123@s.whatsapp.net";
    const rawText = "raw unsupported inbound payload";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.upsert",
      inboundUpsert({
        key: {
          id: "BAILEYS_UNSUPPORTED_MESSAGE_ID",
          remoteJid: rawJid,
          fromMe: false,
        },
        message: {
          protocolMessage: {
            raw: rawText,
          } as never,
        },
      }),
    );
    harness.socket.ev.emit("messages.upsert", { messages: [{}], type: "notify" } as never);
    await flushAsyncSignals();

    const failureSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "failure");

    expect(failureSignals).toEqual([
      expect.objectContaining({
        signalRef: "provider.baileys.inbound_message_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "unsupported_inbound_message",
          providerMessageRef: expect.stringMatching(/^provider_msg_[a-f0-9]{16}$/u),
          conversationRef: expect.stringMatching(/^conversation_[a-f0-9]{16}$/u),
          contentKind: "unsupported",
          conversationKind: "private",
        }),
      }),
      expect.objectContaining({
        signalRef: "provider.baileys.inbound_message_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "malformed_inbound_message",
        }),
      }),
    ]);
    expect(JSON.stringify(failureSignals)).not.toContain(rawJid);
    expect(JSON.stringify(failureSignals)).not.toContain(rawText);
    expect(JSON.stringify(failureSignals)).not.toContain("BAILEYS_UNSUPPORTED_MESSAGE_ID");
  });

  it("maps messages.update delivery status into safe message_status signals", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
    });
    const rawProviderMessageId = "BAILEYS_STATUS_MESSAGE_ID_1";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.update",
      messageUpdates([
        statusUpdate(rawProviderMessageId, WAMessageStatus.DELIVERY_ACK, {
          messageTimestamp: 1_804_000_002,
        }),
      ]),
    );
    await flushAsyncSignals();

    const statusSignal = harness.provider
      .drainSignals({ sessionId })
      .find((signal) => signal.kind === "message_status");

    expect(statusSignal).toMatchObject({
      signalRef: "provider.baileys.message_delivered",
      targetRef: sessionId,
      dataClassification: "confidential",
      safeMetadata: {
        instanceId,
        sessionId,
        providerMessageRef: expect.stringMatching(/^provider_msg_[a-f0-9]{16}$/u),
        status: "delivered",
        occurredAt: "2027-03-02T15:06:42.000Z",
      },
    });
    expect(statusSignal?.occurrenceRef).toContain(
      String(statusSignal?.safeMetadata?.providerMessageRef),
    );
    expect(JSON.stringify(statusSignal)).not.toContain(rawProviderMessageId);
  });

  it("maps alternate Baileys status shapes into safe message_status signals", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.update",
      messageUpdates([
        topLevelStatusUpdate("BAILEYS_TOP_LEVEL_STATUS_ID", WAMessageStatus.DELIVERY_ACK, {
          messageTimestamp: 1_804_000_005,
        }),
        statusUpdate("BAILEYS_STRING_STATUS_ID", "READ", {
          messageTimestamp: 1_804_000_006,
        }),
      ]),
    );
    await flushAsyncSignals();

    const statusSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "message_status");

    expect(statusSignals.map((signal) => signal.safeMetadata?.status)).toEqual([
      "delivered",
      "read",
    ]);
    expect(statusSignals.map((signal) => signal.safeMetadata?.occurredAt)).toEqual([
      "2027-03-02T15:06:45.000Z",
      "2027-03-02T15:06:46.000Z",
    ]);
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_TOP_LEVEL_STATUS_ID");
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_STRING_STATUS_ID");
  });

  it("maps read and failed message statuses safely", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.update",
      messageUpdates([
        statusUpdate("BAILEYS_READ_MESSAGE_ID", WAMessageStatus.READ, {
          messageTimestamp: 1_804_000_003,
        }),
        statusUpdate("BAILEYS_FAILED_MESSAGE_ID", WAMessageStatus.ERROR, {
          messageTimestamp: 1_804_000_004,
          message: {
            conversation: "raw failed message text",
          },
        }),
      ]),
    );
    await flushAsyncSignals();

    const statusSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "message_status");

    expect(statusSignals.map((signal) => signal.safeMetadata?.status)).toEqual(["read", "failed"]);
    expect(statusSignals[0]).toMatchObject({
      signalRef: "provider.baileys.message_read",
      safeMetadata: {
        occurredAt: "2027-03-02T15:06:43.000Z",
      },
    });
    expect(statusSignals[1]).toMatchObject({
      signalRef: "provider.baileys.message_failed",
      safeMetadata: {
        occurredAt: "2027-03-02T15:06:44.000Z",
        failureReasonRef: expect.stringMatching(/^failure_reason_[a-f0-9]{16}$/u),
      },
    });
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_READ_MESSAGE_ID");
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_FAILED_MESSAGE_ID");
    expect(JSON.stringify(statusSignals)).not.toContain("raw failed message text");
  });

  it("uses deterministic occurrence refs for duplicate message status updates", async () => {
    const harness = createRealProviderHarness();
    const update = statusUpdate("BAILEYS_DUPLICATE_STATUS_ID", WAMessageStatus.SERVER_ACK);

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("messages.update", messageUpdates([update]));
    harness.socket.ev.emit("messages.update", messageUpdates([update]));
    await flushAsyncSignals();

    const statusSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "message_status");

    expect(statusSignals).toHaveLength(2);
    expect(statusSignals[0]?.occurrenceRef).toBe(statusSignals[1]?.occurrenceRef);
    expect(statusSignals[0]?.safeMetadata?.providerMessageRef).toBe(
      statusSignals[1]?.safeMetadata?.providerMessageRef,
    );
    expect(statusSignals[0]?.safeMetadata?.status).toBe("sent");
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_DUPLICATE_STATUS_ID");
  });

  it("ignores message content-only updates without leaking content as status failures", async () => {
    const harness = createRealProviderHarness();
    const rawProviderMessageId = "BAILEYS_CONTENT_ONLY_STATUS_ID";
    const rawText = "raw content-only update text";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.update",
      messageUpdates([
        {
          key: {
            id: rawProviderMessageId,
            remoteJid: "12025550123@s.whatsapp.net",
            fromMe: true,
          },
          update: {
            message: {
              conversation: rawText,
            },
          },
        } as WAMessageUpdate,
      ]),
    );
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });

    expect(signals.filter((signal) => signal.kind === "message_status")).toHaveLength(0);
    expect(signals.filter((signal) => signal.kind === "failure")).toHaveLength(0);
    expect(JSON.stringify(signals)).not.toContain(rawProviderMessageId);
    expect(JSON.stringify(signals)).not.toContain(rawText);
  });

  it("maps message-receipt.update delivered and read receipts safely", async () => {
    const harness = createRealProviderHarness({
      nowEpochMilliseconds: () => 1_804_000_000_000,
    });
    const rawParticipantJid = "12025550123@s.whatsapp.net";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "message-receipt.update",
      messageReceiptUpdates([
        receiptUpdate("BAILEYS_RECEIPT_DELIVERED_ID", {
          userJid: rawParticipantJid,
          receiptTimestamp: 1_804_000_007,
        }),
        receiptUpdate("BAILEYS_RECEIPT_READ_ID", {
          userJid: rawParticipantJid,
          readTimestamp: 1_804_000_008,
        }),
      ]),
    );
    await flushAsyncSignals();

    const statusSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "message_status");

    expect(statusSignals.map((signal) => signal.safeMetadata?.status)).toEqual([
      "delivered",
      "read",
    ]);
    expect(statusSignals.map((signal) => signal.safeMetadata?.occurredAt)).toEqual([
      "2027-03-02T15:06:47.000Z",
      "2027-03-02T15:06:48.000Z",
    ]);
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_RECEIPT_DELIVERED_ID");
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_RECEIPT_READ_ID");
    expect(JSON.stringify(statusSignals)).not.toContain(rawParticipantJid);
  });

  it("uses deterministic occurrence refs for duplicate message receipt updates", async () => {
    const harness = createRealProviderHarness();
    const update = receiptUpdate("BAILEYS_DUPLICATE_RECEIPT_ID", {
      receiptTimestamp: 1_804_000_009,
    });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("message-receipt.update", messageReceiptUpdates([update]));
    harness.socket.ev.emit("message-receipt.update", messageReceiptUpdates([update]));
    await flushAsyncSignals();

    const statusSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "message_status");

    expect(statusSignals).toHaveLength(2);
    expect(statusSignals[0]?.occurrenceRef).toBe(statusSignals[1]?.occurrenceRef);
    expect(statusSignals[0]?.safeMetadata?.providerMessageRef).toBe(
      statusSignals[1]?.safeMetadata?.providerMessageRef,
    );
    expect(statusSignals[0]?.safeMetadata?.status).toBe("delivered");
    expect(JSON.stringify(statusSignals)).not.toContain("BAILEYS_DUPLICATE_RECEIPT_ID");
  });

  it("fails safe for malformed or unsupported message receipt updates", async () => {
    const harness = createRealProviderHarness();
    const rawProviderMessageId = "BAILEYS_UNSUPPORTED_RECEIPT_ID";
    const rawParticipantJid = "12025550123@s.whatsapp.net";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "message-receipt.update",
      messageReceiptUpdates([
        receiptUpdate(rawProviderMessageId, { userJid: rawParticipantJid }),
        { key: {}, receipt: {} },
      ]),
    );
    await flushAsyncSignals();

    const failureSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "failure");

    expect(failureSignals).toEqual([
      expect.objectContaining({
        signalRef: "provider.baileys.message_status_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "unsupported_message_receipt_status",
          providerMessageRef: expect.stringMatching(/^provider_msg_[a-f0-9]{16}$/u),
        }),
      }),
      expect.objectContaining({
        signalRef: "provider.baileys.message_status_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "malformed_message_receipt_update",
        }),
      }),
    ]);
    expect(JSON.stringify(failureSignals)).not.toContain(rawProviderMessageId);
    expect(JSON.stringify(failureSignals)).not.toContain(rawParticipantJid);
  });

  it("fails safe for malformed or unsupported message status updates", async () => {
    const harness = createRealProviderHarness();
    const rawProviderMessageId = "BAILEYS_UNSUPPORTED_STATUS_ID";

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit(
      "messages.update",
      messageUpdates([
        statusUpdate(rawProviderMessageId, WAMessageStatus.PENDING),
        { key: {}, update: {} } as WAMessageUpdate,
      ]),
    );
    await flushAsyncSignals();

    const failureSignals = harness.provider
      .drainSignals({ sessionId })
      .filter((signal) => signal.kind === "failure");

    expect(failureSignals).toEqual([
      expect.objectContaining({
        signalRef: "provider.baileys.message_status_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "unsupported_message_status",
          providerMessageRef: expect.stringMatching(/^provider_msg_[a-f0-9]{16}$/u),
        }),
      }),
      expect.objectContaining({
        signalRef: "provider.baileys.message_status_unsupported",
        safeMetadata: expect.objectContaining({
          reasonCode: "malformed_message_status_update",
        }),
      }),
    ]);
    expect(JSON.stringify(failureSignals)).not.toContain(rawProviderMessageId);
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

  it("maps loggedOut to clear auth and a logged_out signal", async () => {
    const store = new RecordingAuthStateStore();
    const harness = createRealProviderHarness({ authStateStore: store });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", closeUpdate(DisconnectReason.loggedOut));
    await flushAsyncSignals();

    expect(store.clears).toEqual([sessionId]);
    expect(harness.provider.drainSignals({ sessionId }).map(signalSummary)).toEqual([
      {
        kind: "connection",
        signalRef: "provider.baileys.connecting",
        targetRef: sessionId,
        dataClassification: "internal",
      },
      {
        kind: "failure",
        signalRef: "provider.baileys.logged_out",
        targetRef: sessionId,
        dataClassification: "confidential",
      },
    ]);
  });

  it("maps connectionReplaced to surrender ownership without blind reconnect", async () => {
    const store = new RecordingAuthStateStore();
    const harness = createRealProviderHarness({ authStateStore: store });

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", closeUpdate(DisconnectReason.connectionReplaced));
    await flushAsyncSignals();

    expect(mapBaileysDisconnectReason(DisconnectReason.connectionReplaced)).toMatchObject({
      action: "surrender_ownership",
      signalCode: "connection_replaced",
      retryable: false,
      surrenderOwnership: true,
    });
    expect(store.clears).toEqual([]);
    expect(harness.provider.drainSignals({ sessionId }).map(signalSummary).at(-1)).toEqual({
      kind: "failure",
      signalRef: "provider.baileys.connection_replaced",
      targetRef: sessionId,
      dataClassification: "confidential",
    });
  });

  it("maps restartRequired to a reconnect decision with backoff", () => {
    expect(mapBaileysDisconnectReason(DisconnectReason.restartRequired)).toMatchObject({
      action: "reconnect",
      signalCode: "reconnecting",
      retryable: true,
      clearAuthState: false,
      surrenderOwnership: false,
      backoffMs: 1_000,
    });
  });

  it("maps closed, lost, and timed out disconnects to retryable reconnect decisions", () => {
    for (const statusCode of [
      DisconnectReason.connectionClosed,
      DisconnectReason.connectionLost,
      DisconnectReason.timedOut,
    ]) {
      expect(mapBaileysDisconnectReason(statusCode)).toMatchObject({
        action: "reconnect",
        signalCode: "reconnecting",
        retryable: true,
        backoffMs: 1_000,
      });
    }
  });

  it("maps badSession and multideviceMismatch to clear-auth no-retry decisions", async () => {
    for (const statusCode of [DisconnectReason.badSession, DisconnectReason.multideviceMismatch]) {
      expect(mapBaileysDisconnectReason(statusCode)).toMatchObject({
        action: "clear_auth_and_logged_out",
        signalCode: "logged_out",
        retryable: false,
        clearAuthState: true,
      });
    }

    const store = new RecordingAuthStateStore();
    const harness = createRealProviderHarness({ authStateStore: store });
    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", closeUpdate(DisconnectReason.badSession));
    await flushAsyncSignals();

    expect(store.clears).toEqual([sessionId]);
  });

  it("maps unknown close codes to safe retryable reconnect decisions", async () => {
    const harness = createRealProviderHarness();

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", closeUpdate(499));
    await flushAsyncSignals();

    expect(mapBaileysDisconnectReason(499)).toMatchObject({
      action: "unknown_retryable",
      signalCode: "reconnecting",
      retryable: true,
      backoffMs: 1_000,
    });
    expect(harness.provider.drainSignals({ sessionId }).map(signalSummary).at(-1)).toEqual({
      kind: "connection",
      signalRef: "provider.baileys.reconnecting",
      targetRef: sessionId,
      dataClassification: "internal",
    });
  });

  it("does not leak raw provider payloads from disconnect error DTOs or signals", async () => {
    const rawDisconnectPayload =
      "raw disconnect payload with auth-secret and 12025550123@s.whatsapp.net";
    const harness = createRealProviderHarness();

    await harness.provider.startSession(socketRequest(), context);
    harness.socket.ev.emit("connection.update", closeUpdate(499, rawDisconnectPayload));
    await flushAsyncSignals();

    const signals = harness.provider.drainSignals({ sessionId });

    expect(JSON.stringify(signals)).not.toContain(rawDisconnectPayload);
    expect(JSON.stringify(signals)).not.toContain("auth-secret");
    expect(JSON.stringify(signals)).not.toContain("12025550123");
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
    nowEpochMilliseconds?: () => number;
    qrChallengeTtlMs?: number;
    qrCodeOperatorSink?: BaileysQrCodeOperatorSink;
    inboundRecipientOperatorSink?: BaileysInboundRecipientOperatorSink;
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
    ...(options.nowEpochMilliseconds === undefined
      ? {}
      : { nowEpochMilliseconds: options.nowEpochMilliseconds }),
    ...(options.qrChallengeTtlMs === undefined
      ? {}
      : { qrChallengeTtlMs: options.qrChallengeTtlMs }),
    ...(options.qrCodeOperatorSink === undefined
      ? {}
      : { qrCodeOperatorSink: options.qrCodeOperatorSink }),
    ...(options.inboundRecipientOperatorSink === undefined
      ? {}
      : { inboundRecipientOperatorSink: options.inboundRecipientOperatorSink }),
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
  readonly clears = [] as (typeof sessionId)[];
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
    this.clears.push(requestedSessionId);
    return this.delegate.clear(requestedSessionId);
  }
}

function closeUpdate(
  statusCode: number,
  message = "raw disconnect payload with jid 12025550123@s.whatsapp.net",
): BaileysEventMap["connection.update"] {
  return {
    connection: "close",
    lastDisconnect: {
      error: Object.assign(new Error(message), {
        output: { statusCode },
      }),
      date: new Date("2026-07-03T00:00:00.000Z"),
    },
  };
}

function inboundUpsert(message: Partial<WAMessage>): BaileysEventMap["messages.upsert"] {
  return {
    messages: [message as WAMessage],
    type: "notify",
  } as BaileysEventMap["messages.upsert"];
}

function messageUpdates(updates: readonly WAMessageUpdate[]): BaileysEventMap["messages.update"] {
  return [...updates];
}

function messageReceiptUpdates(
  updates: readonly BaileysEventMap["message-receipt.update"][number][],
): BaileysEventMap["message-receipt.update"] {
  return [...updates];
}

function statusUpdate(
  providerMessageId: string,
  status: unknown,
  update: Partial<WAMessage> = {},
): WAMessageUpdate {
  return {
    key: {
      id: providerMessageId,
      remoteJid: "12025550123@s.whatsapp.net",
      fromMe: true,
    },
    update: {
      status,
      ...update,
    },
  } as WAMessageUpdate;
}

function topLevelStatusUpdate(
  providerMessageId: string,
  status: unknown,
  update: Partial<WAMessage> = {},
): WAMessageUpdate {
  return {
    key: {
      id: providerMessageId,
      remoteJid: "12025550123@s.whatsapp.net",
      fromMe: true,
    },
    status,
    ...update,
  } as unknown as WAMessageUpdate;
}

function receiptUpdate(
  providerMessageId: string,
  receipt: BaileysEventMap["message-receipt.update"][number]["receipt"],
): BaileysEventMap["message-receipt.update"][number] {
  return {
    key: {
      id: providerMessageId,
      remoteJid: "12025550123@g.us",
      fromMe: true,
    },
    receipt,
  };
}

async function flushAsyncSignals(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
