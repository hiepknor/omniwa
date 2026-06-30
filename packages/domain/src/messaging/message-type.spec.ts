import { describe, expect, it } from "vitest";

import {
  createMessageType,
  isSupportedMessageType,
  supportedMessageTypes,
} from "./message-type.js";

describe("message type", () => {
  it("allows only frozen MVP message types", () => {
    expect(supportedMessageTypes).toEqual(["text", "image", "video", "document", "audio"]);
    expect(createMessageType("text")).toBe("text");
    expect(createMessageType("image")).toBe("image");
    expect(createMessageType("video")).toBe("video");
    expect(createMessageType("document")).toBe("document");
    expect(createMessageType("audio")).toBe("audio");
  });

  it("rejects unsupported message types", () => {
    expect(isSupportedMessageType("sticker")).toBe(false);
    expect(() => createMessageType("reaction")).toThrow(TypeError);
    expect(() => createMessageType("location")).toThrow(TypeError);
  });
});
