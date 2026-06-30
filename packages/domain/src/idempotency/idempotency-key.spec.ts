import { describe, expect, it } from "vitest";

import { createIdempotencyKey } from "./idempotency-key.js";

describe("IdempotencyKey", () => {
  it("creates safe duplicate-prevention keys", () => {
    expect(createIdempotencyKey("send-message:abc-123")).toBe("send-message:abc-123");
  });

  it("rejects keys that look like raw payload or unsafe references", () => {
    expect(() => createIdempotencyKey("hello world")).toThrow(TypeError);
    expect(() => createIdempotencyKey("123@s.whatsapp.net")).toThrow(TypeError);
  });
});
