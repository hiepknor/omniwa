import { describe, expect, it } from "vitest";

import {
  createProductionLikeRecoveryDrillFixture,
  runBackupRestoreRecoveryDrill,
  type RecoveryDrillDataset,
} from "./backup-restore-drill.js";

const now = 1_800_000_000_000;
const hourMilliseconds = 60 * 60 * 1000;

describe("backup restore recovery drill", () => {
  it("passes a repeatable production-like restore drill and records RPO/RTO evidence", () => {
    const input = createProductionLikeRecoveryDrillFixture({
      checkedAtEpochMilliseconds: now,
      restoreDurationMilliseconds: 30 * 60 * 1000,
    });

    const first = runBackupRestoreRecoveryDrill(input);
    const second = runBackupRestoreRecoveryDrill(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "passed",
      safeBackupRef: "backup:drill:latest",
      checkedAtEpochMilliseconds: now,
      backupAgeMilliseconds: hourMilliseconds,
      restoreDurationMilliseconds: 30 * 60 * 1000,
      rpoTargetMilliseconds: 24 * hourMilliseconds,
      rtoTargetMilliseconds: 4 * hourMilliseconds,
      findings: [],
    });
    expect(first.recoveredDataset).toMatchObject({
      instanceCount: 3,
      activeSessionCount: 2,
      messageCount: 250,
      queueJobCount: 12,
      webhookDeliveryCount: 41,
      auditRecordCount: 73,
    });
  });

  it("fails backups that cannot satisfy frozen recovery targets", () => {
    const base = createProductionLikeRecoveryDrillFixture({
      checkedAtEpochMilliseconds: now,
      restoreDurationMilliseconds: 5 * hourMilliseconds,
    });

    const result = runBackupRestoreRecoveryDrill({
      ...base,
      backupArtifact: {
        ...base.backupArtifact,
        createdAtEpochMilliseconds: now - 25 * hourMilliseconds,
        encrypted: false,
        integrityVerified: false,
        retentionDays: 13,
        redisSnapshotIncluded: true,
      },
    });

    expect(result.status).toBe("failed");
    expect(findingCodes(result.findings)).toEqual(
      expect.arrayContaining([
        "backup_artifact_not_encrypted",
        "backup_integrity_not_verified",
        "backup_retention_below_target",
        "backup_age_exceeds_rpo_target",
        "restore_duration_exceeds_rto_target",
        "redis_snapshot_included_as_recoverable_state",
      ]),
    );
  });

  it("fails when restored state does not match production-like source state", () => {
    const base = createProductionLikeRecoveryDrillFixture({ checkedAtEpochMilliseconds: now });
    const restoredDataset: RecoveryDrillDataset = {
      ...base.restoredDataset,
      messageCount: base.restoredDataset.messageCount - 1,
      sessionCredentialRefs: ["secretref:session:instance_primary"],
    };

    const result = runBackupRestoreRecoveryDrill({
      ...base,
      restoredDataset,
    });

    expect(result.status).toBe("failed");
    expect(findingCodes(result.findings)).toEqual(
      expect.arrayContaining([
        "restore_dataset_message_count_mismatch",
        "restore_dataset_session_credential_refs_mismatch",
      ]),
    );
  });

  it("fails if backup artifacts contain secret material while keeping reports safe", () => {
    const base = createProductionLikeRecoveryDrillFixture({ checkedAtEpochMilliseconds: now });

    const result = runBackupRestoreRecoveryDrill({
      ...base,
      backupArtifact: {
        ...base.backupArtifact,
        containsSecretMaterial: true,
        opaquePayload: {
          manifestRef: "manifest:backup:drill:latest",
          rawSessionSecret: "synthetic-session-secret",
          sessionCredentialRefs: base.backupArtifact.sourceDataset.sessionCredentialRefs,
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(findingCodes(result.findings)).toEqual(
      expect.arrayContaining([
        "backup_contains_secret_material",
        "backup_payload_contains_secret_material",
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-session-secret");
  });
});

function findingCodes(findings: readonly { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}
