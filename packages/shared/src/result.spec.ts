import { describe, expect, it } from "vitest";

import { err, isErr, isOk, mapResult, ok } from "./result.js";

describe("result primitives", () => {
  it("maps an ok result", () => {
    const result = mapResult(ok(2), (value) => value * 2);

    expect(isOk(result)).toBe(true);
    expect(result).toEqual(ok(4));
  });

  it("preserves an err result", () => {
    const result = mapResult(err("failure"), (value: number) => value * 2);

    expect(isErr(result)).toBe(true);
    expect(result).toEqual(err("failure"));
  });
});
