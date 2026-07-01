import { createStringUnionValue } from "../common/string-union-value.js";

export const labelStatuses = ["active", "archived", "deleted"] as const;

export type LabelStatus = (typeof labelStatuses)[number];

export function createLabelStatus(value: string): LabelStatus {
  return createStringUnionValue(value, labelStatuses, "LabelStatus");
}
