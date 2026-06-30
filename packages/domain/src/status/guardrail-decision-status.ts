import { createStringUnionValue } from "../common/string-union-value.js";

export const guardrailDecisionStatuses = [
  "requested",
  "evaluated",
  "passed",
  "blocked",
  "throttled",
  "action_required",
  "expired",
] as const;

export type GuardrailDecisionStatus = (typeof guardrailDecisionStatuses)[number];

export function createGuardrailDecisionStatus(value: string): GuardrailDecisionStatus {
  return createStringUnionValue(value, guardrailDecisionStatuses, "GuardrailDecisionStatus");
}
