import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { AccessDecisionId } from "../identity/aggregate-ids.js";
import type { AccessOutcome } from "../policies/access-outcome.js";
import type { AccessDecisionStatus } from "../status/access-decision-status.js";

const accessDecisionTransitions: StatusTransitionMap<AccessDecisionStatus> = {
  requested: ["granted", "denied", "expired"],
  granted: ["expired"],
  denied: ["expired"],
  expired: [],
};

export type AccessDecision = Readonly<{
  id: AccessDecisionId;
  actorRef: string;
  capability: string;
  status: AccessDecisionStatus;
  outcome?: AccessOutcome;
  privileged: boolean;
  auditEligible: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function requestAccessDecision(
  id: AccessDecisionId,
  actorRef: string,
  capability: string,
): AccessDecision {
  return freezeAccessDecision({
    id,
    actorRef: createSafeDomainCode(actorRef, "AccessDecision.actorRef"),
    capability: createSafeDomainCode(capability, "AccessDecision.capability"),
    status: "requested",
    privileged: false,
    auditEligible: false,
    domainEvents: [],
  });
}

export function grantAccessDecision(decision: AccessDecision): AccessDecision {
  return transitionAccessDecision(decision, "granted", "AccessGranted", { outcome: "granted" });
}

export function denyAccessDecision(decision: AccessDecision): AccessDecision {
  return transitionAccessDecision(decision, "denied", "AccessDenied", { outcome: "denied" });
}

export function markPrivilegedAction(decision: AccessDecision): AccessDecision {
  return freezeAccessDecision({
    ...decision,
    privileged: true,
    auditEligible: true,
    domainEvents: appendDomainEvent(
      decision.domainEvents,
      "AccessDecision",
      decision.id,
      "PrivilegedActionMarked",
    ),
  });
}

export function expireAccessDecision(decision: AccessDecision): AccessDecision {
  return transitionAccessDecision(decision, "expired", "AccessDecisionExpired");
}

function transitionAccessDecision(
  decision: AccessDecision,
  status: AccessDecisionStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{ outcome?: AccessOutcome }> = {},
): AccessDecision {
  return freezeAccessDecision({
    id: decision.id,
    actorRef: decision.actorRef,
    capability: decision.capability,
    status: transitionStatus(decision.status, status, accessDecisionTransitions, "AccessDecision"),
    privileged: decision.privileged,
    auditEligible: decision.auditEligible,
    ...optionalValue("outcome", patch.outcome, decision.outcome),
    domainEvents: appendDomainEvent(
      decision.domainEvents,
      "AccessDecision",
      decision.id,
      eventName,
    ),
  });
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  nextValue: TValue | undefined,
  currentValue: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  const value = nextValue ?? currentValue;
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeAccessDecision(decision: AccessDecision): AccessDecision {
  return Object.freeze(decision);
}
