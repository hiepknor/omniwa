import { describe, expect, it } from "vitest";

import { createDomainError } from "./domain-error.js";
import { createDomainErrorCategory } from "./domain-error-category.js";
import { createDomainOwnerContext } from "./domain-owner-context.js";
import { createFailureCategory } from "./failure-category.js";
import { createRecoverability } from "./recoverability.js";

describe("DomainError", () => {
  it("creates safe frozen domain errors with explicit ownership", () => {
    const error = createDomainError({
      category: "policy_violation",
      ownerContext: "guardrails",
      reasonCode: "unsupported_message_type",
      message: "Message type is not supported by the MVP.",
      recoverability: "caller_correctable",
      context: {
        message_type: "sticker",
        retryable: false,
      },
    });

    expect(error).toEqual({
      category: "policy_violation",
      ownerContext: "guardrails",
      reasonCode: "unsupported_message_type",
      message: "Message type is not supported by the MVP.",
      recoverability: "caller_correctable",
      context: {
        message_type: "sticker",
        retryable: false,
      },
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.context)).toBe(true);
  });

  it("rejects unsafe or ambiguous error values", () => {
    expect(() =>
      createDomainError({
        category: "http_500",
        ownerContext: "messaging",
        reasonCode: "provider-timeout",
        message: "Provider timeout.",
        recoverability: "time_correctable",
      }),
    ).toThrow(TypeError);

    expect(() =>
      createDomainError({
        category: "policy_violation",
        ownerContext: "messaging",
        reasonCode: "Provider Timeout",
        message: "Provider timeout.",
        recoverability: "time_correctable",
      }),
    ).toThrow(TypeError);

    expect(() =>
      createDomainError({
        category: "policy_violation",
        ownerContext: "messaging",
        reasonCode: "provider_timeout",
        message: "",
        recoverability: "time_correctable",
      }),
    ).toThrow(TypeError);
  });

  it("validates categories, owner contexts, failure categories, and recoverability", () => {
    expect(createDomainErrorCategory("identity_error")).toBe("identity_error");
    expect(createDomainOwnerContext("session")).toBe("session");
    expect(createFailureCategory("provider")).toBe("provider");
    expect(createRecoverability("terminal")).toBe("terminal");

    expect(() => createDomainErrorCategory("provider_exception")).toThrow(TypeError);
    expect(() => createDomainOwnerContext("api")).toThrow(TypeError);
    expect(() => createFailureCategory("baileys_raw_error")).toThrow(TypeError);
    expect(() => createRecoverability("retryable")).toThrow(TypeError);
  });
});
