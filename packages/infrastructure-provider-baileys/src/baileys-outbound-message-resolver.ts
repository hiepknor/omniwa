import {
  createOutboundMessageIntentRef,
  type ApplicationPortContext,
  type OutboundMessageIntentStorePort,
  type ProviderOutboundMessageRequest,
} from "@omniwa/application";
import { createFailureCategory } from "@omniwa/domain";

import {
  BaileysProviderError,
  type BaileysOutboundMessageResolver,
  type BaileysResolvedOutboundMessage,
} from "./baileys-messaging-provider.adapter.js";

export type OutboundMessageIntentBaileysResolverOptions = Readonly<{
  intentStore: Pick<OutboundMessageIntentStorePort, "resolveTextIntent">;
}>;

export class OutboundMessageIntentBaileysResolver implements BaileysOutboundMessageResolver {
  private readonly intentStore: Pick<OutboundMessageIntentStorePort, "resolveTextIntent">;

  constructor(options: OutboundMessageIntentBaileysResolverOptions) {
    this.intentStore = options.intentStore;
  }

  async resolveOutboundMessage(
    request: ProviderOutboundMessageRequest,
    context: ApplicationPortContext,
  ): Promise<BaileysResolvedOutboundMessage> {
    const outboundIntentRef = this.createSafeIntentRef(request.outboundIntentRef);
    const result = await this.intentStore.resolveTextIntent(outboundIntentRef, context);

    if (!result.ok) {
      throw new BaileysProviderError({
        code: "baileys_outbound_intent_unavailable",
        category: result.error.category,
        failureCategory: createFailureCategory("provider"),
        retryable: result.error.retryable,
        message: "Outbound message intent is unavailable.",
      });
    }

    return Object.freeze({
      jid: result.value.recipientRef,
      content: Object.freeze({
        text: result.value.text,
      }),
    });
  }

  private createSafeIntentRef(value: string): ReturnType<typeof createOutboundMessageIntentRef> {
    try {
      return createOutboundMessageIntentRef(value);
    } catch {
      throw new BaileysProviderError({
        code: "baileys_outbound_intent_ref_invalid",
        category: "unsafe_payload",
        failureCategory: createFailureCategory("provider"),
        retryable: false,
        message: "Outbound message intent reference is invalid.",
      });
    }
  }
}
