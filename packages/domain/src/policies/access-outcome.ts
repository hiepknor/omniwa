import { createStringUnionValue } from "../common/string-union-value.js";

export const accessOutcomes = ["granted", "denied"] as const;

export type AccessOutcome = (typeof accessOutcomes)[number];

export function createAccessOutcome(value: string): AccessOutcome {
  return createStringUnionValue(value, accessOutcomes, "AccessOutcome");
}
