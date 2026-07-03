import {
  createApplicationPortFailure,
  createOutboundMessageIntentRef,
  type ApplicationPortContext,
  type OutboundMessageIntentStorePort,
  type ProviderOutboundMessageRequest,
  type StoredTextOutboundMessageIntent,
} from "@omniwa/application";
import {
  createInstanceId,
  createMessageId,
  createMessageType,
  createProviderId,
  createSessionId,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  err,
  ok,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { BaileysProviderError } from "./baileys-messaging-provider.adapter.js";
import { OutboundMessageIntentBaileysResolver } from "./baileys-outbound-message-resolver.js";

const rawRecipient = "12025550123@s.whatsapp.net";
const rawText = "private provider text";
const outboundIntentRef = createOutboundMessageIntentRef("outbound_intent:provider-test");
const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    requestId: createRequestId("provider-resolver-request"),
    correlationId: createCorrelationId("provider-resolver-correlation"),
  }),
};

describe("Baileys outbound message resolver", () => {
  it("resolves outboundIntentRef into internal Baileys jid/content", async () => {
    const resolver = new OutboundMessageIntentBaileysResolver({
      intentStore: new FakeIntentStore({
        outboundIntentRef,
        kind: "text",
        recipientRef: rawRecipient,
        text: rawText,
        createdAtEpochMilliseconds: 1,
      }),
    });

    const resolved = await resolver.resolveOutboundMessage(providerRequest(), context);

    expect(resolved).toEqual({
      jid: rawRecipient,
      content: {
        text: rawText,
      },
    });
  });

  it("throws safe provider errors when the intent is missing", async () => {
    const resolver = new OutboundMessageIntentBaileysResolver({
      intentStore: new MissingIntentStore(),
    });

    let caught: unknown;

    try {
      await resolver.resolveOutboundMessage(providerRequest(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BaileysProviderError);
    expect(caught).toMatchObject({
      code: "baileys_outbound_intent_unavailable",
      message: "Outbound message intent is unavailable.",
      retryable: false,
    });
    expect(JSON.stringify(caught)).not.toContain(rawRecipient);
    expect(JSON.stringify(caught)).not.toContain(rawText);
  });
});

function providerRequest(): ProviderOutboundMessageRequest {
  return {
    instanceId: createInstanceId("inst_provider_resolver"),
    providerId: createProviderId("provider_baileys"),
    sessionId: createSessionId("session_provider_resolver"),
    messageId: createMessageId("msg_provider_resolver"),
    messageType: createMessageType("text"),
    outboundIntentRef: String(outboundIntentRef),
    idempotencyKey: "provider-resolver-idempotency",
  };
}

class FakeIntentStore implements Pick<OutboundMessageIntentStorePort, "resolveTextIntent"> {
  private readonly intent: StoredTextOutboundMessageIntent;

  constructor(intent: StoredTextOutboundMessageIntent) {
    this.intent = intent;
  }

  resolveTextIntent(): ReturnType<OutboundMessageIntentStorePort["resolveTextIntent"]> {
    return Promise.resolve(ok(this.intent));
  }
}

class MissingIntentStore implements Pick<OutboundMessageIntentStorePort, "resolveTextIntent"> {
  resolveTextIntent(): ReturnType<OutboundMessageIntentStorePort["resolveTextIntent"]> {
    return Promise.resolve(
      err(
        createApplicationPortFailure({
          category: "rejected",
          code: "outbound_intent_not_found",
          message: "Outbound message intent store operation failed.",
          retryable: false,
          ownerContext: "messaging",
          safeMetadata: {
            outboundIntentRef: String(outboundIntentRef),
          },
        }),
      ),
    );
  }
}
