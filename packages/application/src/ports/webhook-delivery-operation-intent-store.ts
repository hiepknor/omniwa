import { createOpaqueString, type OpaqueString } from "@omniwa/shared";

import type { ApplicationPortContext, ApplicationPortResult } from "./application-port.js";

export type WebhookDeliveryOperationIntentRef = OpaqueString<"WebhookDeliveryOperationIntentRef">;

export type BulkRedriveWebhookDeliveryIntentInput = Readonly<{
  webhookDeliveryOperationIntentRef?: WebhookDeliveryOperationIntentRef;
  kind: "bulk_redrive";
  deliveryRefs: readonly string[];
  expiresAtEpochMilliseconds?: number;
}>;

export type WebhookDeliveryOperationIntentInput = BulkRedriveWebhookDeliveryIntentInput;

export type StoredWebhookDeliveryOperationIntent = WebhookDeliveryOperationIntentInput &
  Readonly<{
    webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef;
    createdAtEpochMilliseconds: number;
  }>;

export type WebhookDeliveryOperationIntentReceipt = Readonly<{
  webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef;
  kind: WebhookDeliveryOperationIntentInput["kind"];
  deliveryCount: number;
  createdAtEpochMilliseconds: number;
  expiresAtEpochMilliseconds?: number;
}>;

export interface WebhookDeliveryOperationIntentStorePort {
  storeWebhookDeliveryOperationIntent(
    intent: WebhookDeliveryOperationIntentInput,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<WebhookDeliveryOperationIntentReceipt>>;

  resolveWebhookDeliveryOperationIntent(
    webhookDeliveryOperationIntentRef: WebhookDeliveryOperationIntentRef,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<StoredWebhookDeliveryOperationIntent>>;
}

const webhookDeliveryOperationIntentRefPattern = /^[A-Za-z0-9_.:-]+$/u;
const webhookDeliveryOperationDeliveryRefPattern = /^[A-Za-z0-9_.:-]+$/u;
const maxBulkRedriveDeliveryRefs = 50;

export function createWebhookDeliveryOperationIntentRef(
  value: string,
): WebhookDeliveryOperationIntentRef {
  const normalized = value.trim();

  if (!webhookDeliveryOperationIntentRefPattern.test(normalized)) {
    throw new TypeError("WebhookDeliveryOperationIntentRef must be a safe opaque reference.");
  }

  return createOpaqueString(normalized, "WebhookDeliveryOperationIntentRef");
}

export function createWebhookDeliveryOperationIntentInput(
  input: WebhookDeliveryOperationIntentInput,
): WebhookDeliveryOperationIntentInput {
  assertSafeExpiry(input.expiresAtEpochMilliseconds);

  switch (input.kind) {
    case "bulk_redrive":
      return freezeBulkRedriveInput(input);
  }
}

function freezeBulkRedriveInput(
  input: BulkRedriveWebhookDeliveryIntentInput,
): BulkRedriveWebhookDeliveryIntentInput {
  const deliveryRefs = input.deliveryRefs.map((deliveryRef) => deliveryRef.trim());

  if (deliveryRefs.length === 0) {
    throw new TypeError("Bulk webhook delivery redrive requires at least one delivery reference.");
  }

  if (deliveryRefs.length > maxBulkRedriveDeliveryRefs) {
    throw new TypeError(
      "Bulk webhook delivery redrive exceeds the maximum delivery reference count.",
    );
  }

  for (const deliveryRef of deliveryRefs) {
    assertNonEmpty(deliveryRef, "Webhook delivery reference");

    if (!webhookDeliveryOperationDeliveryRefPattern.test(deliveryRef)) {
      throw new TypeError("Webhook delivery reference must be a safe opaque reference.");
    }
  }

  if (new Set(deliveryRefs).size !== deliveryRefs.length) {
    throw new TypeError("Bulk webhook delivery redrive delivery references must be unique.");
  }

  return Object.freeze({
    ...input,
    deliveryRefs: Object.freeze(deliveryRefs),
  });
}

function assertSafeExpiry(value: number | undefined): void {
  if (value !== undefined && !Number.isSafeInteger(value)) {
    throw new TypeError("Webhook delivery operation intent expiry must be a safe integer.");
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}
