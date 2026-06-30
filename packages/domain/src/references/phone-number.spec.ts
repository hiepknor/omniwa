import { describe, expect, it } from "vitest";

import { createPhoneNumber, redactPhoneNumber } from "./phone-number.js";

describe("PhoneNumber", () => {
  it("normalizes E.164-like phone references", () => {
    expect(createPhoneNumber("+1 (555) 555-0123")).toBe("+15555550123");
  });

  it("redacts raw phone values", () => {
    expect(redactPhoneNumber(createPhoneNumber("+15555550123"))).toBe(
      "[confidential:phone-number]",
    );
  });

  it("rejects invalid phone references", () => {
    expect(() => createPhoneNumber("555-0123")).toThrow(TypeError);
    expect(() => createPhoneNumber("+01234567")).toThrow(TypeError);
  });
});
