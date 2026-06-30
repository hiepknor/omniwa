import { createStringUnionValue } from "../common/string-union-value.js";

export const providerProfileStatuses = [
  "candidate",
  "supported",
  "degraded",
  "unsupported",
  "retired",
] as const;

export type ProviderProfileStatus = (typeof providerProfileStatuses)[number];

export function createProviderProfileStatus(value: string): ProviderProfileStatus {
  return createStringUnionValue(value, providerProfileStatuses, "ProviderProfileStatus");
}
