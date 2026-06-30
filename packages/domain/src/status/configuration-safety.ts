import { createStringUnionValue } from "../common/string-union-value.js";

export const configurationSafetyValues = [
  "valid",
  "invalid",
  "unsafe",
  "guardrail_bypass_rejected",
] as const;

export type ConfigurationSafety = (typeof configurationSafetyValues)[number];

export function createConfigurationSafety(value: string): ConfigurationSafety {
  return createStringUnionValue(value, configurationSafetyValues, "ConfigurationSafety");
}
