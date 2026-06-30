import { describe, expect, it } from "vitest";

import { classifyValue, redactValue, toSafeLogFields } from "./index.js";

describe("redaction", () => {
  it("passes public and internal values through safe normalization", () => {
    expect(redactValue(classifyValue("status-ok", "public"))).toBe("status-ok");
    expect(redactValue(classifyValue(3, "internal"))).toBe(3);
  });

  it("redacts confidential and secret values", () => {
    expect(redactValue(classifyValue("synthetic-phone", "confidential"))).toBe(
      "[redacted:confidential]",
    );
    expect(redactValue(classifyValue("synthetic-secret", "secret"))).toBe("[redacted:secret]");
  });

  it("creates immutable safe log fields", () => {
    const fields = toSafeLogFields({
      status: classifyValue("queued", "public"),
      apiKey: classifyValue("synthetic-api-key", "secret"),
    });

    expect(fields).toEqual({
      status: "queued",
      apiKey: "[redacted:secret]",
    });
    expect(Object.isFrozen(fields)).toBe(true);
  });
});
