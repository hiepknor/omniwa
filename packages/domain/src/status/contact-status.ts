import { createStringUnionValue } from "../common/string-union-value.js";

export const contactStatuses = ["discovered", "active", "blocked", "deleted"] as const;

export type ContactStatus = (typeof contactStatuses)[number];

export function createContactStatus(value: string): ContactStatus {
  return createStringUnionValue(value, contactStatuses, "ContactStatus");
}
