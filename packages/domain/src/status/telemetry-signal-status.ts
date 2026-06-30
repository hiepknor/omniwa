import { createStringUnionValue } from "../common/string-union-value.js";

export const telemetrySignalStatuses = ["captured", "sanitized", "projected", "dropped"] as const;

export type TelemetrySignalStatus = (typeof telemetrySignalStatuses)[number];

export function createTelemetrySignalStatus(value: string): TelemetrySignalStatus {
  return createStringUnionValue(value, telemetrySignalStatuses, "TelemetrySignalStatus");
}
