import { describe, expect, it } from "vitest";

import { createMediaCategory } from "./media-category.js";

describe("media category", () => {
  it("allows only MVP supported media categories", () => {
    expect(createMediaCategory("image")).toBe("image");
    expect(createMediaCategory("video")).toBe("video");
    expect(createMediaCategory("document")).toBe("document");
    expect(createMediaCategory("audio")).toBe("audio");
  });

  it("rejects unsupported media categories", () => {
    expect(() => createMediaCategory("sticker")).toThrow(TypeError);
    expect(() => createMediaCategory("contact")).toThrow(TypeError);
  });
});
