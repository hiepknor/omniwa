import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { ConfigurationSnapshotId } from "../identity/aggregate-ids.js";
import type { ConfigurationSafety } from "../status/configuration-safety.js";
import type { ConfigurationSnapshotStatus } from "../status/configuration-snapshot-status.js";

const configurationSnapshotTransitions: StatusTransitionMap<ConfigurationSnapshotStatus> = {
  proposed: ["validated", "rejected"],
  validated: ["active", "rejected", "retired"],
  rejected: ["retired"],
  active: ["superseded", "retired"],
  superseded: ["retired"],
  retired: [],
};

export type ConfigurationSnapshot = Readonly<{
  id: ConfigurationSnapshotId;
  status: ConfigurationSnapshotStatus;
  safety: ConfigurationSafety;
  auditEligible: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function proposeConfigurationSnapshot(
  id: ConfigurationSnapshotId,
  safety: ConfigurationSafety,
): ConfigurationSnapshot {
  return freezeConfigurationSnapshot({
    id,
    status: "proposed",
    safety,
    auditEligible: false,
    domainEvents: [],
  });
}

export function validateConfigurationSnapshot(
  snapshot: ConfigurationSnapshot,
): ConfigurationSnapshot {
  if (snapshot.safety !== "valid") {
    throw new TypeError("Only valid configuration can be validated.");
  }

  return transitionConfigurationSnapshot(snapshot, "validated", "ConfigurationValidated");
}

export function rejectConfigurationSnapshot(
  snapshot: ConfigurationSnapshot,
): ConfigurationSnapshot {
  return transitionConfigurationSnapshot(snapshot, "rejected", "ConfigurationRejected", {
    auditEligible: true,
  });
}

export function rejectGuardrailBypassConfiguration(
  snapshot: ConfigurationSnapshot,
): ConfigurationSnapshot {
  if (snapshot.safety !== "guardrail_bypass_rejected") {
    throw new TypeError("ConfigurationSnapshot must be classified as guardrail bypass rejected.");
  }

  return transitionConfigurationSnapshot(
    snapshot,
    "rejected",
    "ConfigurationGuardrailBypassRejected",
    { auditEligible: true },
  );
}

export function activateConfigurationSnapshot(
  snapshot: ConfigurationSnapshot,
): ConfigurationSnapshot {
  if (snapshot.status !== "validated" || snapshot.safety !== "valid") {
    throw new TypeError("Only validated safe configuration can become active.");
  }

  return transitionConfigurationSnapshot(snapshot, "active", "ConfigurationActivated");
}

export function supersedeConfigurationSnapshot(
  snapshot: ConfigurationSnapshot,
): ConfigurationSnapshot {
  return transitionConfigurationSnapshot(snapshot, "superseded", "ConfigurationSuperseded");
}

function transitionConfigurationSnapshot(
  snapshot: ConfigurationSnapshot,
  status: ConfigurationSnapshotStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{ auditEligible?: boolean }> = {},
): ConfigurationSnapshot {
  return freezeConfigurationSnapshot({
    id: snapshot.id,
    status: transitionStatus(
      snapshot.status,
      status,
      configurationSnapshotTransitions,
      "ConfigurationSnapshot",
    ),
    safety: snapshot.safety,
    auditEligible: patch.auditEligible ?? snapshot.auditEligible,
    domainEvents: appendDomainEvent(
      snapshot.domainEvents,
      "ConfigurationSnapshot",
      snapshot.id,
      eventName,
    ),
  });
}

function freezeConfigurationSnapshot(snapshot: ConfigurationSnapshot): ConfigurationSnapshot {
  return Object.freeze(snapshot);
}
