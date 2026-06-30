import { describe, expect, it } from "vitest";

import { toIsoTimestamp } from "./clock.js";

describe("clock primitives", () => {
  it("creates an ISO timestamp from a date", () => {
    expect(toIsoTimestamp(new Date("2026-06-30T00:00:00.000Z"))).toBe("2026-06-30T00:00:00.000Z");
  });
});
