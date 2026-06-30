import type { DomainDataClassification, DomainOwnerContext, FailureCategory } from "@omniwa/domain";
import type { RequestContext, Result } from "@omniwa/shared";

export const applicationPortFailureCategories = [
  "unavailable",
  "timeout",
  "conflict",
  "rejected",
  "unsafe_payload",
  "unsupported",
  "unknown",
] as const;

export type ApplicationPortFailureCategory = (typeof applicationPortFailureCategories)[number];

export type SafePortMetadataValue = string | number | boolean;

export type ApplicationPortFailure = Readonly<{
  category: ApplicationPortFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  ownerContext?: DomainOwnerContext;
  failureCategory?: FailureCategory;
  safeMetadata?: Readonly<Record<string, SafePortMetadataValue>>;
}>;

export type ApplicationPortResult<T> = Result<T, ApplicationPortFailure>;

export type ApplicationPortContext = Readonly<{
  requestContext: RequestContext;
  actorRef?: string;
  idempotencyKey?: string;
  dataClassification?: DomainDataClassification;
}>;

export function createApplicationPortFailure(
  input: ApplicationPortFailure,
): ApplicationPortFailure {
  const base = {
    ...input,
  };

  if (input.safeMetadata === undefined) {
    return Object.freeze(base);
  }

  return Object.freeze({
    ...base,
    safeMetadata: Object.freeze(input.safeMetadata),
  });
}
