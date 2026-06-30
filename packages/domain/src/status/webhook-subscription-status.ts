import { createStringUnionValue } from "../common/string-union-value.js";

export const webhookSubscriptionStatuses = [
  "proposed",
  "validated",
  "active",
  "suspended",
  "invalid",
  "retired",
] as const;

export type WebhookSubscriptionStatus = (typeof webhookSubscriptionStatuses)[number];

export function createWebhookSubscriptionStatus(value: string): WebhookSubscriptionStatus {
  return createStringUnionValue(value, webhookSubscriptionStatuses, "WebhookSubscriptionStatus");
}
