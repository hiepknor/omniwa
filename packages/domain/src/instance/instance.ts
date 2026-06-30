import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { InstanceId, SessionId } from "../identity/aggregate-ids.js";
import type { InstanceStatus } from "../status/instance-status.js";

const instanceTransitions: StatusTransitionMap<InstanceStatus> = {
  created: ["connecting", "destroyed"],
  connecting: [
    "qr_pending",
    "connected",
    "disconnected",
    "logged_out",
    "action_required",
    "destroyed",
  ],
  qr_pending: ["connected", "disconnected", "logged_out", "action_required", "destroyed"],
  connected: ["disconnected", "logged_out", "action_required", "destroyed"],
  disconnected: ["connecting", "connected", "logged_out", "action_required", "destroyed"],
  logged_out: ["connecting", "action_required", "destroyed"],
  action_required: ["connecting", "disconnected", "logged_out", "destroyed"],
  destroyed: [],
};

export type Instance = Readonly<{
  id: InstanceId;
  status: InstanceStatus;
  currentSessionId?: SessionId;
  actionRequiredReason?: string;
  domainEvents: readonly DomainEvent[];
}>;

export function createInstance(id: InstanceId): Instance {
  return freezeInstance({
    id,
    status: "created",
    domainEvents: appendDomainEvent([], "Instance", id, "InstanceCreated"),
  });
}

export function markInstanceConnecting(instance: Instance): Instance {
  return transitionInstance(instance, "connecting");
}

export function markInstanceQrPending(instance: Instance): Instance {
  return transitionInstance(instance, "qr_pending", "InstanceQrRequired");
}

export function markInstanceConnected(instance: Instance, currentSessionId: SessionId): Instance {
  return transitionInstance(instance, "connected", "InstanceConnected", {
    currentSessionId,
    actionRequiredReason: undefined,
  });
}

export function markInstanceDisconnected(instance: Instance): Instance {
  return transitionInstance(instance, "disconnected", "InstanceDisconnected", {
    currentSessionId: undefined,
  });
}

export function markInstanceLoggedOut(instance: Instance, reasonCode: string): Instance {
  return transitionInstance(instance, "logged_out", "InstanceLoggedOut", {
    currentSessionId: undefined,
    actionRequiredReason: createSafeDomainCode(reasonCode, "Instance.actionRequiredReason"),
  });
}

export function requireInstanceAction(instance: Instance, reasonCode: string): Instance {
  return transitionInstance(instance, "action_required", "InstanceActionRequired", {
    actionRequiredReason: createSafeDomainCode(reasonCode, "Instance.actionRequiredReason"),
  });
}

export function destroyInstance(instance: Instance): Instance {
  return transitionInstance(instance, "destroyed", "InstanceDestroyed", {
    currentSessionId: undefined,
  });
}

function transitionInstance(
  instance: Instance,
  status: InstanceStatus,
  eventName?: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{
    currentSessionId?: SessionId | undefined;
    actionRequiredReason?: string | undefined;
  }> = {},
): Instance {
  const nextStatus = transitionStatus(instance.status, status, instanceTransitions, "Instance");
  const currentSessionPatch =
    "currentSessionId" in patch
      ? patch.currentSessionId === undefined
        ? {}
        : { currentSessionId: patch.currentSessionId }
      : instance.currentSessionId === undefined
        ? {}
        : { currentSessionId: instance.currentSessionId };
  const actionReasonPatch =
    "actionRequiredReason" in patch
      ? patch.actionRequiredReason === undefined
        ? {}
        : { actionRequiredReason: patch.actionRequiredReason }
      : instance.actionRequiredReason === undefined
        ? {}
        : { actionRequiredReason: instance.actionRequiredReason };

  return freezeInstance({
    id: instance.id,
    status: nextStatus,
    ...currentSessionPatch,
    ...actionReasonPatch,
    domainEvents:
      eventName === undefined
        ? instance.domainEvents
        : appendDomainEvent(instance.domainEvents, "Instance", instance.id, eventName),
  });
}

function freezeInstance(instance: Instance): Instance {
  return Object.freeze(instance);
}
