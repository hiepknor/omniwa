import {
  createPlatformEventRecord,
  createProviderSignalIngress,
  type ApplicationPortContext,
  type ApplicationPortResult,
  type EventLogCursorStatus,
  type EventLogPort,
  type EventLogReplayRequest,
  type EventLogReplayResult,
  type EventOutboxPublishResult,
  type EventOutboxRecord,
  type PlatformEventAppendInput,
  type PlatformEventRecord,
  type TranslatedProviderSignal,
} from "@omniwa/application";
import {
  FakeBaileysSocket,
  FakeBaileysSocketProvider,
  type BaileysSocketRequest,
} from "@omniwa/infrastructure-provider-baileys";
import { createInstanceId, createProviderId, createSessionId } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  InMemoryProviderRuntimeSupervisorOwnershipGuard,
  ProviderRuntimeSupervisor,
} from "./provider-runtime-supervisor.js";

const timestamp = "2026-07-03T00:00:00.000Z";
const instanceId = createInstanceId("provider-supervisor-instance");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("provider-supervisor-session");
const rawQr = "raw-provider-qr-secret-token";
const rawJid = "84999999999@s.whatsapp.net";
const rawText = "private message body";
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-supervisor-correlation"),
    requestId: createRequestId("provider-supervisor-request"),
  }),
  actorRef: "provider-runtime-supervisor-test",
  dataClassification: "internal",
};

describe("ProviderRuntimeSupervisor", () => {
  it("transitions startSession from CREATED to STARTING", async () => {
    const { supervisor } = createSupervisorHarness();

    const started = await supervisor.startSession(startInput(), context);

    expect(started.ok).toBe(true);
    expect(started.ok ? started.value.state : undefined).toBe("STARTING");
    expect(started.ok ? started.value.transitions : undefined).toEqual(["CREATED", "STARTING"]);
    expect(supervisor.snapshot().sessions).toEqual([
      expect.objectContaining({
        instanceId,
        providerId,
        sessionId,
        state: "STARTING",
      }),
    ]);
  });

  it("moves QR_REQUIRED when QR signal is drained through SignalIngress", async () => {
    const { supervisor, socketProvider, eventLog } = createSupervisorHarness();

    await supervisor.startSession(startInput(), context);
    socketProvider.emitQrRequired(socketRequest(), context, {
      qr: rawQr,
      jid: rawJid,
      text: rawText,
    });

    const tick = await supervisor.tick(context);

    expect(tick.ok).toBe(true);
    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "QR_REQUIRED",
      lastSignalRef: "provider.baileys.qr_required",
    });
    expect(eventLog.records().map((event) => event.type)).toContain("provider.auth.v1");
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(rawQr);
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(rawJid);
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(
      rawText,
    );
  });

  it("moves CONNECTED when connected signal is drained through SignalIngress", async () => {
    const { supervisor, socketProvider, eventLog } = createSupervisorHarness();

    await supervisor.startSession(startInput(), context);
    socketProvider.emitConnected(socketRequest(), context);

    const tick = await supervisor.tick(context);

    expect(tick.ok).toBe(true);
    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "CONNECTED",
      lastSignalRef: "provider.baileys.connected",
    });
    expect(eventLog.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider.connection.v1",
          payload: expect.objectContaining({
            signalRef: "provider.baileys.connected",
          }),
        }),
      ]),
    );
  });

  it("drains inbound message signals into EventLog without raw message identifiers or text", async () => {
    const socketProvider = new QueuedSignalSocketProvider();
    const { supervisor, eventLog } = createSupervisorHarness({ socketProvider });
    const rawProviderMessageId = "BAILEYS_RAW_INBOUND_MESSAGE_ID";

    await supervisor.startSession(startInput(), context);
    socketProvider.enqueueSignal(
      providerSignal({
        signalRef: "provider.baileys.inbound_message",
        occurrenceRef:
          "provider.baileys.provider_supervisor_session.inbound.provider_msg_0123456789abcdef",
        kind: "inbound_message",
        dataClassification: "confidential",
        safeMetadata: {
          instanceId: "provider_supervisor_instance",
          sessionId: "provider_supervisor_session",
          providerMessageRef: "provider_msg_0123456789abcdef",
          conversationRef: "conversation_fedcba9876543210",
          occurredAt: "2026-07-03T00:00:00.000Z",
          contentKind: "text",
          conversationKind: "private",
        },
      }),
    );

    const tick = await supervisor.tick(context);

    expect(tick.ok).toBe(true);
    expect(eventLog.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider.inbound_message.v1",
          dataClassification: "confidential",
          payload: expect.objectContaining({
            signalRef: "provider.baileys.inbound_message",
            signalKind: "inbound_message",
            providerMessageRef: "provider_msg_0123456789abcdef",
            conversationRef: "conversation_fedcba9876543210",
            contentKind: "text",
          }),
        }),
      ]),
    );
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(rawJid);
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(
      rawText,
    );
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(
      rawProviderMessageId,
    );
  });

  it("drains message status signals into EventLog without raw provider message ids", async () => {
    const socketProvider = new QueuedSignalSocketProvider();
    const { supervisor, eventLog } = createSupervisorHarness({ socketProvider });
    const rawProviderMessageId = "BAILEYS_RAW_STATUS_MESSAGE_ID";

    await supervisor.startSession(startInput(), context);
    socketProvider.enqueueSignal(
      providerSignal({
        signalRef: "provider.baileys.message_delivered",
        occurrenceRef:
          "provider.baileys.provider_supervisor_session.message_status.provider_msg_89abcdef01234567.delivered",
        kind: "message_status",
        dataClassification: "confidential",
        safeMetadata: {
          instanceId: "provider_supervisor_instance",
          sessionId: "provider_supervisor_session",
          providerMessageRef: "provider_msg_89abcdef01234567",
          status: "delivered",
          occurredAt: "2026-07-03T00:00:00.000Z",
        },
      }),
    );

    const tick = await supervisor.tick(context);

    expect(tick.ok).toBe(true);
    expect(eventLog.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider.message_status.v1",
          dataClassification: "confidential",
          payload: expect.objectContaining({
            signalRef: "provider.baileys.message_delivered",
            signalKind: "message_status",
            providerMessageRef: "provider_msg_89abcdef01234567",
            status: "delivered",
          }),
        }),
      ]),
    );
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(
      rawProviderMessageId,
    );
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(rawJid);
    expect(JSON.stringify([tick, eventLog.records(), supervisor.snapshot()])).not.toContain(
      rawText,
    );
  });

  it("moves DISCONNECTED and LOGGED_OUT for disconnect and failure signals", async () => {
    const socketProvider = new QueuedSignalSocketProvider();
    const { supervisor, eventLog } = createSupervisorHarness({ socketProvider });

    await supervisor.startSession(startInput(), context);
    socketProvider.emitDisconnected(socketRequest(), context);
    await supervisor.tick(context);

    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "DISCONNECTED",
      lastSignalRef: "provider.baileys.disconnected",
    });

    socketProvider.enqueueSignal(
      providerSignal({
        signalRef: "provider.baileys.logged_out",
        occurrenceRef: "provider.baileys.provider_supervisor_session.logged_out",
        kind: "failure",
        dataClassification: "confidential",
      }),
    );
    await supervisor.tick(context);

    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "LOGGED_OUT",
      lastSignalRef: "provider.baileys.logged_out",
    });
    expect(eventLog.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "provider.failure.v1",
          payload: expect.objectContaining({
            signalRef: "provider.baileys.logged_out",
            signalKind: "failure",
          }),
        }),
      ]),
    );
  });

  it("moves RECONNECTING for reconnect signals and surrenders ownership on connection replacement", async () => {
    const guard = new InMemoryProviderRuntimeSupervisorOwnershipGuard();
    const socketProvider = new QueuedSignalSocketProvider();
    const { supervisor } = createSupervisorHarness({ socketProvider, ownershipGuard: guard });

    await supervisor.startSession(startInput(), context);
    socketProvider.enqueueSignal(
      providerSignal({
        signalRef: "provider.baileys.reconnecting",
        occurrenceRef: "provider.baileys.provider_supervisor_session.reconnecting",
        kind: "connection",
        dataClassification: "internal",
      }),
    );
    await supervisor.tick(context);

    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "RECONNECTING",
      lastSignalRef: "provider.baileys.reconnecting",
    });
    expect(guard.currentOwner(startInput())).toBe("provider-supervisor-owner");

    socketProvider.enqueueSignal(
      providerSignal({
        signalRef: "provider.baileys.connection_replaced",
        occurrenceRef: "provider.baileys.provider_supervisor_session.connection_replaced",
        kind: "failure",
        dataClassification: "confidential",
      }),
    );
    await supervisor.tick(context);

    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "DISCONNECTED",
      lastSignalRef: "provider.baileys.connection_replaced",
      failure: {
        code: "provider_signal_connection_replaced",
        retryable: false,
      },
    });
    expect(guard.currentOwner(startInput())).toBeUndefined();
  });

  it("transitions stopSession to DESTROYED and closes the socket", async () => {
    const socketProvider = new FakeBaileysSocketProvider();
    const socket = new FakeBaileysSocket();
    socketProvider.registerSocket(socketRequest(), socket);
    const { supervisor } = createSupervisorHarness({ socketProvider });

    await supervisor.startSession(startInput(), context);
    const stopped = await supervisor.stopSession(stopInput(), context);

    expect(stopped.ok).toBe(true);
    expect(stopped.ok ? stopped.value.state : undefined).toBe("DESTROYED");
    expect(socket.logoutCalled).toBe(true);
  });

  it("blocks duplicate ownership for the same instance/session", async () => {
    const guard = new InMemoryProviderRuntimeSupervisorOwnershipGuard();
    const first = createSupervisorHarness({
      ownershipGuard: guard,
      ownerRef: "provider-supervisor-a",
    });
    const second = createSupervisorHarness({
      ownershipGuard: guard,
      ownerRef: "provider-supervisor-b",
    });

    await first.supervisor.startSession(startInput(), context);
    const duplicate = await second.supervisor.startSession(startInput(), context);

    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok ? undefined : duplicate.error).toMatchObject({
      code: "provider_runtime_supervisor_session_already_active",
      safeMetadata: {
        source: "runtime",
      },
    });
    expect(second.supervisor.snapshot().sessions).toEqual([]);
    expect(guard.currentOwner(startInput())).toBe("provider-supervisor-a");
  });

  it("does not create duplicate events when tick drains the same signal twice", async () => {
    const signal = providerSignal({
      signalRef: "provider.baileys.connected",
      occurrenceRef: "provider.baileys.provider_supervisor_session.same_occurrence",
      kind: "connection",
    });
    const socketProvider = new DuplicateSignalSocketProvider(signal);
    const { supervisor, eventLog } = createSupervisorHarness({ socketProvider });

    await supervisor.startSession(startInput(), context);
    const tick = await supervisor.tick(context);

    expect(tick.ok).toBe(true);
    expect(eventLog.appendAttempts).toBe(2);
    expect(eventLog.records()).toHaveLength(1);
    expect(supervisor.snapshot().sessions[0]).toMatchObject({
      state: "CONNECTED",
    });
  });

  it("does not leak raw provider payloads through supervisor state, events, or errors", async () => {
    const { supervisor, socketProvider, eventLog } = createSupervisorHarness();

    await supervisor.startSession(startInput(), context);
    socketProvider.emitQrRequired(socketRequest(), context, {
      qr: rawQr,
      jid: rawJid,
      text: rawText,
    });
    await supervisor.tick(context);

    const serialized = JSON.stringify([supervisor.snapshot(), eventLog.records()]);

    expect(serialized).not.toContain(rawQr);
    expect(serialized).not.toContain(rawJid);
    expect(serialized).not.toContain(rawText);
  });
});

function createSupervisorHarness(
  options: Readonly<{
    socketProvider?: FakeBaileysSocketProvider;
    ownershipGuard?: InMemoryProviderRuntimeSupervisorOwnershipGuard;
    ownerRef?: string;
  }> = {},
): Readonly<{
  supervisor: ProviderRuntimeSupervisor;
  socketProvider: FakeBaileysSocketProvider;
  eventLog: FakeEventLogPort;
}> {
  const socketProvider = options.socketProvider ?? new FakeBaileysSocketProvider();
  const eventLog = new FakeEventLogPort();
  const signalIngress = createProviderSignalIngress({
    eventLog,
    nowIso: () => timestamp,
  });
  const supervisor = new ProviderRuntimeSupervisor({
    socketProvider,
    signalIngress,
    ownershipGuard: options.ownershipGuard ?? new InMemoryProviderRuntimeSupervisorOwnershipGuard(),
    ownerRef: options.ownerRef ?? "provider-supervisor-owner",
  });

  return {
    supervisor,
    socketProvider,
    eventLog,
  };
}

function startInput() {
  return {
    instanceId,
    providerId,
    sessionId,
    reasonCode: "provider_supervisor_start",
  };
}

function stopInput() {
  return {
    instanceId,
    providerId,
    sessionId,
    reasonCode: "provider_supervisor_stop",
  };
}

function socketRequest(): BaileysSocketRequest {
  return startInput();
}

function providerSignal(
  overrides: Partial<TranslatedProviderSignal> = {},
): TranslatedProviderSignal {
  return Object.freeze({
    signalRef: "provider.baileys.connected",
    providerId,
    targetRef: String(sessionId),
    occurrenceRef: "provider.baileys.provider_supervisor_session.connected",
    kind: "connection",
    dataClassification: "internal",
    ...overrides,
  });
}

class DuplicateSignalSocketProvider extends FakeBaileysSocketProvider {
  private readonly signal: TranslatedProviderSignal;

  constructor(signal: TranslatedProviderSignal) {
    super();
    this.signal = signal;
  }

  override drainSignals(): readonly TranslatedProviderSignal[] {
    return Object.freeze([this.signal, this.signal]);
  }
}

class QueuedSignalSocketProvider extends FakeBaileysSocketProvider {
  private readonly queuedSignals: TranslatedProviderSignal[] = [];

  enqueueSignal(signal: TranslatedProviderSignal): void {
    this.queuedSignals.push(signal);
  }

  override drainSignals(
    ...args: Parameters<FakeBaileysSocketProvider["drainSignals"]>
  ): readonly TranslatedProviderSignal[] {
    const drained = super.drainSignals(...args);
    const queued = [...this.queuedSignals];
    this.queuedSignals.length = 0;

    return Object.freeze([...drained, ...queued]);
  }
}

class FakeEventLogPort implements EventLogPort {
  appendAttempts = 0;
  private readonly recordsById = new Map<string, PlatformEventRecord>();
  private readonly outboxByEventId = new Map<string, EventOutboxRecord>();

  appendEvent(input: PlatformEventAppendInput): ApplicationPortResult<PlatformEventRecord> {
    this.appendAttempts += 1;

    const existing = this.recordsById.get(input.id);
    if (existing !== undefined) {
      return ok(existing);
    }

    const cursor = `eventlog:${this.recordsById.size + 1}`;
    const record = createPlatformEventRecord({
      id: input.id,
      cursor,
      type: input.type,
      version: "v1",
      timestamp: input.timestamp,
      dataClassification: input.dataClassification,
      source: input.source,
      payload: input.payload ?? {},
      ...optional("resourceRef", input.resourceRef),
      ...optional("correlationId", input.correlationId),
    });
    this.recordsById.set(record.id, record);
    this.outboxByEventId.set(
      record.id,
      Object.freeze({
        outboxId: `outbox:${record.id}`,
        eventId: record.id,
        cursor,
        status: "pending",
        createdAt: record.timestamp,
      }),
    );

    return ok(record);
  }

  replayEvents(request: EventLogReplayRequest): ApplicationPortResult<EventLogReplayResult> {
    const records = this.records();
    const startIndex =
      request.cursor === undefined
        ? 0
        : records.findIndex((record) => record.cursor === request.cursor) + 1;
    const cursorStatus: EventLogCursorStatus =
      request.cursor === undefined ? "no_cursor" : startIndex > 0 ? "ok" : "not_found";

    return ok(
      Object.freeze({
        events: Object.freeze(records.slice(Math.max(startIndex, 0), request.limit)),
        cursorStatus,
        ...optional("oldestCursor", records[0]?.cursor),
        ...optional("latestCursor", records.at(-1)?.cursor),
      }),
    );
  }

  listOutbox(): ApplicationPortResult<readonly EventOutboxRecord[]> {
    return ok(Object.freeze([...this.outboxByEventId.values()]));
  }

  markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): ApplicationPortResult<EventOutboxPublishResult> {
    const existing = this.outboxByEventId.get(eventId);

    if (existing !== undefined) {
      this.outboxByEventId.set(
        eventId,
        Object.freeze({
          ...existing,
          status: "published",
          publishedAt,
        }),
      );
    }

    return ok(
      Object.freeze({
        eventId,
        cursor: existing?.cursor ?? "eventlog:missing",
        status: "published",
      }),
    );
  }

  records(): readonly PlatformEventRecord[] {
    return Object.freeze([...this.recordsById.values()]);
  }
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
