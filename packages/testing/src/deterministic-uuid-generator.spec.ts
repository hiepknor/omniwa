import { describe, expect, it } from "vitest";

import { DeterministicUUIDGenerator } from "./deterministic-uuid-generator.js";

describe("DeterministicUUIDGenerator", () => {
  it("returns UUID values in order", () => {
    const generator = new DeterministicUUIDGenerator([
      "550e8400-e29b-41d4-a716-446655440000",
      "550e8400-e29b-41d4-a716-446655440001",
    ]);

    expect(generator.random()).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(generator.random()).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(() => generator.random()).toThrow("DeterministicUUIDGenerator exhausted.");
  });
});
