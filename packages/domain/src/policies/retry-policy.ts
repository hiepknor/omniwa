export type RetryPolicy = Readonly<{
  maxAttempts: number;
  initialDelayMilliseconds: number;
  backoffMultiplier: number;
}>;

export function createRetryPolicy(input: RetryPolicy): RetryPolicy {
  assertPositiveInteger(input.maxAttempts, "RetryPolicy.maxAttempts");
  assertNonNegativeInteger(input.initialDelayMilliseconds, "RetryPolicy.initialDelayMilliseconds");

  if (!Number.isFinite(input.backoffMultiplier) || input.backoffMultiplier < 1) {
    throw new TypeError("RetryPolicy.backoffMultiplier must be finite and at least 1.");
  }

  return Object.freeze({ ...input });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}
