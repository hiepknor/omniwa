import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { GuardrailDecisionId } from "../identity/aggregate-ids.js";
import type { GuardrailOutcome } from "../policies/guardrail-outcome.js";
import type { GuardrailDecisionStatus } from "../status/guardrail-decision-status.js";

const guardrailDecisionTransitions: StatusTransitionMap<GuardrailDecisionStatus> = {
  requested: ["evaluated", "passed", "blocked", "throttled", "action_required", "expired"],
  evaluated: ["passed", "blocked", "throttled", "action_required", "expired"],
  passed: ["expired"],
  blocked: ["expired"],
  throttled: ["expired"],
  action_required: ["expired"],
  expired: [],
};

export type GuardrailDecision = Readonly<{
  id: GuardrailDecisionId;
  evaluatedIntentRef: string;
  status: GuardrailDecisionStatus;
  outcome?: GuardrailOutcome;
  reasonCode?: string;
  domainEvents: readonly DomainEvent[];
}>;

export function requestGuardrailDecision(
  id: GuardrailDecisionId,
  evaluatedIntentRef: string,
): GuardrailDecision {
  return freezeGuardrailDecision({
    id,
    evaluatedIntentRef: createSafeDomainCode(
      evaluatedIntentRef,
      "GuardrailDecision.evaluatedIntentRef",
    ),
    status: "requested",
    domainEvents: [],
  });
}

export function evaluateGuardrailDecision(decision: GuardrailDecision): GuardrailDecision {
  return transitionGuardrailDecision(decision, "evaluated", "GuardrailEvaluated");
}

export function passGuardrailDecision(
  decision: GuardrailDecision,
  reasonCode: string,
): GuardrailDecision {
  return transitionGuardrailDecision(decision, "passed", "GuardrailPassed", {
    outcome: "allow",
    reasonCode,
  });
}

export function blockGuardrailDecision(
  decision: GuardrailDecision,
  reasonCode: string,
): GuardrailDecision {
  return transitionGuardrailDecision(decision, "blocked", "GuardrailBlocked", {
    outcome: "block",
    reasonCode,
  });
}

export function throttleGuardrailDecision(
  decision: GuardrailDecision,
  reasonCode: string,
): GuardrailDecision {
  return transitionGuardrailDecision(decision, "throttled", "GuardrailThrottled", {
    outcome: "throttle",
    reasonCode,
  });
}

export function requireGuardrailAction(
  decision: GuardrailDecision,
  reasonCode: string,
): GuardrailDecision {
  return transitionGuardrailDecision(decision, "action_required", "GuardrailActionRequired", {
    outcome: "action_required",
    reasonCode,
  });
}

function transitionGuardrailDecision(
  decision: GuardrailDecision,
  status: GuardrailDecisionStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    outcome?: GuardrailOutcome;
    reasonCode?: string;
  }> = {},
): GuardrailDecision {
  return freezeGuardrailDecision({
    id: decision.id,
    evaluatedIntentRef: decision.evaluatedIntentRef,
    status: transitionStatus(
      decision.status,
      status,
      guardrailDecisionTransitions,
      "GuardrailDecision",
    ),
    ...optionalValue("outcome", patch.outcome, decision.outcome),
    ...optionalValue(
      "reasonCode",
      patch.reasonCode === undefined
        ? undefined
        : createSafeDomainCode(patch.reasonCode, "GuardrailDecision.reasonCode"),
      decision.reasonCode,
    ),
    domainEvents: appendDomainEvent(
      decision.domainEvents,
      "GuardrailDecision",
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

function freezeGuardrailDecision(decision: GuardrailDecision): GuardrailDecision {
  return Object.freeze(decision);
}
