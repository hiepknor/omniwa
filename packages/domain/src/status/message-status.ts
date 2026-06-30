import { createStringUnionValue } from "../common/string-union-value.js";

export const messageStatuses = [
  "created",
  "evaluated",
  "queued",
  "processing",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
] as const;

export type MessageStatus = (typeof messageStatuses)[number];

export function createMessageStatus(value: string): MessageStatus {
  return createStringUnionValue(value, messageStatuses, "MessageStatus");
}
