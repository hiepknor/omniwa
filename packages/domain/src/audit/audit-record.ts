import { transitionStatus, type StatusTransitionMap } from "../aggregates/status-transition.js";
import { createSafeDomainCode } from "../common/safe-domain-code.js";
import { appendDomainEvent, type DomainEvent } from "../events/domain-event.js";
import type { AuditRecordId } from "../identity/aggregate-ids.js";
import type { RetentionPolicy } from "../policies/retention-policy.js";
import type { AuditRecordStatus } from "../status/audit-record-status.js";

const auditRecordTransitions: StatusTransitionMap<AuditRecordStatus> = {
  requested: ["recorded", "retention_expired"],
  recorded: ["retained", "retention_expired"],
  retained: ["retention_expired"],
  retention_expired: [],
};

export type AuditRecord = Readonly<{
  id: AuditRecordId;
  auditCategory: string;
  status: AuditRecordStatus;
  retentionPolicy: RetentionPolicy;
  evidenceSummaryCode?: string;
  redacted: boolean;
  domainEvents: readonly DomainEvent[];
}>;

export function requestAuditRecord(
  id: AuditRecordId,
  auditCategory: string,
  retentionPolicy: RetentionPolicy,
): AuditRecord {
  return freezeAuditRecord({
    id,
    auditCategory: createSafeDomainCode(auditCategory, "AuditRecord.auditCategory"),
    status: "requested",
    retentionPolicy,
    redacted: false,
    domainEvents: appendDomainEvent([], "AuditRecord", id, "AuditRecordRequested"),
  });
}

export function recordAuditEvidence(record: AuditRecord, evidenceSummaryCode: string): AuditRecord {
  return transitionAuditRecord(record, "recorded", "AuditRecorded", { evidenceSummaryCode });
}

export function applyAuditRedaction(record: AuditRecord): AuditRecord {
  return freezeAuditRecord({
    ...record,
    redacted: true,
    domainEvents: appendDomainEvent(
      record.domainEvents,
      "AuditRecord",
      record.id,
      "AuditRedactionApplied",
    ),
  });
}

export function retainAuditRecord(record: AuditRecord): AuditRecord {
  return transitionAuditRecord(record, "retained");
}

export function expireAuditRetention(record: AuditRecord): AuditRecord {
  return transitionAuditRecord(record, "retention_expired", "AuditRetentionExpired");
}

function transitionAuditRecord(
  record: AuditRecord,
  status: AuditRecordStatus,
  eventName?: Parameters<typeof appendDomainEvent>[3],
  patch: Readonly<{ evidenceSummaryCode?: string }> = {},
): AuditRecord {
  return freezeAuditRecord({
    id: record.id,
    auditCategory: record.auditCategory,
    status: transitionStatus(record.status, status, auditRecordTransitions, "AuditRecord"),
    retentionPolicy: record.retentionPolicy,
    redacted: record.redacted,
    ...optionalValue(
      "evidenceSummaryCode",
      patch.evidenceSummaryCode === undefined
        ? undefined
        : createSafeDomainCode(patch.evidenceSummaryCode, "AuditRecord.evidenceSummaryCode"),
      record.evidenceSummaryCode,
    ),
    domainEvents:
      eventName === undefined
        ? record.domainEvents
        : appendDomainEvent(record.domainEvents, "AuditRecord", record.id, eventName),
  });
}

function optionalValue<TKey extends string, TValue>(
  key: TKey,
  nextValue: TValue | undefined,
  currentValue: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  const value = nextValue ?? currentValue;
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function freezeAuditRecord(record: AuditRecord): AuditRecord {
  return Object.freeze(record);
}
