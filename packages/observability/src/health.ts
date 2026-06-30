import { assertSafeTelemetryName } from "./metrics.js";
import type { RuntimeRole } from "./runtime-role.js";

export const healthStates = ["healthy", "degraded", "unavailable", "unknown"] as const;

export type HealthState = (typeof healthStates)[number];

export const readinessStates = ["ready", "degraded", "not_ready", "unknown"] as const;

export type ReadinessState = (typeof readinessStates)[number];

export type HealthProbeResult = Readonly<{
  name: string;
  runtimeRole: RuntimeRole;
  state: HealthState;
  critical: boolean;
  checkedAtEpochMilliseconds: number;
  causeCode?: string;
}>;

export type HealthSnapshot = Readonly<{
  runtimeRole: RuntimeRole;
  readiness: ReadinessState;
  checkedAtEpochMilliseconds: number;
  checks: readonly HealthProbeResult[];
}>;

export type HealthCheck = Readonly<{
  name: string;
  runtimeRole: RuntimeRole;
  critical: boolean;
  check(): Promise<HealthProbeResult> | HealthProbeResult;
}>;

export function createHealthProbeResult(input: HealthProbeResult): HealthProbeResult {
  assertSafeTelemetryName(input.name, "HealthProbeResult.name");
  assertNonNegativeInteger(input.checkedAtEpochMilliseconds, "checkedAtEpochMilliseconds");

  if (input.causeCode !== undefined) {
    assertSafeTelemetryName(input.causeCode, "HealthProbeResult.causeCode");
  }

  return Object.freeze({ ...input });
}

export function summarizeHealthSnapshot(
  runtimeRole: RuntimeRole,
  checks: readonly HealthProbeResult[],
): HealthSnapshot {
  const checkedAtEpochMilliseconds = checks.reduce(
    (latest, check) => Math.max(latest, check.checkedAtEpochMilliseconds),
    0,
  );

  return Object.freeze({
    runtimeRole,
    readiness: readinessFor(checks),
    checkedAtEpochMilliseconds,
    checks: Object.freeze([...checks]),
  });
}

function readinessFor(checks: readonly HealthProbeResult[]): ReadinessState {
  if (checks.length === 0) {
    return "unknown";
  }

  if (checks.some((check) => check.critical && check.state === "unavailable")) {
    return "not_ready";
  }

  if (checks.some((check) => check.state === "degraded" || check.state === "unavailable")) {
    return "degraded";
  }

  if (checks.every((check) => check.state === "healthy")) {
    return "ready";
  }

  return "unknown";
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
}
