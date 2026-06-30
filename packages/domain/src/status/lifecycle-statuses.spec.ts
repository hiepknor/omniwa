import { describe, expect, it } from "vitest";

import { createConfigurationSafety } from "./configuration-safety.js";
import { createGroupStatus } from "./group-status.js";
import { createHealthCategory } from "./health-category.js";
import { createInstanceStatus } from "./instance-status.js";
import { createJobStatus } from "./job-status.js";
import { createMessageStatus } from "./message-status.js";
import { createSessionStatus } from "./session-status.js";
import { createWebhookDeliveryStatus } from "./webhook-delivery-status.js";

describe("lifecycle status value objects", () => {
  it("creates approved product lifecycle statuses", () => {
    expect(createInstanceStatus("qr_pending")).toBe("qr_pending");
    expect(createSessionStatus("active")).toBe("active");
    expect(createMessageStatus("evaluated")).toBe("evaluated");
    expect(createMessageStatus("sent")).toBe("sent");
    expect(createGroupStatus("active")).toBe("active");
    expect(createWebhookDeliveryStatus("dead_letter")).toBe("dead_letter");
    expect(createJobStatus("reserved")).toBe("reserved");
  });

  it("rejects provider-native or unapproved lifecycle statuses", () => {
    expect(() => createInstanceStatus("open")).toThrow(TypeError);
    expect(() => createSessionStatus("baileys_connected")).toThrow(TypeError);
    expect(() => createMessageStatus("provider_acknowledged")).toThrow(TypeError);
    expect(() => createGroupStatus("baileys_group_open")).toThrow(TypeError);
    expect(() => createWebhookDeliveryStatus("http_500")).toThrow(TypeError);
    expect(() => createJobStatus("bullmq_failed")).toThrow(TypeError);
  });

  it("creates operational status classifications without infrastructure payloads", () => {
    expect(createHealthCategory("degraded")).toBe("degraded");
    expect(createHealthCategory("action_required")).toBe("action_required");
    expect(createConfigurationSafety("valid")).toBe("valid");
    expect(createConfigurationSafety("guardrail_bypass_rejected")).toBe(
      "guardrail_bypass_rejected",
    );

    expect(() => createHealthCategory("postgres_down")).toThrow(TypeError);
    expect(() => createConfigurationSafety("env_parse_exception")).toThrow(TypeError);
  });
});
