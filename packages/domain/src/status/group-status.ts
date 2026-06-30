import { createStringUnionValue } from "../common/string-union-value.js";

export const groupStatuses = ["discovered", "active", "left", "deleted"] as const;

export type GroupStatus = (typeof groupStatuses)[number];

export function createGroupStatus(value: string): GroupStatus {
  return createStringUnionValue(value, groupStatuses, "GroupStatus");
}
