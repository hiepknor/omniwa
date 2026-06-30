import { createStringUnionValue } from "../common/string-union-value.js";

export const instanceStatuses = [
  "created",
  "connecting",
  "qr_pending",
  "connected",
  "disconnected",
  "logged_out",
  "action_required",
  "destroyed",
] as const;

export type InstanceStatus = (typeof instanceStatuses)[number];

export function createInstanceStatus(value: string): InstanceStatus {
  return createStringUnionValue(value, instanceStatuses, "InstanceStatus");
}
