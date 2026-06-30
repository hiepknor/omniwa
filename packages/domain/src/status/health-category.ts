import { createStringUnionValue } from "../common/string-union-value.js";

export const healthCategories = [
  "healthy",
  "degraded",
  "unavailable",
  "action_required",
  "recovered",
  "unknown",
] as const;

export type HealthCategory = (typeof healthCategories)[number];

export function createHealthCategory(value: string): HealthCategory {
  return createStringUnionValue(value, healthCategories, "HealthCategory");
}
