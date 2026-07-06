import type { ApplicationPortContext } from "@omniwa/application";
import {
  createInstanceId,
  createMessageId,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  InMemoryProviderCommandTransport,
  ProviderCommandMessagingProviderAdapter,
  type ProviderCommandTransport,
} from "./provider-command-transport.js";

const instanceId = createInstanceId("instance.bridge-test");
const providerId = createProviderId("baileys");
const sessionId = createSessionId("session.bridge-test");
const messageId = createMessageId("message.bridge-test");

describe("ProviderCommandMessagingProviderAdapter", () => {
  it("delegates outbound send through a safe provider command", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: (command) => {
        expect(command.kind).toBe("send_outbound_message");

        if (command.kind !== "send_outbound_message") {
          throw new Error("unexpected command kind");
        }

        return ok({
          kind: "send_outbound_message",
          result: {
            messageId: command.request.messageId,
            providerReceiptRef: "receipt.safe-ref",
            retryable: false,
            status: "accepted",
          },
        });
      },
    });
    const adapter = new ProviderCommandMessagingProviderAdapter({ transport });

    const result = await adapter.sendOutboundMessage(
      {
        idempotencyKey: "idem.safe",
        instanceId,
        messageId,
        messageType: "text",
        outboundIntentRef: "outbound.intent.safe-ref",
        providerId,
        sessionId,
      },
      context("idem.safe"),
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.status : undefined).toBe("accepted");
    expect(transport.commands()).toHaveLength(1);
    expect(transport.commands()[0]?.commandId).toBe("send_outbound_message:idem.safe");
    expect(JSON.stringify(transport.commands())).not.toContain("hello");
    expect(JSON.stringify(transport.commands())).not.toContain("@s.whatsapp.net");
  });

  it("returns a safe failure when the bridge transport is not configured", async () => {
    const transport = new InMemoryProviderCommandTransport();
    const adapter = new ProviderCommandMessagingProviderAdapter({ transport });

    const result = await adapter.sendOutboundMessage(
      {
        idempotencyKey: "idem.safe",
        instanceId,
        messageId,
        messageType: "text",
        outboundIntentRef: "outbound.intent.safe-ref",
        providerId,
        sessionId,
      },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe(
      "provider_command_transport_unconfigured",
    );
    expect(JSON.stringify(result)).not.toContain("@s.whatsapp.net");
    expect(JSON.stringify(result)).not.toContain("hello");
  });

  it("fails safely when the transport returns the wrong outcome kind", async () => {
    const transport = new InMemoryProviderCommandTransport({
      handler: () =>
        ok({
          kind: "get_capability_summary",
          result: {
            degraded: false,
            providerId,
            supportedMessageTypes: ["text"],
          },
        }),
    });
    const adapter = new ProviderCommandMessagingProviderAdapter({ transport });

    const result = await adapter.sendOutboundMessage(
      {
        idempotencyKey: "idem.safe",
        instanceId,
        messageId,
        messageType: "text",
        outboundIntentRef: "outbound.intent.safe-ref",
        providerId,
        sessionId,
      },
      context(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe(
      "provider_command_transport_invalid_outcome",
    );
    expect(result.ok ? undefined : result.error.safeMetadata).toEqual({
      actualKind: "get_capability_summary",
      expectedKind: "send_outbound_message",
    });
  });

  it("delegates connection, QR, disconnect, and capability commands", async () => {
    const seen: string[] = [];
    const transport = new InMemoryProviderCommandTransport({
      handler: (command) => {
        seen.push(command.kind);

        switch (command.kind) {
          case "request_connection":
            return ok({
              kind: "request_connection",
              result: {
                instanceId: command.request.instanceId,
                providerId: command.request.providerId,
                state: "connected",
              },
            });
          case "request_qr_pairing":
            return ok({
              kind: "request_qr_pairing",
              result: {
                challengeRef: "challenge.safe-ref",
                dataClassification: "secret",
                instanceId: command.request.instanceId,
                sessionId: command.request.sessionId,
              },
            });
          case "disconnect":
            return ok({
              kind: "disconnect",
              result: {
                instanceId: command.request.instanceId,
                providerId: command.request.providerId,
                state: "disconnected",
              },
            });
          case "get_capability_summary":
            return ok({
              kind: "get_capability_summary",
              result: {
                degraded: false,
                providerId: command.providerId,
                supportedMessageTypes: ["text"],
              },
            });
          case "send_outbound_message":
            throw new Error("unexpected send command");
        }
      },
    });
    const adapter = new ProviderCommandMessagingProviderAdapter({ transport });

    await adapter.requestConnection(
      {
        instanceId,
        intent: "connect",
        providerId,
        reasonCode: "operator_requested",
        sessionId,
      },
      context(),
    );
    await adapter.requestQrPairing(
      {
        instanceId,
        pairingAttemptRef: "pairing.safe-ref",
        providerId,
        sessionId,
      },
      context(),
    );
    await adapter.disconnect(
      {
        instanceId,
        intent: "disconnect",
        providerId,
        reasonCode: "operator_requested",
        sessionId,
      },
      context(),
    );
    await adapter.getCapabilitySummary(providerId, context());

    expect(seen).toEqual([
      "request_connection",
      "request_qr_pairing",
      "disconnect",
      "get_capability_summary",
    ]);
  });

  it("can wrap a custom transport implementation without exposing provider internals", async () => {
    const customTransport: ProviderCommandTransport = {
      execute: async (command) =>
        ok({
          kind: "get_capability_summary",
          result: {
            degraded: command.kind !== "get_capability_summary",
            providerId,
            supportedMessageTypes: ["text"],
          },
        }),
    };
    const adapter = new ProviderCommandMessagingProviderAdapter({
      transport: customTransport,
    });

    const result = await adapter.getCapabilitySummary(providerId, context());

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.supportedMessageTypes : []).toEqual(["text"]);
  });
});

function context(idempotencyKey = "bridge.test"): ApplicationPortContext {
  return {
    actorRef: "worker",
    dataClassification: "internal",
    idempotencyKey,
    requestContext: createRequestContext({
      correlationId: createCorrelationId(`corr.${idempotencyKey}`),
      requestId: createRequestId(`req.${idempotencyKey}`),
    }),
  };
}
