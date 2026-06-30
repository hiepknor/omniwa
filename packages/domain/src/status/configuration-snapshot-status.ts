import { createStringUnionValue } from "../common/string-union-value.js";

export const configurationSnapshotStatuses = [
  "proposed",
  "validated",
  "rejected",
  "active",
  "superseded",
  "retired",
] as const;

export type ConfigurationSnapshotStatus = (typeof configurationSnapshotStatuses)[number];

export function createConfigurationSnapshotStatus(value: string): ConfigurationSnapshotStatus {
  return createStringUnionValue(
    value,
    configurationSnapshotStatuses,
    "ConfigurationSnapshotStatus",
  );
}
