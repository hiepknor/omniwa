import { createDomainIdentity, type DomainIdentity } from "../identity/domain-identity.js";

export type IdempotencyKey = DomainIdentity<"IdempotencyKey">;

export function createIdempotencyKey(value: string): IdempotencyKey {
  return createDomainIdentity(value, "IdempotencyKey");
}
