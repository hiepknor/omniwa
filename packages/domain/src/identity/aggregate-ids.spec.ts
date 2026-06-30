import { describe, expect, it } from "vitest";

import {
  createAccessDecisionId,
  createAuditRecordId,
  createConfigurationSnapshotId,
  createGuardrailDecisionId,
  createHealthStatusId,
  createInstanceId,
  createJobId,
  createMediaId,
  createMessageId,
  createProviderId,
  createSessionId,
  createTelemetrySignalId,
  createWebhookDeliveryId,
  createWebhookId,
} from "./aggregate-ids.js";

describe("aggregate identities", () => {
  it("creates opaque product identities", () => {
    expect(createInstanceId("inst_01")).toBe("inst_01");
    expect(createSessionId("sess_01")).toBe("sess_01");
    expect(createMessageId("msg_01")).toBe("msg_01");
    expect(createMediaId("media_01")).toBe("media_01");
    expect(createWebhookId("webhook_01")).toBe("webhook_01");
    expect(createWebhookDeliveryId("webhook-delivery_01")).toBe("webhook-delivery_01");
    expect(createGuardrailDecisionId("guardrail_01")).toBe("guardrail_01");
    expect(createProviderId("provider.baileys")).toBe("provider.baileys");
    expect(createJobId("job_01")).toBe("job_01");
    expect(createAccessDecisionId("access_01")).toBe("access_01");
    expect(createAuditRecordId("audit_01")).toBe("audit_01");
    expect(createHealthStatusId("health_01")).toBe("health_01");
    expect(createConfigurationSnapshotId("config_01")).toBe("config_01");
    expect(createTelemetrySignalId("telemetry_01")).toBe("telemetry_01");
  });

  it("rejects obvious raw confidential references as identities", () => {
    expect(() => createInstanceId("123@s.whatsapp.net")).toThrow(TypeError);
    expect(() => createMessageId("+15555550123")).toThrow(TypeError);
    expect(() => createJobId("queue/job/1")).toThrow(TypeError);
  });
});
