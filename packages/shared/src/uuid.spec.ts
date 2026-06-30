import { describe, expect, it } from "vitest";

import { createUuid, cryptoUUIDGenerator, isUuid } from "./uuid.js";

describe("uuid primitives", () => {
  it("normalizes valid UUID values", () => {
    expect(createUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("rejects invalid UUID values", () => {
    expect(() => createUuid("not-a-uuid")).toThrow(TypeError);
  });

  it("generates valid UUID values", () => {
    expect(isUuid(cryptoUUIDGenerator.random())).toBe(true);
  });
});
