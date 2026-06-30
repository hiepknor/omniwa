import { describe, expect, it } from "vitest";

import { createMessageDirection } from "./message-direction.js";

describe("message direction", () => {
  it("requires explicit inbound or outbound direction", () => {
    expect(createMessageDirection("inbound")).toBe("inbound");
    expect(createMessageDirection("outbound")).toBe("outbound");
    expect(() => createMessageDirection("unknown")).toThrow(TypeError);
  });
});
