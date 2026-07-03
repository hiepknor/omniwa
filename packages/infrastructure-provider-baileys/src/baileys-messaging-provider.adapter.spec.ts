import {
  createInstanceId,
  createMessageId,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  BaileysMessagingProviderAdapter,
  BaileysProviderError,
  BaileysSocketGateway,
  createTranslatedBaileysSignal,
  type BaileysResolvedOutboundMessage,
} from "./baileys-messaging-provider.adapter.js";
import { FakeBaileysSocket, FakeBaileysSocketProvider } from "./baileys-socket-provider.js";

const instanceId = createInstanceId("instance_provider_1");
const providerId = createProviderId("provider.baileys");
const sessionId = createSessionId("session_provider_1");
const messageId = createMessageId("message_provider_1");
const context = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("provider-correlation"),
    requestId: createRequestId("provider-request"),
  }),
  actorRef: "worker.provider_runtime",
  dataClassification: "internal" as const,
};

describe("BaileysMessagingProviderAdapter", () => {
  it("sends outbound messages through a Baileys socket and returns sanitized provider result", async () => {
    const socket = createFakeSocket();
    const adapter = createAdapter({
      socket,
      outboundMessage: {
        jid: "synthetic-omniwa@s.whatsapp.net",
        content: { text: "hello from omniwa adapter" },
      },
    });

    const result = await adapter.sendOutboundMessage(
      {
        instanceId,
        providerId,
        sessionId,
        messageId,
        messageType: "text",
        outboundIntentRef: "intent_1",
        idempotencyKey: "provider-send-1",
      },
      context,
    );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value).toEqual({
      messageId,
      status: "accepted",
      providerReceiptRef: "baileys-receipt-1",
      retryable: false,
    });
    expect(socket.sentMessages).toEqual([
      {
        jid: "synthetic-omniwa@s.whatsapp.net",
        content: { text: "hello from omniwa adapter" },
        options: undefined,
      },
    ]);
  });

  it("maps connection, QR pairing, and disconnect operations behind MessagingProvider", async () => {
    const socket = createFakeSocket();
    const adapter = createAdapter({ socket });

    const connection = await adapter.requestConnection(
      {
        instanceId,
        providerId,
        sessionId,
        intent: "connect",
        reasonCode: "operator_connect",
      },
      context,
    );
    const qr = await adapter.requestQrPairing(
      {
        instanceId,
        providerId,
        sessionId,
        pairingAttemptRef: "pairing_attempt_1",
      },
      context,
    );
    const disconnected = await adapter.disconnect(
      {
        instanceId,
        providerId,
        sessionId,
        intent: "disconnect",
        reasonCode: "operator_disconnect",
      },
      context,
    );

    expect(connection.ok ? connection.value : undefined).toMatchObject({
      instanceId,
      providerId,
      state: "connected",
      providerSignalRef: "provider.baileys.connected",
    });
    expect(qr.ok ? qr.value : undefined).toEqual({
      instanceId,
      sessionId,
      challengeRef: "qr.challenge.ref",
      expiresAtEpochMilliseconds: 1_804_000_000_000,
      dataClassification: "secret",
    });
    expect(disconnected.ok ? disconnected.value : undefined).toMatchObject({
      instanceId,
      providerId,
      state: "disconnected",
    });
    expect(socket.logoutCalled).toBe(true);
  });

  it("returns only a safe QR challenge reference for pairing requests", async () => {
    const rawQr = "raw-qr-secret-token";
    const rawPairingCode = "raw-pairing-code-secret";
    const socket = createFakeSocket();
    socket.requestPairingCode = async () => rawPairingCode;
    const adapter = createAdapter({
      socket,
      qrChallenge: {
        challengeRef: "qr_challenge_0123456789abcdef",
        expiresAtEpochMilliseconds: 1_804_000_060_000,
      },
    });

    const result = await adapter.requestQrPairing(
      {
        instanceId,
        providerId,
        sessionId,
        pairingAttemptRef: "pairing_attempt_raw_should_not_escape",
      },
      context,
    );

    expect(result.ok ? result.value : undefined).toEqual({
      instanceId,
      sessionId,
      challengeRef: "qr_challenge_0123456789abcdef",
      expiresAtEpochMilliseconds: 1_804_000_060_000,
      dataClassification: "secret",
    });
    expect(JSON.stringify(result)).not.toContain(rawQr);
    expect(JSON.stringify(result)).not.toContain(rawPairingCode);
  });

  it("keeps provider capability summary inside approved MVP message types", async () => {
    const socket = createFakeSocket();
    const adapter = createAdapter({
      socket,
      supportedMessageTypes: ["text", "image", "sticker", "audio"],
    });

    const result = await adapter.getCapabilitySummary(providerId, context);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : undefined).toEqual({
      providerId,
      supportedMessageTypes: ["text", "image", "audio"],
      degraded: false,
    });
  });

  it("sanitizes raw Baileys failures before crossing the provider port", async () => {
    const socket = createFakeSocket({
      sendError: Object.assign(new Error("raw session secret token"), {
        output: { statusCode: 503 },
      }),
    });
    const adapter = createAdapter({ socket });

    const result = await adapter.sendOutboundMessage(
      {
        instanceId,
        providerId,
        sessionId,
        messageId,
        messageType: "text",
        outboundIntentRef: "intent_2",
        idempotencyKey: "provider-send-2",
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unavailable",
      code: "baileys_provider_failure",
      retryable: true,
      ownerContext: "provider_integration",
      failureCategory: "network",
    });
    expect(JSON.stringify(result.ok ? undefined : result.error)).not.toContain("secret");
  });

  it("maps explicit provider errors without leaking provider-native details", async () => {
    const socket = createFakeSocket({
      sendError: new BaileysProviderError({
        code: "baileys_not_logged_in",
        category: "rejected",
        failureCategory: "provider",
        retryable: false,
        message: "Provider session is not ready.",
      }),
    });
    const adapter = createAdapter({ socket });

    const result = await adapter.sendOutboundMessage(
      {
        instanceId,
        providerId,
        sessionId,
        messageId,
        messageType: "text",
        outboundIntentRef: "intent_3",
        idempotencyKey: "provider-send-3",
      },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "rejected",
      code: "baileys_not_logged_in",
      message: "Provider session is not ready.",
      retryable: false,
      ownerContext: "provider_integration",
      failureCategory: "provider",
    });
  });

  it("creates translated provider signals without provider-native payloads", () => {
    const signal = createTranslatedBaileysSignal({
      signalRef: "baileys.message.delivered",
      providerId,
      targetRef: "message_provider_1",
      occurrenceRef: "occurrence_1",
      kind: "message_status",
      dataClassification: "internal",
      failureCategory: "provider",
    });

    expect(signal).toEqual({
      signalRef: "baileys.message.delivered",
      providerId,
      targetRef: "message_provider_1",
      occurrenceRef: "occurrence_1",
      kind: "message_status",
      dataClassification: "internal",
      failureCategory: "provider",
    });
  });
});

function createAdapter(options: {
  socket: FakeBaileysSocket;
  outboundMessage?: BaileysResolvedOutboundMessage;
  qrChallenge?: { challengeRef: string; expiresAtEpochMilliseconds?: number };
  supportedMessageTypes?: readonly string[];
}): BaileysMessagingProviderAdapter {
  const socketProvider = new FakeBaileysSocketProvider();
  socketProvider.registerSocket(
    {
      instanceId,
      providerId,
      sessionId,
      reasonCode: "provider_adapter_test",
    },
    options.socket,
  );
  const gatewayOptions = {
    socketProvider,
    outboundMessageResolver: {
      resolveOutboundMessage: () =>
        options.outboundMessage ?? {
          jid: "synthetic-omniwa@s.whatsapp.net",
          content: { text: "default provider test content" },
        },
    },
    qrChallengeResolver: {
      resolveQrChallenge: () =>
        options.qrChallenge ?? {
          challengeRef: "qr.challenge.ref",
          expiresAtEpochMilliseconds: 1_804_000_000_000,
        },
    },
  };
  const gateway = new BaileysSocketGateway(
    options.supportedMessageTypes === undefined
      ? gatewayOptions
      : {
          ...gatewayOptions,
          supportedMessageTypes: options.supportedMessageTypes,
        },
  );

  return new BaileysMessagingProviderAdapter({ gateway });
}

type SentMessage = Readonly<{
  jid: string;
  content: BaileysResolvedOutboundMessage["content"];
  options: BaileysResolvedOutboundMessage["options"] | undefined;
}>;

function createFakeSocket(options: { sendError?: unknown } = {}): FakeBaileysSocket & {
  sentMessages: SentMessage[];
} {
  return new FakeBaileysSocket(options) as FakeBaileysSocket & { sentMessages: SentMessage[] };
}
