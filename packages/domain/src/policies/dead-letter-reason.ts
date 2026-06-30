import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { createFailureCategory, type FailureCategory } from "../errors/failure-category.js";

export type DeadLetterReason = Readonly<{
  code: string;
  category: FailureCategory;
}>;

export type DeadLetterReasonInput = Readonly<{
  code: string;
  category: string;
}>;

export function createDeadLetterReason(input: DeadLetterReasonInput): DeadLetterReason {
  return Object.freeze({
    code: createSafeDomainCode(input.code, "DeadLetterReason.code"),
    category: createFailureCategory(input.category),
  });
}
