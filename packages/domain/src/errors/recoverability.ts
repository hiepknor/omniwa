import { createStringUnionValue } from "../common/string-union-value.js";

export const recoverabilityKinds = [
  "caller_correctable",
  "operator_correctable",
  "time_correctable",
  "terminal",
  "design_blocked",
] as const;

export type Recoverability = (typeof recoverabilityKinds)[number];

export function createRecoverability(value: string): Recoverability {
  return createStringUnionValue(value, recoverabilityKinds, "Recoverability");
}
