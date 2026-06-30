import { createStringUnionValue } from "../common/string-union-value.js";

export const sessionStatuses = [
  "empty",
  "pending",
  "active",
  "expired",
  "revoked",
  "cleanup",
] as const;

export type SessionStatus = (typeof sessionStatuses)[number];

export function createSessionStatus(value: string): SessionStatus {
  return createStringUnionValue(value, sessionStatuses, "SessionStatus");
}
