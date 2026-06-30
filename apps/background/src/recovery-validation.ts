import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
} from "@omniwa/application";
import { err, ok, systemClock, type Clock } from "@omniwa/shared";

const hourMilliseconds = 60 * 60 * 1000;
const dayMilliseconds = 24 * hourMilliseconds;

export const backupStorageAreaKinds = [
  "postgresql",
  "object_storage",
  "redis",
  "backup_manifest",
  "observability",
] as const;

export type BackupStorageAreaKind = (typeof backupStorageAreaKinds)[number];

export const restoreValidationChecks = [
  "postgresql_restored",
  "identity_continuity_preserved",
  "instance_inventory_restored",
  "session_availability_checked",
  "worker_jobs_visible",
  "queue_state_visible",
  "webhook_delivery_state_visible",
  "idempotency_markers_restored",
  "retention_markers_preserved",
  "projections_rebuilt_or_marked",
  "redis_rebuilt_or_invalidated",
  "audit_continuity_available",
  "approved_object_artifacts_accessible",
  "recovery_outcome_recorded",
] as const;

export type RestoreValidationCheck = (typeof restoreValidationChecks)[number];

export type BackupStorageArea = Readonly<{
  kind: BackupStorageAreaKind;
  included: boolean;
  recoverable: boolean;
  encrypted: boolean;
  integrityVerified: boolean;
}>;

export type BackupManifest = Readonly<{
  safeManifestRef: string;
  createdAtEpochMilliseconds: number;
  manifestAvailable: boolean;
  artifactAvailable: boolean;
  encrypted: boolean;
  integrityVerified: boolean;
  retentionDays: number;
  rpoMilliseconds: number;
  rtoMilliseconds: number;
  storageAreas: readonly BackupStorageArea[];
}>;

export type RestoreValidationCheckResult = Readonly<{
  check: RestoreValidationCheck;
  passed: boolean;
  safeDetailCode: string;
}>;

export type RestoreValidationProbeResult = Readonly<{
  safeProbeRef: string;
  checkedAtEpochMilliseconds: number;
  checks: readonly RestoreValidationCheckResult[];
}>;

export type RecoveryValidationFindingSeverity = "critical" | "warning";

export type RecoveryValidationFinding = Readonly<{
  code: string;
  severity: RecoveryValidationFindingSeverity;
  safeDetailCode: string;
}>;

export type RecoveryValidationStatus = "passed" | "failed";

export type RecoveryValidationReport = Readonly<{
  status: RecoveryValidationStatus;
  checkedAtEpochMilliseconds: number;
  safeManifestRef: string;
  backupAgeMilliseconds: number;
  safeRestoreProbeRef: string;
  findings: readonly RecoveryValidationFinding[];
}>;

export type RecoveryValidationPolicy = Readonly<{
  maxBackupAgeMilliseconds: number;
  minimumRetentionDays: number;
  maxRpoMilliseconds: number;
  maxRtoMilliseconds: number;
  requiredStorageAreas: readonly BackupStorageAreaKind[];
  requiredRestoreChecks: readonly RestoreValidationCheck[];
}>;

export type BackupManifestProvider = Readonly<{
  loadLatestBackupManifest: (
    context: ApplicationPortContext,
  ) => Promise<ApplicationPortResult<BackupManifest>>;
}>;

export type RestoreValidationProbe = Readonly<{
  validateRestore: (
    manifest: BackupManifest,
    context: ApplicationPortContext,
  ) => Promise<ApplicationPortResult<RestoreValidationProbeResult>>;
}>;

export type RecoveryValidationRunnerOptions = Readonly<{
  manifestProvider: BackupManifestProvider;
  restoreValidationProbe: RestoreValidationProbe;
  clock?: Clock;
  policy?: RecoveryValidationPolicy;
}>;

export type BackupValidationCapable = Readonly<{
  validateLatestBackup: (
    context: ApplicationPortContext,
  ) => Promise<ApplicationPortResult<RecoveryValidationReport>>;
}>;

const defaultRequiredStorageAreas: readonly BackupStorageAreaKind[] = Object.freeze(["postgresql"]);

export const defaultRecoveryValidationPolicy: RecoveryValidationPolicy = Object.freeze({
  maxBackupAgeMilliseconds: dayMilliseconds,
  minimumRetentionDays: 14,
  maxRpoMilliseconds: dayMilliseconds,
  maxRtoMilliseconds: 4 * hourMilliseconds,
  requiredStorageAreas: defaultRequiredStorageAreas,
  requiredRestoreChecks: Object.freeze([...restoreValidationChecks]),
});

export class RecoveryValidationRunner implements BackupValidationCapable {
  private readonly manifestProvider: BackupManifestProvider;
  private readonly restoreValidationProbe: RestoreValidationProbe;
  private readonly clock: Clock;
  private readonly policy: RecoveryValidationPolicy;

  constructor(options: RecoveryValidationRunnerOptions) {
    this.manifestProvider = options.manifestProvider;
    this.restoreValidationProbe = options.restoreValidationProbe;
    this.clock = options.clock ?? systemClock;
    this.policy = freezePolicy(options.policy ?? defaultRecoveryValidationPolicy);
  }

  async validateLatestBackup(
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<RecoveryValidationReport>> {
    try {
      const manifestResult = await this.manifestProvider.loadLatestBackupManifest(context);

      if (!manifestResult.ok) {
        return manifestResult;
      }

      const restoreResult = await this.restoreValidationProbe.validateRestore(
        manifestResult.value,
        context,
      );

      if (!restoreResult.ok) {
        return restoreResult;
      }

      return ok(this.buildReport(manifestResult.value, restoreResult.value));
    } catch (error) {
      return err(toRecoveryValidationFailure(error));
    }
  }

  private buildReport(
    manifest: BackupManifest,
    restoreResult: RestoreValidationProbeResult,
  ): RecoveryValidationReport {
    const checkedAtEpochMilliseconds = this.clock.epochMilliseconds();
    const backupAgeMilliseconds = checkedAtEpochMilliseconds - manifest.createdAtEpochMilliseconds;
    const findings: RecoveryValidationFinding[] = [];

    if (!manifest.manifestAvailable) {
      findings.push(createFinding("backup_manifest_missing", "critical"));
    }

    if (!manifest.artifactAvailable) {
      findings.push(createFinding("backup_artifact_missing", "critical"));
    }

    if (!manifest.encrypted) {
      findings.push(createFinding("backup_artifact_not_encrypted", "critical"));
    }

    if (!manifest.integrityVerified) {
      findings.push(createFinding("backup_integrity_not_verified", "critical"));
    }

    if (backupAgeMilliseconds < 0) {
      findings.push(createFinding("backup_manifest_from_future", "critical"));
    }

    if (backupAgeMilliseconds > this.policy.maxBackupAgeMilliseconds) {
      findings.push(createFinding("backup_age_exceeds_target", "critical"));
    }

    if (manifest.retentionDays < this.policy.minimumRetentionDays) {
      findings.push(createFinding("backup_retention_below_target", "critical"));
    }

    if (manifest.rpoMilliseconds > this.policy.maxRpoMilliseconds) {
      findings.push(createFinding("backup_rpo_exceeds_target", "critical"));
    }

    if (manifest.rtoMilliseconds > this.policy.maxRtoMilliseconds) {
      findings.push(createFinding("backup_rto_exceeds_target", "critical"));
    }

    findings.push(...this.validateStorageAreas(manifest.storageAreas));
    findings.push(...this.validateRestoreChecks(restoreResult.checks));

    return freezeReport({
      status: findings.some((finding) => finding.severity === "critical") ? "failed" : "passed",
      checkedAtEpochMilliseconds,
      safeManifestRef: manifest.safeManifestRef,
      backupAgeMilliseconds,
      safeRestoreProbeRef: restoreResult.safeProbeRef,
      findings,
    });
  }

  private validateStorageAreas(
    storageAreas: readonly BackupStorageArea[],
  ): RecoveryValidationFinding[] {
    const findings: RecoveryValidationFinding[] = [];

    for (const requiredArea of this.policy.requiredStorageAreas) {
      const area = storageAreas.find((candidate) => candidate.kind === requiredArea);

      if (area === undefined || !area.included || !area.recoverable) {
        findings.push(createFinding(`backup_storage_${requiredArea}_missing`, "critical"));
      }
    }

    for (const area of storageAreas) {
      if (area.kind === "redis" && area.recoverable) {
        findings.push(createFinding("redis_marked_as_recoverable_source", "critical"));
      }

      if (area.included && area.recoverable && !area.encrypted) {
        findings.push(createFinding(`backup_storage_${area.kind}_not_encrypted`, "critical"));
      }

      if (area.included && area.recoverable && !area.integrityVerified) {
        findings.push(
          createFinding(`backup_storage_${area.kind}_integrity_not_verified`, "critical"),
        );
      }
    }

    return findings;
  }

  private validateRestoreChecks(
    checks: readonly RestoreValidationCheckResult[],
  ): RecoveryValidationFinding[] {
    const findings: RecoveryValidationFinding[] = [];

    for (const requiredCheck of this.policy.requiredRestoreChecks) {
      const check = checks.find((candidate) => candidate.check === requiredCheck);

      if (check === undefined) {
        findings.push(createFinding(`restore_check_${requiredCheck}_missing`, "critical"));
        continue;
      }

      if (!check.passed) {
        findings.push(
          createFinding(`restore_check_${requiredCheck}_failed`, "critical", check.safeDetailCode),
        );
      }
    }

    return findings;
  }
}

function freezePolicy(policy: RecoveryValidationPolicy): RecoveryValidationPolicy {
  return Object.freeze({
    ...policy,
    requiredStorageAreas: Object.freeze([...policy.requiredStorageAreas]),
    requiredRestoreChecks: Object.freeze([...policy.requiredRestoreChecks]),
  });
}

function createFinding(
  code: string,
  severity: RecoveryValidationFindingSeverity,
  safeDetailCode = code,
): RecoveryValidationFinding {
  return Object.freeze({
    code,
    severity,
    safeDetailCode,
  });
}

function freezeReport(report: {
  status: RecoveryValidationStatus;
  checkedAtEpochMilliseconds: number;
  safeManifestRef: string;
  backupAgeMilliseconds: number;
  safeRestoreProbeRef: string;
  findings: readonly RecoveryValidationFinding[];
}): RecoveryValidationReport {
  return Object.freeze({
    ...report,
    findings: Object.freeze([...report.findings]),
  });
}

function toRecoveryValidationFailure(error: unknown): ApplicationPortFailure {
  if (error instanceof Error) {
    return createApplicationPortFailure({
      category: "unknown",
      code: "recovery_validation_failed",
      message: "Recovery validation failed before a safe report was recorded.",
      retryable: true,
      ownerContext: "operations",
      failureCategory: "unexpected",
      safeMetadata: {
        errorName: error.name,
      },
    });
  }

  return createApplicationPortFailure({
    category: "unknown",
    code: "recovery_validation_failed",
    message: "Recovery validation failed before a safe report was recorded.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: "unexpected",
  });
}
