import { describe, expect, it } from "vitest";

import { createFailureCategory } from "../errors/failure-category.js";
import {
  createGuardrailDecisionId,
  createInstanceId,
  createMediaId,
  createMessageId,
  createSessionId,
} from "../identity/aggregate-ids.js";
import {
  createInstance,
  destroyInstance,
  markInstanceConnected,
  markInstanceConnecting,
  markInstanceDisconnected,
  markInstanceQrPending,
} from "../instance/instance.js";
import {
  acceptMediaAsset,
  attachMediaAsset,
  cleanMediaAsset,
  createMediaAsset,
  markMediaProcessed,
  markMediaProcessing,
} from "../media/media-asset.js";
import { createMediaCategory } from "../media/media-category.js";
import {
  acceptMessage,
  createOutboundMessageIntent,
  failMessage,
  markMessageDelivered,
  markMessageProcessing,
  markMessageRead,
  markMessageSent,
  queueMessage,
} from "../messaging/message.js";
import { createMessageType } from "../messaging/message-type.js";
import { createRetentionPolicy } from "../policies/retention-policy.js";
import {
  activateSession,
  createSession,
  isSessionSendCapable,
  revokeSession,
  startSessionPairing,
} from "../session/session.js";

describe("core aggregate roots", () => {
  it("protects Instance lifecycle and destroyed terminal state", () => {
    const instanceId = createInstanceId("instance_1");
    const sessionId = createSessionId("session_1");
    const instance = createInstance(instanceId);
    const connected = markInstanceConnected(
      markInstanceQrPending(markInstanceConnecting(instance)),
      sessionId,
    );
    const destroyed = destroyInstance(connected);

    expect(instance.status).toBe("created");
    expect(instance.domainEvents.at(0)?.name).toBe("InstanceCreated");
    expect(connected.status).toBe("connected");
    expect(connected.currentSessionId).toBe(sessionId);
    expect(destroyed.status).toBe("destroyed");
    expect(() => markInstanceDisconnected(destroyed)).toThrow(TypeError);
  });

  it("protects Session ownership and send-capable state", () => {
    const session = createSession(createSessionId("session_2"), createInstanceId("instance_2"));

    expect(() => activateSession(session)).toThrow(TypeError);

    const active = activateSession(startSessionPairing(session));
    const revoked = revokeSession(active);

    expect(active.instanceId).toBe(createInstanceId("instance_2"));
    expect(isSessionSendCapable(active)).toBe(true);
    expect(isSessionSendCapable(revoked)).toBe(false);
    expect(() => activateSession(revoked)).toThrow(TypeError);
  });

  it("requires outbound Message guardrails before queueing", () => {
    const message = createOutboundMessageIntent({
      id: createMessageId("message_1"),
      instanceId: createInstanceId("instance_3"),
      type: createMessageType("text"),
    });

    expect(() => queueMessage(message)).toThrow(TypeError);

    const accepted = acceptMessage(message, createGuardrailDecisionId("guardrail_1"));
    const sent = markMessageSent(markMessageProcessing(queueMessage(accepted)));
    const read = markMessageRead(markMessageDelivered(sent));

    expect(accepted.status).toBe("evaluated");
    expect(accepted.guardrailDecisionId).toBe(createGuardrailDecisionId("guardrail_1"));
    expect(read.status).toBe("read");
    expect(read.domainEvents.map((event) => event.name)).toContain("MessageDispatched");
    expect(() => failMessage(read, createFailureCategory("provider"))).toThrow(TypeError);
  });

  it("keeps MediaAsset lifecycle separate from Message lifecycle", () => {
    const media = createMediaAsset(
      createMediaId("media_1"),
      createMediaCategory("image"),
      createRetentionPolicy({ category: "media_metadata", retentionDays: 30 }),
    );
    const attached = attachMediaAsset(
      markMediaProcessed(markMediaProcessing(acceptMediaAsset(media))),
      createMessageId("message_2"),
    );
    const cleaned = cleanMediaAsset(attached);

    expect(attached.status).toBe("attached");
    expect(attached.messageId).toBe(createMessageId("message_2"));
    expect(cleaned.status).toBe("cleaned");
    expect(() => attachMediaAsset(cleaned, createMessageId("message_3"))).toThrow(TypeError);
  });
});
