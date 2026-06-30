import { createStringUnionValue } from "../common/string-union-value.js";

export const accessDecisionStatuses = ["requested", "granted", "denied", "expired"] as const;

export type AccessDecisionStatus = (typeof accessDecisionStatuses)[number];

export function createAccessDecisionStatus(value: string): AccessDecisionStatus {
  return createStringUnionValue(value, accessDecisionStatuses, "AccessDecisionStatus");
}
