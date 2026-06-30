import { describe, expect, it } from "vitest";

import { createWebhookUrl } from "./webhook-url.js";

describe("WebhookUrl", () => {
  it("normalizes http and https webhook URLs", () => {
    expect(createWebhookUrl("https://example.com/webhook")).toBe("https://example.com/webhook");
    expect(createWebhookUrl("http://localhost:3000/webhook")).toBe("http://localhost:3000/webhook");
  });

  it("rejects unsupported protocols and URL credential leaks", () => {
    expect(() => createWebhookUrl("ftp://example.com/webhook")).toThrow(TypeError);
    expect(() => createWebhookUrl("https://user:pass@example.com/webhook")).toThrow(TypeError);
    expect(() => createWebhookUrl("https://example.com/webhook#secret")).toThrow(TypeError);
  });
});
