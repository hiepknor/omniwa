import { describe, expect, it } from "vitest";

import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("returns deterministic time and can advance", () => {
    const clock = new FakeClock("2026-06-30T00:00:00.000Z");

    clock.advanceMilliseconds(1000);

    expect(clock.isoNow()).toBe("2026-06-30T00:00:01.000Z");
    expect(clock.epochMilliseconds()).toBe(1782777601000);
  });
});
