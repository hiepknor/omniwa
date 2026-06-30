import type { RetryPolicy } from "./retry-policy.js";

export type AttemptNumber = number & { readonly __brand: "AttemptNumber" };

export function createAttemptNumber(value: number, retryPolicy?: RetryPolicy): AttemptNumber {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("AttemptNumber must be a positive integer.");
  }

  if (retryPolicy !== undefined && value > retryPolicy.maxAttempts) {
    throw new TypeError("AttemptNumber must not exceed RetryPolicy.maxAttempts.");
  }

  return value as AttemptNumber;
}
