import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProviderId, createSessionId } from "@omniwa/domain";
import {
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
} from "@omniwa/infrastructure-provider-baileys";
import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalVerticalSliceDemoComposition,
  createLocalVerticalSliceDemoContext,
} from "./local-vertical-slice-demo.js";

const temporaryDirectories: string[] = [];
const rawQrPayload = "raw-local-demo-qr-secret";
const rawRecipient = "12025550188@s.whatsapp.net";
const rawText = "private local demo worker text";
const rawAuthPayload = "raw-local-demo-auth-state";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local vertical slice demo composition", () => {
  it("shares queue, intent store, EventLog, socket provider, and durable state directory", () => {
    const stateDirectory = createTemporaryDirectory();
    const composition = createLocalVerticalSliceDemoComposition({ stateDirectory });

    expect(composition.mode).toBe("local-single-process-demo");
    expect(composition.paths.stateDirectory).toBe(stateDirectory);
    expect(composition.paths.eventLogPath).toBe(join(stateDirectory, "event-log.json"));
    expect(composition.paths.outboundIntentPath).toBe(
      join(stateDirectory, "outbound-message-intents.json"),
    );
    expect(composition.paths.authStatePath).toBe(
      join(stateDirectory, "provider-runtime", "baileys-auth-state.json"),
    );
    expect(composition.queueProvider.snapshot()).toEqual([]);
    expect(composition.fakeSocket.sentMessages).toEqual([]);
    expect(composition.replayEvents()).toEqual([]);

    composition.shutdown();
  });

  it("routes QR and connected provider signals through SignalIngress into EventLog", async () => {
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });
    const prepared = await composition.prepareConnectedSession(
      {
        runRef: "qr_connected",
        rawQrPayload,
      },
      createLocalVerticalSliceDemoContext("qr_connected"),
    );
    const events = composition.replayEvents();
    const serializedEvents = JSON.stringify(events);

    expect(prepared.supervisorState).toBe("CONNECTED");
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["provider.auth.v1", "provider.connection.v1"]),
    );
    expect(serializedEvents).not.toContain(rawQrPayload);

    composition.shutdown();
  });

  it("queues SendTextMessage work before worker dispatch", async () => {
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
    });
    const prepared = await composition.prepareConnectedSession({ runRef: "queue_send" });
    const queued = await composition.sendTextMessage({
      instanceId: prepared.instanceId,
      recipientRef: rawRecipient,
      text: rawText,
      runRef: "queue_send",
    });
    const queueSnapshot = composition.queueProvider.snapshot();

    expect(queued.outcome).toMatchObject({
      outcome: "queued",
      accepted: true,
      retryable: false,
    });
    expect(queueSnapshot).toEqual([
      expect.objectContaining({
        workType: "outbound_message",
        ownerRef: String(queued.messageId),
        state: "available",
        safeInputRef: queued.outboundIntentRef,
      }),
    ]);
    expect(
      JSON.stringify({ queued, queueSnapshot, events: composition.replayEvents() }),
    ).not.toContain(rawRecipient);
    expect(
      JSON.stringify({ queued, queueSnapshot, events: composition.replayEvents() }),
    ).not.toContain(rawText);

    composition.shutdown();
  });

  it("dispatches queued outbound work through the shared fake socket and marks the message sent", async () => {
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
    });
    const prepared = await composition.prepareConnectedSession({ runRef: "worker_dispatch" });
    const queued = await composition.sendTextMessage({
      instanceId: prepared.instanceId,
      recipientRef: rawRecipient,
      text: rawText,
      runRef: "worker_dispatch",
    });

    const worker = await composition.runWorkerOnce(
      createLocalVerticalSliceDemoContext("worker_dispatch"),
    );
    const message = await composition.repositories.messageRepository.load(queued.messageId);

    expect(worker.completed).toBe(1);
    expect(worker.deadLettered).toBe(0);
    expect(composition.fakeSocket.sentMessages).toHaveLength(1);
    expect(message?.status).toBe("sent");
    expect(JSON.stringify({ worker, message, events: composition.replayEvents() })).not.toContain(
      rawRecipient,
    );
    expect(JSON.stringify({ worker, message, events: composition.replayEvents() })).not.toContain(
      rawText,
    );

    composition.shutdown();
  });

  it("supports local live send orchestration after an external provider connection is active", async () => {
    const socketProvider = new FakeBaileysSocketProvider();
    const socket = new FakeBaileysSocket();
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
      socketProvider,
      fakeSocket: socket,
    });
    const prepared = await composition.prepareActiveSessionState({
      runRef: "local_live_send",
    });

    socketProvider.registerSocket(
      {
        instanceId: prepared.instanceId,
        providerId: createProviderId("baileys"),
        sessionId: prepared.sessionId,
        reasonCode: "local_live_send_test",
      },
      socket,
    );

    const queued = await composition.sendTextMessage({
      instanceId: prepared.instanceId,
      recipientRef: rawRecipient,
      text: rawText,
      runRef: "local_live_send",
    });
    const worker = await composition.runWorkerOnce(
      createLocalVerticalSliceDemoContext("local_live_send"),
    );
    const message = await composition.repositories.messageRepository.load(queued.messageId);

    expect(prepared.supervisorState).toBe("EXTERNALLY_CONNECTED");
    expect(worker.completed).toBe(1);
    expect(worker.deadLettered).toBe(0);
    expect(socket.sentMessages).toEqual([
      {
        jid: rawRecipient,
        content: {
          text: rawText,
        },
        options: undefined,
      },
    ]);
    expect(message?.status).toBe("sent");
    expect(
      JSON.stringify({ prepared, queued, worker, message, events: composition.replayEvents() }),
    ).not.toContain(rawRecipient);
    expect(
      JSON.stringify({ prepared, queued, worker, message, events: composition.replayEvents() }),
    ).not.toContain(rawText);

    composition.shutdown();
  });

  it("keeps local live send fail-safe when the shared provider socket is missing", async () => {
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
      socketProvider: new FakeBaileysSocketProvider(),
    });
    const prepared = await composition.prepareActiveSessionState({
      runRef: "local_live_missing_socket",
    });
    const queued = await composition.sendTextMessage({
      instanceId: prepared.instanceId,
      recipientRef: rawRecipient,
      text: rawText,
      runRef: "local_live_missing_socket",
    });

    const worker = await composition.runWorkerOnce(
      createLocalVerticalSliceDemoContext("local_live_missing_socket"),
    );
    const message = await composition.repositories.messageRepository.load(queued.messageId);

    expect(worker.completed).toBe(0);
    expect(worker.deadLettered).toBe(1);
    expect(message).toMatchObject({
      status: "failed",
      failureCategory: "provider",
    });
    expect(JSON.stringify({ worker, message, events: composition.replayEvents() })).not.toContain(
      rawRecipient,
    );
    expect(JSON.stringify({ worker, message, events: composition.replayEvents() })).not.toContain(
      rawText,
    );

    composition.shutdown();
  });

  it("runs the full local-only vertical slice without leaking raw QR, JID, or text", async () => {
    const composition = createLocalVerticalSliceDemoComposition({
      stateDirectory: createTemporaryDirectory(),
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });

    const result = await composition.runVerticalSlice({
      runRef: "full_slice",
      rawQrPayload,
      recipientRef: rawRecipient,
      text: rawText,
    });
    const serialized = JSON.stringify({
      result,
      events: composition.replayEvents(),
    });

    expect(result).toMatchObject({
      mode: "local-single-process-demo",
      providerSendCount: 1,
      messageStatus: "sent",
      worker: {
        completed: 1,
        deadLettered: 0,
      },
      sendOutcome: {
        outcome: "queued",
        accepted: true,
      },
    });
    expect(result.eventTypes).toEqual(
      expect.arrayContaining(["provider.auth.v1", "provider.connection.v1"]),
    );
    expect(serialized).not.toContain(rawQrPayload);
    expect(serialized).not.toContain(rawRecipient);
    expect(serialized).not.toContain(rawText);

    composition.shutdown();
  });

  it("keeps durable EventLog and auth state across local demo restarts", async () => {
    const stateDirectory = createTemporaryDirectory();
    const sessionId = createSessionId("local_demo_restart_session");
    const first = createLocalVerticalSliceDemoComposition({
      stateDirectory,
      nowIso: () => "2026-07-03T00:00:00.000Z",
    });

    await first.authStateStore.save(sessionId, {
      creds: rawAuthPayload,
    });
    await first.prepareConnectedSession({
      runRef: "restart",
      rawQrPayload,
    });
    first.shutdown();

    const restarted = createLocalVerticalSliceDemoComposition({ stateDirectory });
    const loadedAuth = await restarted.authStateStore.load(sessionId);
    const restartedEvents = restarted.replayEvents();

    expect(loadedAuth.ok ? loadedAuth.value?.revision : undefined).toBe(1);
    expect(loadedAuth.ok ? loadedAuth.value?.dataClassification : undefined).toBe("secret");
    expect(restartedEvents.map((event) => event.type)).toContain("provider.auth.v1");
    expect(JSON.stringify({ loadedAuth, restartedEvents })).not.toContain(rawAuthPayload);
    expect(JSON.stringify(restartedEvents)).not.toContain(rawQrPayload);

    restarted.shutdown();
  });
});

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omniwa-local-demo-"));
  temporaryDirectories.push(directory);

  return directory;
}
