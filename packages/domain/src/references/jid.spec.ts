import { describe, expect, it } from "vitest";

import { createJid, redactJid } from "./jid.js";

describe("JID", () => {
  it("normalizes translated WhatsApp JID references", () => {
    expect(createJid("12345@S.WHATSAPP.NET")).toBe("12345@s.whatsapp.net");
    expect(createJid("group-1@G.US")).toBe("group-1@g.us");
  });

  it("redacts raw JID values", () => {
    expect(redactJid(createJid("12345@s.whatsapp.net"))).toBe("[confidential:jid]");
  });

  it("rejects unsupported JID formats", () => {
    expect(() => createJid("not-a-jid")).toThrow(TypeError);
    expect(() => createJid("12345@example.com")).toThrow(TypeError);
  });
});
