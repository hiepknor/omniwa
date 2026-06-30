import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { createDomainErrorCategory, type DomainErrorCategory } from "./domain-error-category.js";
import { createDomainOwnerContext, type DomainOwnerContext } from "./domain-owner-context.js";
import { createRecoverability, type Recoverability } from "./recoverability.js";

export type DomainErrorContextValue = string | number | boolean | null;

export type DomainErrorContext = Readonly<Record<string, DomainErrorContextValue>>;

export type DomainError = Readonly<{
  category: DomainErrorCategory;
  ownerContext: DomainOwnerContext;
  reasonCode: string;
  message: string;
  recoverability: Recoverability;
  context?: DomainErrorContext;
}>;

export type DomainErrorInput = Readonly<{
  category: string;
  ownerContext: string;
  reasonCode: string;
  message: string;
  recoverability: string;
  context?: DomainErrorContext;
}>;

export function createDomainError(input: DomainErrorInput): DomainError {
  const reasonCode = createSafeDomainCode(input.reasonCode, "DomainError.reasonCode");
  const error: DomainError = {
    category: createDomainErrorCategory(input.category),
    ownerContext: createDomainOwnerContext(input.ownerContext),
    reasonCode,
    message: assertNonEmptyMessage(input.message),
    recoverability: createRecoverability(input.recoverability),
    ...(input.context === undefined ? {} : { context: freezeContext(input.context) }),
  };

  return Object.freeze(error);
}

function assertNonEmptyMessage(value: string): string {
  const message = value.trim();

  if (message.length === 0) {
    throw new TypeError("DomainError.message must not be empty.");
  }

  return message;
}

function freezeContext(context: DomainErrorContext): DomainErrorContext {
  const safeContext: Record<string, DomainErrorContextValue> = {};

  for (const [key, value] of Object.entries(context)) {
    safeContext[createSafeDomainCode(key, "DomainError.context key")] = value;
  }

  return Object.freeze(safeContext);
}
