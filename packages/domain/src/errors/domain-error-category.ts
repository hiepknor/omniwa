import { createStringUnionValue } from "../common/string-union-value.js";

export const domainErrorCategories = [
  "business_rule_violation",
  "invalid_state_transition",
  "unsupported_capability",
  "policy_violation",
  "identity_error",
  "consistency_error",
  "sensitive_data_violation",
  "retention_rule_violation",
  "access_decision_violation",
  "external_signal_classification_error",
  "configuration_domain_error",
] as const;

export type DomainErrorCategory = (typeof domainErrorCategories)[number];

export function createDomainErrorCategory(value: string): DomainErrorCategory {
  return createStringUnionValue(value, domainErrorCategories, "DomainErrorCategory");
}
