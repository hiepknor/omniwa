import { createStringUnionValue } from "../common/string-union-value.js";

export const auditRecordStatuses = [
  "requested",
  "recorded",
  "retained",
  "retention_expired",
] as const;

export type AuditRecordStatus = (typeof auditRecordStatuses)[number];

export function createAuditRecordStatus(value: string): AuditRecordStatus {
  return createStringUnionValue(value, auditRecordStatuses, "AuditRecordStatus");
}
