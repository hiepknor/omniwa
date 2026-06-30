import { createStringUnionValue } from "../common/string-union-value.js";

export const webhookDeliveryStatuses = [
  "pending",
  "delivering",
  "delivered",
  "retrying",
  "failed",
  "dead_letter",
  "cancelled",
] as const;

export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export function createWebhookDeliveryStatus(value: string): WebhookDeliveryStatus {
  return createStringUnionValue(value, webhookDeliveryStatuses, "WebhookDeliveryStatus");
}
