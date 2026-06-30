import { describe, expect, it } from "vitest";

import { createConfigurationKey } from "./configuration-key.js";

describe("configuration key", () => {
  it("creates a non-empty configuration key", () => {
    expect(createConfigurationKey("runtime.node_env")).toBe("runtime.node_env");
    expect(() => createConfigurationKey(" ")).toThrow(TypeError);
  });
});
