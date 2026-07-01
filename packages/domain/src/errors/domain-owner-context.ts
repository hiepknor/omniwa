import { createStringUnionValue } from "../common/string-union-value.js";

export const domainOwnerContexts = [
  "instance",
  "session",
  "messaging",
  "media",
  "chat",
  "contact",
  "label",
  "group",
  "webhook_delivery",
  "guardrails",
  "provider_integration",
  "operations",
  "security_access",
  "audit",
  "health",
  "configuration",
  "observability",
] as const;

export type DomainOwnerContext = (typeof domainOwnerContexts)[number];

export function createDomainOwnerContext(value: string): DomainOwnerContext {
  return createStringUnionValue(value, domainOwnerContexts, "DomainOwnerContext");
}
