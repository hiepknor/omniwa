import type { MessageId } from "@omniwa/domain";
import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export type OutboundMessageIntentRef = OpaqueString<"OutboundMessageIntentRef">;

export type TextOutboundMessageIntentInput = Readonly<{
  outboundIntentRef?: OutboundMessageIntentRef;
  recipientRef: string;
  text: string;
  expiresAtEpochMilliseconds?: number;
}>;

export type StoredTextOutboundMessageIntent = Readonly<{
  outboundIntentRef: OutboundMessageIntentRef;
  kind: "text";
  recipientRef: string;
  text: string;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
  messageId?: MessageId;
}>;

export type OutboundMessageIntentReceipt = Readonly<{
  outboundIntentRef: OutboundMessageIntentRef;
  kind: "text";
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
}>;

export type OutboundMessageIntentBinding = Readonly<{
  outboundIntentRef: OutboundMessageIntentRef;
  messageId: MessageId;
}>;

export interface OutboundMessageIntentStorePort {
  storeTextIntent(
    intent: TextOutboundMessageIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>>;

  bindMessageIntent(
    binding: OutboundMessageIntentBinding,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentBinding>>;

  findTextIntentByMessage(
    messageId: MessageId,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>>;

  verifyTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<OutboundMessageIntentReceipt>>;

  resolveTextIntent(
    outboundIntentRef: OutboundMessageIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredTextOutboundMessageIntent>>;
}

const outboundIntentRefPattern = /^[A-Za-z0-9_.:-]+$/u;

export function createOutboundMessageIntentRef(value: string): OutboundMessageIntentRef {
  const normalized = value.trim();

  if (!outboundIntentRefPattern.test(normalized)) {
    throw new TypeError("OutboundMessageIntentRef must be a safe opaque reference.");
  }

  return createOpaqueString(normalized, "OutboundMessageIntentRef");
}

export function createTextOutboundMessageIntentInput(
  input: TextOutboundMessageIntentInput,
): TextOutboundMessageIntentInput {
  assertNonEmpty(input.recipientRef, "Outbound message recipient reference");
  assertNonEmpty(input.text, "Outbound message text");

  if (
    input.expiresAtEpochMilliseconds !== undefined &&
    !Number.isSafeInteger(input.expiresAtEpochMilliseconds)
  ) {
    throw new TypeError("Outbound message intent expiry must be a safe integer.");
  }

  return Object.freeze({
    ...input,
    recipientRef: input.recipientRef.trim(),
  });
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}
