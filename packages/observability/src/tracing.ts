import type { LogContext } from "./logger.js";
import { assertSafeTelemetryName } from "./metrics.js";
import type { SafeLogFields } from "./redaction.js";
import type { RuntimeRole } from "./runtime-role.js";

export const traceSpanStatuses = ["started", "ended", "error"] as const;

export type TraceSpanStatus = (typeof traceSpanStatuses)[number];

export type TraceSpan = Readonly<{
  name: string;
  runtimeRole: RuntimeRole;
  context: LogContext;
  status: TraceSpanStatus;
  startedAtEpochMilliseconds: number;
  endedAtEpochMilliseconds?: number;
  durationMilliseconds?: number;
  attributes?: SafeLogFields;
}>;

export interface TraceRecorder {
  recordSpan(span: TraceSpan): void;
}

export function startTraceSpan(input: {
  name: string;
  runtimeRole: RuntimeRole;
  context: LogContext;
  startedAtEpochMilliseconds: number;
  attributes?: SafeLogFields;
}): TraceSpan {
  assertSafeTelemetryName(input.name, "TraceSpan.name");
  assertNonNegativeInteger(
    input.startedAtEpochMilliseconds,
    "TraceSpan.startedAtEpochMilliseconds",
  );

  return Object.freeze({
    name: input.name,
    runtimeRole: input.runtimeRole,
    context: Object.freeze({ ...input.context }),
    status: "started",
    startedAtEpochMilliseconds: input.startedAtEpochMilliseconds,
    ...optional("attributes", freezeSafeFields(input.attributes)),
  });
}

export function finishTraceSpan(
  span: TraceSpan,
  input: Readonly<{
    endedAtEpochMilliseconds: number;
    status?: Exclude<TraceSpanStatus, "started">;
  }>,
): TraceSpan {
  assertNonNegativeInteger(input.endedAtEpochMilliseconds, "TraceSpan.endedAtEpochMilliseconds");

  if (input.endedAtEpochMilliseconds < span.startedAtEpochMilliseconds) {
    throw new TypeError("TraceSpan end time must not be before start time.");
  }

  return Object.freeze({
    ...span,
    status: input.status ?? "ended",
    endedAtEpochMilliseconds: input.endedAtEpochMilliseconds,
    durationMilliseconds: input.endedAtEpochMilliseconds - span.startedAtEpochMilliseconds,
  });
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}

function freezeSafeFields(fields: SafeLogFields | undefined): SafeLogFields | undefined {
  return fields === undefined ? undefined : Object.freeze({ ...fields });
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
