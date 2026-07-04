import {
  createAuditRecordAggregate,
  createAuditRecordId,
  createRetentionPolicy,
  evaluateAuditRedactionPolicy,
  type AuditRecord,
  type AuditRecordRepositoryPort,
  type DomainDataClassification,
  type RetentionPolicy,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, err, ok, type Result, type UUIDGenerator } from "@omniwa/shared";

import { createApplicationError, type ApplicationError } from "../errors/application-error.js";
import type { AuditRecordSourceSignalRecorder } from "./authorization-audit-service.js";

export type SecurityAuditEvidenceRepository = AuditRecordRepositoryPort &
  AuditRecordSourceSignalRecorder;

export type SecurityAuditEvidenceInput = Readonly<{
  sourceSignalRef: string;
  auditCategory: string;
  evidenceSummaryCode: string;
  dataClassification?: DomainDataClassification;
  redacted?: boolean;
  retentionPolicy?: RetentionPolicy;
}>;

export type SecurityAuditEvidenceServiceOptions = Readonly<{
  auditRecordRepository: SecurityAuditEvidenceRepository;
  uuidGenerator?: UUIDGenerator;
  defaultAuditRetentionPolicy?: RetentionPolicy;
}>;

export type SecurityAuditEvidenceResult = Result<AuditRecord, ApplicationError>;

const defaultAuditRetentionPolicy = createRetentionPolicy({
  category: "audit_record",
  retentionDays: 180,
});

export class SecurityAuditEvidenceApplicationService {
  private readonly auditRecordRepository: SecurityAuditEvidenceRepository;
  private readonly uuidGenerator: UUIDGenerator;
  private readonly defaultAuditRetentionPolicy: RetentionPolicy;

  constructor(options: SecurityAuditEvidenceServiceOptions) {
    this.auditRecordRepository = options.auditRecordRepository;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
    this.defaultAuditRetentionPolicy =
      options.defaultAuditRetentionPolicy ?? defaultAuditRetentionPolicy;
  }

  async record(input: SecurityAuditEvidenceInput): Promise<SecurityAuditEvidenceResult> {
    const dataClassification = input.dataClassification ?? "internal";
    const redacted = input.redacted ?? false;
    const retentionPolicy = input.retentionPolicy ?? this.defaultAuditRetentionPolicy;
    const safety = evaluateAuditRedactionPolicy({
      sourceSignalRef: input.sourceSignalRef,
      dataClassification,
      redacted,
      retentionCategoryPresent: true,
    });

    if (safety.outcome !== "allow") {
      return err(
        createApplicationError({
          category: "validation",
          code: "unsafe_audit_evidence",
          message: safety.specification.passed
            ? "Audit evidence was rejected by policy."
            : safety.specification.error.message,
          recoverability: "caller_correctable",
          retryable: false,
          ownerContext: "audit",
        }),
      );
    }

    try {
      const existingRecords = await this.auditRecordRepository.findBySourceSignal(
        input.sourceSignalRef,
      );
      const existingRecord = existingRecords.find(
        (record) => record.auditCategory === input.auditCategory,
      );

      if (existingRecord !== undefined) {
        return ok(existingRecord);
      }

      const auditRecord = createAuditRecordAggregate({
        id: createAuditRecordId(this.uuidGenerator.random()),
        auditCategory: input.auditCategory,
        retentionPolicy,
        evidenceSummaryCode: input.evidenceSummaryCode,
        redacted,
      });

      await this.auditRecordRepository.save(auditRecord);
      await this.auditRecordRepository.recordSourceSignal(auditRecord.id, input.sourceSignalRef);

      return ok(auditRecord);
    } catch (error) {
      return err(
        createApplicationError({
          category: "validation",
          code: "invalid_audit_evidence",
          message: errorMessage(error, "Audit evidence input is invalid."),
          recoverability: "caller_correctable",
          retryable: false,
          ownerContext: "audit",
        }),
      );
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
