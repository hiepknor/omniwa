import type { DomainOwnerContext, Recoverability } from "@omniwa/domain";

export const applicationErrorCategories = [
  "validation",
  "authorization",
  "conflict",
  "workflow",
  "async_visibility",
  "mapping",
  "consistency",
  "dependency",
  "unknown",
] as const;

export type ApplicationErrorCategory = (typeof applicationErrorCategories)[number];

export type ApplicationError = Readonly<{
  category: ApplicationErrorCategory;
  code: string;
  message: string;
  recoverability: Recoverability;
  ownerContext?: DomainOwnerContext;
  retryable: boolean;
}>;

export function createApplicationError(input: ApplicationError): ApplicationError {
  return Object.freeze({ ...input });
}

export function isApplicationErrorCategory(value: string): value is ApplicationErrorCategory {
  return applicationErrorCategories.includes(value as ApplicationErrorCategory);
}
