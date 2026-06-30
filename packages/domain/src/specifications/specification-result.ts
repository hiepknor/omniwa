import { createDomainError, type DomainError } from "../errors/domain-error.js";
import type { DomainErrorCategory } from "../errors/domain-error-category.js";
import type { DomainOwnerContext } from "../errors/domain-owner-context.js";
import type { Recoverability } from "../errors/recoverability.js";

export type SpecificationResult = Readonly<
  | {
      passed: true;
    }
  | {
      passed: false;
      error: DomainError;
    }
>;

export function passSpecification(): SpecificationResult {
  return Object.freeze({ passed: true });
}

export function failSpecification(input: {
  category: DomainErrorCategory;
  ownerContext: DomainOwnerContext;
  reasonCode: string;
  message: string;
  recoverability: Recoverability;
}): SpecificationResult {
  return Object.freeze({
    passed: false,
    error: createDomainError(input),
  });
}

export function isSpecificationPass(
  result: SpecificationResult,
): result is Readonly<{ passed: true }> {
  return result.passed;
}
