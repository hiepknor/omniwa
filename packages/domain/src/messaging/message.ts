import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type {
  GuardrailDecisionId,
  InstanceId,
  MediaId,
  MessageId,
} from "../identity/aggregate-ids.js";
import type { FailureCategory } from "../errors/failure-category.js";
import type { MessageDirection } from "./message-direction.js";
import type { MessageType } from "./message-type.js";
import type { RetentionPolicy } from "../policies/retention-policy.js";
import type { MessageStatus } from "../status/message-status.js";

const messageTransitions: StatusTransitionMap<MessageStatus> = {
  created: ["evaluated", "failed", "cancelled"],
  evaluated: ["queued", "failed", "cancelled"],
  queued: ["processing", "failed", "cancelled"],
  processing: ["sent", "delivered", "read", "failed", "cancelled"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read"],
  read: [],
  failed: [],
  cancelled: [],
};

export type Message = Readonly<{
  id: MessageId;
  instanceId: InstanceId;
  direction: MessageDirection;
  type: MessageType;
  status: MessageStatus;
  guardrailDecisionId?: GuardrailDecisionId;
  mediaId?: MediaId;
  failureCategory?: FailureCategory;
  retentionPolicy?: RetentionPolicy;
  domainEvents: readonly DomainEvent[];
}>;

export type MessageInput = Readonly<{
  id: MessageId;
  instanceId: InstanceId;
  type: MessageType;
  mediaId?: MediaId;
  retentionPolicy?: RetentionPolicy;
}>;

export function createOutboundMessageIntent(input: MessageInput): Message {
  return freezeMessage({
    ...baseMessage(input, "outbound"),
    domainEvents: [],
  });
}

export function createInboundMessage(input: MessageInput): Message {
  return freezeMessage({
    ...baseMessage(input, "inbound"),
    domainEvents: appendDomainEvent([], "Message", input.id, "InboundMessageReceived"),
  });
}

export function acceptMessage(message: Message, guardrailDecisionId: GuardrailDecisionId): Message {
  if (message.direction !== "outbound") {
    throw new TypeError("Only outbound messages require guardrail acceptance.");
  }

  return transitionMessage(message, "evaluated", "MessageAccepted", { guardrailDecisionId });
}

export function rejectMessage(message: Message, failureCategory: FailureCategory): Message {
  return transitionMessage(message, "failed", "MessageRejected", { failureCategory });
}

export function queueMessage(message: Message): Message {
  assertOutboundGuardrail(message);
  return transitionMessage(message, "queued", "MessageQueued");
}

export function markMessageProcessing(message: Message): Message {
  return transitionMessage(message, "processing", "MessageProcessingStarted");
}

export function markMessageSent(message: Message): Message {
  return transitionMessage(message, "sent", "MessageDispatched");
}

export function markMessageDelivered(message: Message): Message {
  return transitionMessage(message, "delivered", "MessageDelivered");
}

export function markMessageRead(message: Message): Message {
  return transitionMessage(message, "read", "MessageRead");
}

export function failMessage(message: Message, failureCategory: FailureCategory): Message {
  return transitionMessage(message, "failed", "MessageFailed", { failureCategory });
}

export function cancelMessage(message: Message): Message {
  return transitionMessage(message, "cancelled", "MessageCancelled");
}

function baseMessage(
  input: MessageInput,
  direction: MessageDirection,
): Omit<Message, "domainEvents"> {
  const optionalValues = {
    ...(input.mediaId === undefined ? {} : { mediaId: input.mediaId }),
    ...(input.retentionPolicy === undefined ? {} : { retentionPolicy: input.retentionPolicy }),
  };

  return {
    id: input.id,
    instanceId: input.instanceId,
    direction,
    type: input.type,
    status: "created",
    ...optionalValues,
  };
}

function transitionMessage(
  message: Message,
  status: MessageStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    guardrailDecisionId?: GuardrailDecisionId;
    failureCategory?: FailureCategory;
  }> = {},
): Message {
  const guardrailPatch =
    "guardrailDecisionId" in patch
      ? { guardrailDecisionId: patch.guardrailDecisionId }
      : message.guardrailDecisionId === undefined
        ? {}
        : { guardrailDecisionId: message.guardrailDecisionId };
  const failurePatch =
    "failureCategory" in patch
      ? { failureCategory: patch.failureCategory }
      : message.failureCategory === undefined
        ? {}
        : { failureCategory: message.failureCategory };

  return freezeMessage({
    id: message.id,
    instanceId: message.instanceId,
    direction: message.direction,
    type: message.type,
    status: transitionStatus(message.status, status, messageTransitions, "Message"),
    ...(message.mediaId === undefined ? {} : { mediaId: message.mediaId }),
    ...(message.retentionPolicy === undefined ? {} : { retentionPolicy: message.retentionPolicy }),
    ...guardrailPatch,
    ...failurePatch,
    domainEvents: appendDomainEvent(message.domainEvents, "Message", message.id, eventName),
  });
}

function assertOutboundGuardrail(message: Message): void {
  if (message.direction === "outbound" && message.guardrailDecisionId === undefined) {
    throw new TypeError("Outbound Message acceptance requires a GuardrailDecision.");
  }
}

function freezeMessage(message: Message): Message {
  return Object.freeze(message);
}
