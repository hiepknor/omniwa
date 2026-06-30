import { describe, expect, it } from "vitest";

import {
  applyAuditRedaction,
  expireAuditRetention,
  recordAuditEvidence,
  requestAuditRecord,
  retainAuditRecord,
} from "../audit/audit-record.js";
import {
  activateConfigurationSnapshot,
  proposeConfigurationSnapshot,
  rejectGuardrailBypassConfiguration,
  validateConfigurationSnapshot,
} from "../configuration/configuration-snapshot.js";
import {
  blockGuardrailDecision,
  passGuardrailDecision,
  requestGuardrailDecision,
} from "../guardrails/guardrail-decision.js";
import {
  classifyDegraded,
  createHealthStatus,
  markHealthRecovered,
} from "../health/health-status.js";
import {
  createAccessDecisionId,
  createAuditRecordId,
  createConfigurationSnapshotId,
  createGuardrailDecisionId,
  createHealthStatusId,
  createProviderId,
  createTelemetrySignalId,
} from "../identity/aggregate-ids.js";
import { createMessageType } from "../messaging/message-type.js";
import {
  dropTelemetrySignal,
  captureTelemetrySignal,
  projectTelemetrySignal,
  sanitizeTelemetrySignal,
} from "../observability/telemetry-signal.js";
import { createRetentionPolicy } from "../policies/retention-policy.js";
import {
  createProviderProfile,
  markProviderSupported,
  retireProviderProfile,
} from "../provider/provider-profile.js";
import {
  denyAccessDecision,
  grantAccessDecision,
  markPrivilegedAction,
  requestAccessDecision,
} from "../security/access-decision.js";

describe("operational aggregate roots", () => {
  it("requires explicit GuardrailDecision outcomes", () => {
    const decision = requestGuardrailDecision(
      createGuardrailDecisionId("guardrail_2"),
      "message_4",
    );
    const passed = passGuardrailDecision(decision, "safe_intent");
    const blocked = blockGuardrailDecision(
      requestGuardrailDecision(createGuardrailDecisionId("guardrail_3"), "message_5"),
      "unsupported_broadcast",
    );

    expect(passed.outcome).toBe("allow");
    expect(blocked.status).toBe("blocked");
    expect(blocked.outcome).toBe("block");
    expect(() => passGuardrailDecision(blocked, "later_safe")).toThrow(TypeError);
  });

  it("keeps ProviderProfile product-scoped and terminal when retired", () => {
    const profile = createProviderProfile(createProviderId("provider_1"), "baileys");
    const supported = markProviderSupported(profile, [
      createMessageType("text"),
      createMessageType("image"),
    ]);
    const retired = retireProviderProfile(supported);

    expect(supported.status).toBe("supported");
    expect(supported.supportedMessageTypes).toEqual(["text", "image"]);
    expect(() => markProviderSupported(retired, [createMessageType("text")])).toThrow(TypeError);
  });

  it("tracks AccessDecision outcomes and privileged audit eligibility", () => {
    const decision = requestAccessDecision(
      createAccessDecisionId("access_1"),
      "operator_1",
      "delete_instance",
    );
    const privileged = markPrivilegedAction(decision);
    const granted = grantAccessDecision(privileged);
    const denied = denyAccessDecision(
      requestAccessDecision(createAccessDecisionId("access_2"), "operator_2", "read_secret"),
    );

    expect(granted.outcome).toBe("granted");
    expect(granted.auditEligible).toBe(true);
    expect(denied.outcome).toBe("denied");
    expect(() => denyAccessDecision(granted)).toThrow(TypeError);
  });

  it("keeps AuditRecord evidence secret-safe and retention-bound", () => {
    const record = requestAuditRecord(
      createAuditRecordId("audit_1"),
      "instance_destroyed",
      createRetentionPolicy({ category: "audit_record", retentionDays: 90 }),
    );
    const expired = expireAuditRetention(
      retainAuditRecord(applyAuditRedaction(recordAuditEvidence(record, "operator_action"))),
    );

    expect(expired.status).toBe("retention_expired");
    expect(expired.redacted).toBe(true);
    expect(() => recordAuditEvidence(record, "raw secret value")).toThrow(TypeError);
  });

  it("classifies HealthStatus without mutating source business state", () => {
    const health = createHealthStatus(createHealthStatusId("health_1"), "provider_account");
    const recovered = markHealthRecovered(classifyDegraded(health, "provider"));

    expect(recovered.category).toBe("recovered");
    expect(recovered.causeCategory).toBe("provider");
    expect(recovered.domainEvents.map((event) => event.name)).toContain("HealthRecovered");
  });

  it("rejects unsafe ConfigurationSnapshot activation", () => {
    const safe = proposeConfigurationSnapshot(createConfigurationSnapshotId("config_1"), "valid");
    const active = activateConfigurationSnapshot(validateConfigurationSnapshot(safe));
    const rejected = rejectGuardrailBypassConfiguration(
      proposeConfigurationSnapshot(
        createConfigurationSnapshotId("config_2"),
        "guardrail_bypass_rejected",
      ),
    );

    expect(active.status).toBe("active");
    expect(rejected.status).toBe("rejected");
    expect(() =>
      validateConfigurationSnapshot(
        proposeConfigurationSnapshot(createConfigurationSnapshotId("config_3"), "unsafe"),
      ),
    ).toThrow(TypeError);
  });

  it("keeps TelemetrySignal sanitized before projection", () => {
    const signal = captureTelemetrySignal(createTelemetrySignalId("telemetry_1"), "message_failed");
    const projected = projectTelemetrySignal(sanitizeTelemetrySignal(signal));
    const dropped = dropTelemetrySignal(
      captureTelemetrySignal(createTelemetrySignalId("telemetry_2"), "provider_failure"),
    );

    expect(projected.status).toBe("projected");
    expect(projected.redacted).toBe(true);
    expect(dropped.status).toBe("dropped");
    expect(() => dropTelemetrySignal(projected)).toThrow(TypeError);
  });
});
