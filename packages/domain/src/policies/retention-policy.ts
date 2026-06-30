import { createStringUnionValue } from "../common/string-union-value.js";

export const retentionCategories = [
  "message_metadata",
  "webhook_delivery",
  "audit_record",
  "media_metadata",
  "diagnostic_capture",
  "session_state",
  "projection",
] as const;

export type RetentionCategory = (typeof retentionCategories)[number];

export type RetentionPolicy = Readonly<{
  category: RetentionCategory;
  retentionDays: number;
}>;

export type RetentionPolicyInput = Readonly<{
  category: string;
  retentionDays: number;
}>;

export function createRetentionPolicy(input: RetentionPolicyInput): RetentionPolicy {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0) {
    throw new TypeError("RetentionPolicy.retentionDays must be a non-negative integer.");
  }

  return Object.freeze({
    category: createStringUnionValue(input.category, retentionCategories, "RetentionCategory"),
    retentionDays: input.retentionDays,
  });
}
