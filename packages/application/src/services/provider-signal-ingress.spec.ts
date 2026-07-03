import { createFailureCategory, createProviderId } from "@omniwa/domain";
import { createCorrelationId, createRequestContext, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import type { ApplicationPortContext, ApplicationPortResult } from "../ports/application-port.js";
import {
  createPlatformEventRecord,
  type EventLogCursorStatus,
  type EventLogPort,
  type EventLogReplayRequest,
  type EventLogReplayResult,
  type EventOutboxPublishResult,
  type EventOutboxRecord,
  type PlatformEventAppendInput,
  type PlatformEventRecord,
} from "../ports/event-log.js";
import type { TranslatedProviderSignal } from "../ports/messaging-provider.js";
import { createProviderSignalIngress } from "./provider-signal-ingress.js";

const timestamp = "2026-07-03T00:00:00.000Z";
const rawJid = "84999999999@s.whatsapp.net";
const rawText = "private inbound body";
const rawAuthState = "raw-auth-state-secret-token";
const context: ApplicationPortContext = Object.freeze({
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-signal-correlation"),
  }),
  actorRef: "provider-runtime:test",
  dataClassification: "internal",
});

describe("provider signal ingress", () => {
  it("ingests QR/auth signals into safe platform events", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });

    const result = await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.qr_required",
        occurrenceRef: "provider.baileys.session_1.qr_required",
        kind: "auth",
        dataClassification: "confidential",
      }),
      context,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.event : undefined).toMatchObject({
      type: "provider.auth.v1",
      timestamp,
      dataClassification: "confidential",
      source: "provider_runtime",
      resourceRef: "session_provider_signal_1",
      correlationId: "provider-signal-correlation",
      payload: {
        providerId: "provider.baileys",
        signalRef: "provider.baileys.qr_required",
        signalKind: "auth",
        targetRef: "session_provider_signal_1",
        occurrenceRef: "provider.baileys.session_1.qr_required",
        dataClassification: "confidential",
      },
    });
    expect(JSON.stringify(eventLog.records())).not.toContain(rawAuthState);
  });

  it("ingests connected and disconnected signals into safe platform events", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });

    await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.connected",
        occurrenceRef: "provider.baileys.session_1.connected",
        kind: "connection",
      }),
      context,
    );
    await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.disconnected",
        occurrenceRef: "provider.baileys.session_1.disconnected",
        kind: "connection",
      }),
      context,
    );

    expect(eventLog.records().map((event) => event.type)).toEqual([
      "provider.connection.v1",
      "provider.connection.v1",
    ]);
    expect(eventLog.records().map((event) => event.payload.signalRef)).toEqual([
      "provider.baileys.connected",
      "provider.baileys.disconnected",
    ]);
  });

  it("ingests message_status signals into safe platform events", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });

    const result = await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.message_delivered",
        targetRef: "msg_provider_signal_1",
        occurrenceRef: "provider.baileys.msg_1.delivered",
        kind: "message_status",
      }),
      context,
    );

    expect(result.ok ? result.value.event : undefined).toMatchObject({
      type: "provider.message_status.v1",
      resourceRef: "msg_provider_signal_1",
      payload: {
        signalKind: "message_status",
        signalRef: "provider.baileys.message_delivered",
        targetRef: "msg_provider_signal_1",
      },
    });
  });

  it("ingests inbound_message signals without leaking raw text or JID", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });

    const result = await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.inbound_message",
        targetRef: "inbound_message_safe_ref_1",
        occurrenceRef: "provider.baileys.inbound.safe_ref_1",
        kind: "inbound_message",
        dataClassification: "confidential",
      }),
      context,
    );

    expect(result.ok ? result.value.event : undefined).toMatchObject({
      type: "provider.inbound_message.v1",
      dataClassification: "confidential",
      resourceRef: "inbound_message_safe_ref_1",
      payload: {
        signalKind: "inbound_message",
        targetRef: "inbound_message_safe_ref_1",
      },
    });
    expect(JSON.stringify(eventLog.records())).not.toContain(rawJid);
    expect(JSON.stringify(eventLog.records())).not.toContain(rawText);
  });

  it("ingests failure signals into safe platform events", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });

    const result = await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.failure",
        occurrenceRef: "provider.baileys.session_1.failure",
        kind: "failure",
        dataClassification: "confidential",
        failureCategory: createFailureCategory("provider"),
      }),
      context,
    );

    expect(result.ok ? result.value.event : undefined).toMatchObject({
      type: "provider.failure.v1",
      payload: {
        signalKind: "failure",
        failureCategory: "provider",
      },
    });
  });

  it("does not append duplicate events for the same occurrenceRef", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });
    const signal = providerSignal({
      signalRef: "provider.baileys.connected",
      occurrenceRef: "provider.baileys.session_1.same_occurrence",
      kind: "connection",
    });

    const first = await ingress.ingestSignal(signal, context);
    const duplicate = await ingress.ingestSignal(signal, context);

    expect(first.ok).toBe(true);
    expect(duplicate.ok ? duplicate.value.event : undefined).toEqual(
      first.ok ? first.value.event : undefined,
    );
    expect(eventLog.appendAttempts).toBe(2);
    expect(eventLog.records()).toHaveLength(1);
  });

  it("creates deterministic event ids across ingress instances", async () => {
    const firstLog = new FakeEventLogPort();
    const secondLog = new FakeEventLogPort();
    const firstIngress = createProviderSignalIngress({
      eventLog: firstLog,
      nowIso: () => timestamp,
    });
    const secondIngress = createProviderSignalIngress({
      eventLog: secondLog,
      nowIso: () => timestamp,
    });
    const signal = providerSignal({
      signalRef: "provider.baileys.logged_out",
      occurrenceRef: "provider.baileys.session_1.logged_out",
      kind: "connection",
    });

    const first = await firstIngress.ingestSignal(signal, context);
    const second = await secondIngress.ingestSignal(signal, context);

    expect(first.ok ? first.value.event.id : undefined).toBe(
      second.ok ? second.value.event.id : undefined,
    );
    expect(first.ok ? first.value.event.id : undefined).toMatch(/^provider_signal:/u);
  });

  it("fails safe for unsupported or corrupt provider signals", async () => {
    const eventLog = new FakeEventLogPort();
    const ingress = createProviderSignalIngress({
      eventLog,
      nowIso: () => timestamp,
    });
    const corruptSignal = {
      ...providerSignal({
        signalRef: `provider.baileys.${rawJid}.${rawText}`,
        occurrenceRef: "provider.baileys.session_1.corrupt",
        kind: "connection",
      }),
      kind: "native_payload",
      targetRef: rawJid,
    } as unknown as TranslatedProviderSignal;

    const result = await ingress.ingestSignal(corruptSignal, context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "provider_signal_kind_unsupported",
      ownerContext: "provider_integration",
      failureCategory: "provider",
    });
    expect(eventLog.records()).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(rawJid);
    expect(JSON.stringify(result)).not.toContain(rawText);
    expect(JSON.stringify(result)).not.toContain(rawAuthState);

    const corruptRef = await ingress.ingestSignal(
      providerSignal({
        signalRef: "provider.baileys.inbound_message",
        targetRef: rawJid,
        occurrenceRef: "provider.baileys.session_1.corrupt_ref",
        kind: "inbound_message",
      }),
      context,
    );

    expect(corruptRef.ok).toBe(false);
    expect(corruptRef.ok ? undefined : corruptRef.error).toMatchObject({
      code: "provider_signal_ref_invalid",
      safeMetadata: {
        fieldName: "targetRef",
        signalKind: "inbound_message",
      },
    });
    expect(JSON.stringify(corruptRef)).not.toContain(rawJid);
    expect(JSON.stringify(corruptRef)).not.toContain(rawText);
  });
});

function providerSignal(
  overrides: Partial<TranslatedProviderSignal> = {},
): TranslatedProviderSignal {
  return Object.freeze({
    signalRef: "provider.baileys.connected",
    providerId: createProviderId("provider.baileys"),
    targetRef: "session_provider_signal_1",
    occurrenceRef: "provider.baileys.session_1.connected",
    kind: "connection",
    dataClassification: "internal",
    ...overrides,
  });
}

class FakeEventLogPort implements EventLogPort {
  appendAttempts = 0;
  private readonly events = new Map<string, PlatformEventRecord>();

  appendEvent(input: PlatformEventAppendInput): ApplicationPortResult<PlatformEventRecord> {
    this.appendAttempts += 1;
    const existing = this.events.get(input.id);

    if (existing !== undefined) {
      return ok(existing);
    }

    const event = createPlatformEventRecord({
      ...input,
      cursor: `eventlog:${this.events.size + 1}`,
      version: "v1",
      payload: input.payload ?? {},
    });
    this.events.set(event.id, event);

    return ok(event);
  }

  replayEvents(request: EventLogReplayRequest): ApplicationPortResult<EventLogReplayResult> {
    const events = this.records().slice(0, request.limit);
    const cursorStatus: EventLogCursorStatus = request.cursor === undefined ? "no_cursor" : "ok";
    const oldestCursor = events[0]?.cursor;
    const latestCursor = events.at(-1)?.cursor;

    return ok({
      events,
      cursorStatus,
      ...(oldestCursor === undefined ? {} : { oldestCursor }),
      ...(latestCursor === undefined ? {} : { latestCursor }),
    });
  }

  listOutbox(): ApplicationPortResult<readonly EventOutboxRecord[]> {
    return ok([]);
  }

  markOutboxPublished(
    eventId: string,
    publishedAt: string,
  ): ApplicationPortResult<EventOutboxPublishResult> {
    void publishedAt;

    return ok({
      eventId,
      cursor: this.events.get(eventId)?.cursor ?? "eventlog:missing",
      status: "published",
    });
  }

  records(): readonly PlatformEventRecord[] {
    return Object.freeze([...this.events.values()]);
  }
}
