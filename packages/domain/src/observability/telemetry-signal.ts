import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { TelemetrySignalId } from "../identity/aggregate-ids.js";
import type { TelemetrySignalStatus } from "../status/telemetry-signal-status.js";

const telemetrySignalTransitions: StatusTransitionMap<TelemetrySignalStatus> = {
  captured: ["sanitized", "dropped"],
  sanitized: ["projected", "dropped"],
  projected: [],
  dropped: [],
};

export type TelemetrySignal = Readonly<{
  id: TelemetrySignalId;
  sourceContextRef: string;
  status: TelemetrySignalStatus;
  redacted: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function captureTelemetrySignal(
  id: TelemetrySignalId,
  sourceContextRef: string,
): TelemetrySignal {
  return freezeTelemetrySignal({
    id,
    sourceContextRef: createSafeDomainCode(sourceContextRef, "TelemetrySignal.sourceContextRef"),
    status: "captured",
    redacted: false,
    domainEvents: appendDomainEvent([], "TelemetrySignal", id, "TelemetryCaptured"),
  });
}

export function sanitizeTelemetrySignal(signal: TelemetrySignal): TelemetrySignal {
  return transitionTelemetrySignal(signal, "sanitized", "TelemetrySanitized", { redacted: true });
}

export function projectTelemetrySignal(signal: TelemetrySignal): TelemetrySignal {
  return transitionTelemetrySignal(signal, "projected", "TelemetryProjected");
}

export function dropTelemetrySignal(signal: TelemetrySignal): TelemetrySignal {
  return transitionTelemetrySignal(signal, "dropped", "TelemetryDropped", { redacted: true });
}

function transitionTelemetrySignal(
  signal: TelemetrySignal,
  status: TelemetrySignalStatus,
  eventName: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{ redacted?: boolean }> = {},
): TelemetrySignal {
  return freezeTelemetrySignal({
    id: signal.id,
    sourceContextRef: signal.sourceContextRef,
    status: transitionStatus(signal.status, status, telemetrySignalTransitions, "TelemetrySignal"),
    redacted: patch.redacted ?? signal.redacted,
    domainEvents: appendDomainEvent(signal.domainEvents, "TelemetrySignal", signal.id, eventName),
  });
}

function freezeTelemetrySignal(signal: TelemetrySignal): TelemetrySignal {
  return Object.freeze(signal);
}
