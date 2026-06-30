import { describe, expect, it } from "vitest";

import { createRetryPolicy } from "./retry-policy.js";

describe("RetryPolicy", () => {
  it("creates finite bounded retry policy values", () => {
    const policy = createRetryPolicy({
      maxAttempts: 3,
      initialDelayMilliseconds: 1000,
      backoffMultiplier: 2,
    });

    expect(policy).toEqual({
      maxAttempts: 3,
      initialDelayMilliseconds: 1000,
      backoffMultiplier: 2,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("rejects unbounded or invalid retry values", () => {
    expect(() =>
      createRetryPolicy({
        maxAttempts: 0,
        initialDelayMilliseconds: 1000,
        backoffMultiplier: 2,
      }),
    ).toThrow(TypeError);

    expect(() =>
      createRetryPolicy({
        maxAttempts: 3,
        initialDelayMilliseconds: -1,
        backoffMultiplier: 2,
      }),
    ).toThrow(TypeError);

    expect(() =>
      createRetryPolicy({
        maxAttempts: 3,
        initialDelayMilliseconds: 1000,
        backoffMultiplier: 0,
      }),
    ).toThrow(TypeError);
  });
});
