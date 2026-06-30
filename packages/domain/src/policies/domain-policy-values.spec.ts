import { describe, expect, it } from "vitest";

import { createAccessOutcome } from "./access-outcome.js";
import { createAttemptNumber } from "./attempt-number.js";
import { createDeadLetterReason } from "./dead-letter-reason.js";
import { createGuardrailOutcome } from "./guardrail-outcome.js";
import { createRetentionPolicy } from "./retention-policy.js";
import { createRetryPolicy } from "./retry-policy.js";

describe("domain policy value objects", () => {
  it("creates bounded attempt numbers tied to retry policy", () => {
    const retryPolicy = createRetryPolicy({
      maxAttempts: 3,
      initialDelayMilliseconds: 500,
      backoffMultiplier: 2,
    });

    expect(createAttemptNumber(1, retryPolicy)).toBe(1);
    expect(createAttemptNumber(3, retryPolicy)).toBe(3);
    expect(() => createAttemptNumber(0, retryPolicy)).toThrow(TypeError);
    expect(() => createAttemptNumber(4, retryPolicy)).toThrow(TypeError);
  });

  it("creates safe dead-letter reasons without raw payload data", () => {
    const reason = createDeadLetterReason({
      code: "webhook_receiver_unavailable",
      category: "webhook",
    });

    expect(reason).toEqual({
      code: "webhook_receiver_unavailable",
      category: "webhook",
    });
    expect(Object.isFrozen(reason)).toBe(true);
    expect(() =>
      createDeadLetterReason({
        code: "POST https://example.test/fail",
        category: "webhook",
      }),
    ).toThrow(TypeError);
  });

  it("creates bounded retention policies", () => {
    const policy = createRetentionPolicy({
      category: "webhook_delivery",
      retentionDays: 30,
    });

    expect(policy).toEqual({
      category: "webhook_delivery",
      retentionDays: 30,
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() =>
      createRetentionPolicy({
        category: "message_body",
        retentionDays: 30,
      }),
    ).toThrow(TypeError);
    expect(() =>
      createRetentionPolicy({
        category: "webhook_delivery",
        retentionDays: -1,
      }),
    ).toThrow(TypeError);
  });

  it("creates product-level guardrail and access decisions", () => {
    expect(createGuardrailOutcome("allow")).toBe("allow");
    expect(createGuardrailOutcome("action_required")).toBe("action_required");
    expect(createAccessOutcome("granted")).toBe("granted");
    expect(createAccessOutcome("denied")).toBe("denied");

    expect(() => createGuardrailOutcome("bypass")).toThrow(TypeError);
    expect(() => createAccessOutcome("admin")).toThrow(TypeError);
  });
});
