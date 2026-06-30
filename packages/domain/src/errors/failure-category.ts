import { createStringUnionValue } from "../common/string-union-value.js";

export const failureCategories = [
  "business",
  "validation",
  "provider",
  "webhook",
  "network",
  "configuration",
  "queue",
  "worker",
  "media",
  "session",
  "security",
  "unexpected",
] as const;

export type FailureCategory = (typeof failureCategories)[number];

export function createFailureCategory(value: string): FailureCategory {
  return createStringUnionValue(value, failureCategories, "FailureCategory");
}
