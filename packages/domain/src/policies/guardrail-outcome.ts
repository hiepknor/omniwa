import { createStringUnionValue } from "../common/string-union-value.js";

export const guardrailOutcomes = ["allow", "block", "throttle", "action_required"] as const;

export type GuardrailOutcome = (typeof guardrailOutcomes)[number];

export function createGuardrailOutcome(value: string): GuardrailOutcome {
  return createStringUnionValue(value, guardrailOutcomes, "GuardrailOutcome");
}
