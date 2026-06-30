import { describe, expect, it } from "vitest";

import { isErr, isOk } from "@omniwa/shared";

import { fail, OmniwaError, safeMetadata, succeed } from "./index.js";

describe("OmniwaError", () => {
  it("returns a safe shape without raw cause", () => {
    const error = new OmniwaError({
      category: "provider",
      code: "provider.unavailable",
      message: "Provider unavailable.",
      metadata: safeMetadata({ provider: "baileys", attempt: 1 }),
      cause: new Error("raw provider stack"),
    });

    expect(error.toSafeShape()).toEqual({
      category: "provider",
      code: "provider.unavailable",
      message: "Provider unavailable.",
      retryable: false,
      metadata: { provider: "baileys", attempt: 1 },
    });
  });

  it("creates result helpers", () => {
    expect(isErr(fail({ category: "validation", code: "invalid", message: "Invalid." }))).toBe(
      true,
    );
    expect(isOk(succeed("ok"))).toBe(true);
  });
});
