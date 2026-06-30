import { describe, expect, it } from "vitest";

import { isErrorCategory } from "./error-category.js";

describe("error categories", () => {
  it("recognizes approved categories", () => {
    expect(isErrorCategory("provider")).toBe(true);
    expect(isErrorCategory("http")).toBe(false);
  });
});
