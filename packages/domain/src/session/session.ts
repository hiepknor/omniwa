import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { InstanceId, SessionId } from "../identity/aggregate-ids.js";
import type { RetentionPolicy } from "../policies/retention-policy.js";
import type { SessionStatus } from "../status/session-status.js";

const sessionTransitions: StatusTransitionMap<SessionStatus> = {
  empty: ["pending", "cleanup"],
  pending: ["active", "expired", "revoked", "cleanup"],
  active: ["expired", "revoked", "cleanup"],
  expired: ["pending", "revoked", "cleanup"],
  revoked: ["cleanup"],
  cleanup: [],
};

export type Session = Readonly<{
  id: SessionId;
  instanceId: InstanceId;
  status: SessionStatus;
  requiresRecovery: boolean;
  retentionPolicy?: RetentionPolicy;
  domainEvents: readonly DomainEvent[];
}>;

export function createSession(id: SessionId, instanceId: InstanceId): Session {
  return freezeSession({
    id,
    instanceId,
    status: "empty",
    requiresRecovery: false,
    domainEvents: [],
  });
}

export function startSessionPairing(session: Session): Session {
  return transitionSession(session, "pending", "SessionPairingStarted", {
    requiresRecovery: false,
  });
}

export function markSessionPending(session: Session): Session {
  return transitionSession(session, "pending", "SessionPending");
}

export function activateSession(session: Session): Session {
  return transitionSession(session, "active", "SessionActivated", { requiresRecovery: false });
}

export function expireSession(session: Session): Session {
  return transitionSession(session, "expired", "SessionExpired", { requiresRecovery: true });
}

export function revokeSession(session: Session): Session {
  return transitionSession(session, "revoked", "SessionRevoked", { requiresRecovery: true });
}

export function requireSessionRecovery(session: Session): Session {
  return freezeSession({
    ...session,
    requiresRecovery: true,
    domainEvents: appendDomainEvent(
      session.domainEvents,
      "Session",
      session.id,
      "SessionRecoveryRequired",
    ),
  });
}

export function cleanupSession(session: Session, retentionPolicy?: RetentionPolicy): Session {
  return transitionSession(session, "cleanup", "SessionCleaned", { retentionPolicy });
}

export function isSessionSendCapable(session: Session): boolean {
  return session.status === "active";
}

function transitionSession(
  session: Session,
  status: SessionStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    requiresRecovery?: boolean;
    retentionPolicy?: RetentionPolicy | undefined;
  }> = {},
): Session {
  const retentionPatch =
    "retentionPolicy" in patch
      ? patch.retentionPolicy === undefined
        ? {}
        : { retentionPolicy: patch.retentionPolicy }
      : session.retentionPolicy === undefined
        ? {}
        : { retentionPolicy: session.retentionPolicy };

  return freezeSession({
    id: session.id,
    instanceId: session.instanceId,
    status: transitionStatus(session.status, status, sessionTransitions, "Session"),
    requiresRecovery: patch.requiresRecovery ?? session.requiresRecovery,
    ...retentionPatch,
    domainEvents: appendDomainEvent(session.domainEvents, "Session", session.id, eventName),
  });
}

function freezeSession(session: Session): Session {
  return Object.freeze(session);
}
