import { describe, expect, it } from "vitest";

import { nullLogger } from "./logger.js";

describe("logger contract", () => {
  it("provides a no-op logger for tests and bootstrap wiring", () => {
    expect(() => {
      nullLogger.write({ level: "info", message: "safe message" });
    }).not.toThrow();
  });
});
