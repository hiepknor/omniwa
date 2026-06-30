import { type ApplicationPortContext, type ApplicationPortResult } from "@omniwa/application";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  ok,
  type Clock,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import {
  RecoveryValidationRunner,
  restoreValidationChecks,
  type BackupManifest,
  type BackupManifestProvider,
  type RestoreValidationCheckResult,
  type RestoreValidationProbe,
  type RestoreValidationProbeResult,
} from "./recovery-validation.js";

const now = 1_800_000_000_000;
const hourMilliseconds = 60 * 60 * 1000;

const context: ApplicationPortContext = {
  requestContext: createRequestContext({
    correlationId: createCorrelationId("recovery-correlation"),
    requestId: createRequestId("recovery-request"),
  }),
  actorRef: "background-runtime",
};

const fixedClock: Clock = {
  now: () => new Date(now),
  epochMilliseconds: () => now,
  isoNow: () => "2027-01-15T08:00:00.000Z" as ReturnType<Clock["isoNow"]>,
};

describe("RecoveryValidationRunner", () => {
  it("passes when the latest encrypted backup and restore probe satisfy recovery targets", async () => {
    const runner = new RecoveryValidationRunner({
      clock: fixedClock,
      manifestProvider: new ManifestProviderFake(validManifest()),
      restoreValidationProbe: new RestoreProbeFake(allRestoreChecksPassed()),
    });

    const result = await runner.validateLatestBackup(context);

    expectOk(result);
    expect(result.value).toEqual({
      status: "passed",
      checkedAtEpochMilliseconds: now,
      safeManifestRef: "backup:latest",
      backupAgeMilliseconds: hourMilliseconds,
      safeRestoreProbeRef: "restore-probe:latest",
      findings: [],
    });
  });

  it("fails stale or incomplete backup manifests against frozen recovery targets", async () => {
    const runner = new RecoveryValidationRunner({
      clock: fixedClock,
      manifestProvider: new ManifestProviderFake({
        ...validManifest(),
        manifestAvailable: false,
        artifactAvailable: false,
        encrypted: false,
        integrityVerified: false,
        createdAtEpochMilliseconds: now - 25 * hourMilliseconds,
        retentionDays: 13,
        rpoMilliseconds: 25 * hourMilliseconds,
        rtoMilliseconds: 5 * hourMilliseconds,
      }),
      restoreValidationProbe: new RestoreProbeFake(allRestoreChecksPassed()),
    });

    const result = await runner.validateLatestBackup(context);

    expectOk(result);
    expect(result.value.status).toBe("failed");
    expect(findingCodes(result.value.findings)).toEqual(
      expect.arrayContaining([
        "backup_manifest_missing",
        "backup_artifact_missing",
        "backup_artifact_not_encrypted",
        "backup_integrity_not_verified",
        "backup_age_exceeds_target",
        "backup_retention_below_target",
        "backup_rpo_exceeds_target",
        "backup_rto_exceeds_target",
      ]),
    );
  });

  it("fails when Redis is marked as recoverable durable state", async () => {
    const runner = new RecoveryValidationRunner({
      clock: fixedClock,
      manifestProvider: new ManifestProviderFake({
        ...validManifest(),
        storageAreas: [
          ...validManifest().storageAreas,
          {
            kind: "redis",
            included: true,
            recoverable: true,
            encrypted: true,
            integrityVerified: true,
          },
        ],
      }),
      restoreValidationProbe: new RestoreProbeFake(allRestoreChecksPassed()),
    });

    const result = await runner.validateLatestBackup(context);

    expectOk(result);
    expect(result.value.status).toBe("failed");
    expect(findingCodes(result.value.findings)).toContain("redis_marked_as_recoverable_source");
  });

  it("fails when restore validation checks do not pass", async () => {
    const runner = new RecoveryValidationRunner({
      clock: fixedClock,
      manifestProvider: new ManifestProviderFake(validManifest()),
      restoreValidationProbe: new RestoreProbeFake(
        allRestoreChecksPassed().filter(
          (check) => check.check !== "approved_object_artifacts_accessible",
        ),
      ),
    });

    const result = await runner.validateLatestBackup(context);

    expectOk(result);
    expect(result.value.status).toBe("failed");
    expect(findingCodes(result.value.findings)).toContain(
      "restore_check_approved_object_artifacts_accessible_missing",
    );
  });

  it("returns safe failures when the restore probe throws", async () => {
    const restoreProbe = new RestoreProbeFake(allRestoreChecksPassed());
    restoreProbe.fail = true;
    const runner = new RecoveryValidationRunner({
      clock: fixedClock,
      manifestProvider: new ManifestProviderFake(validManifest()),
      restoreValidationProbe: restoreProbe,
    });

    const result = await runner.validateLatestBackup(context);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "unknown",
      code: "recovery_validation_failed",
      retryable: true,
      ownerContext: "operations",
      failureCategory: "unexpected",
      safeMetadata: {
        errorName: "Error",
      },
    });
  });
});

function expectOk<T>(result: ApplicationPortResult<T>): asserts result is { ok: true; value: T } {
  if (!result.ok) {
    throw new Error(`Expected ok result but received ${result.error.code}.`);
  }
}

function findingCodes(findings: readonly { code: string }[]): string[] {
  return findings.map((finding) => finding.code);
}

function validManifest(): BackupManifest {
  return {
    safeManifestRef: "backup:latest",
    createdAtEpochMilliseconds: now - hourMilliseconds,
    manifestAvailable: true,
    artifactAvailable: true,
    encrypted: true,
    integrityVerified: true,
    retentionDays: 14,
    rpoMilliseconds: 24 * hourMilliseconds,
    rtoMilliseconds: 4 * hourMilliseconds,
    storageAreas: [
      {
        kind: "postgresql",
        included: true,
        recoverable: true,
        encrypted: true,
        integrityVerified: true,
      },
      {
        kind: "object_storage",
        included: true,
        recoverable: true,
        encrypted: true,
        integrityVerified: true,
      },
      {
        kind: "redis",
        included: true,
        recoverable: false,
        encrypted: false,
        integrityVerified: false,
      },
    ],
  };
}

function allRestoreChecksPassed(): RestoreValidationCheckResult[] {
  return restoreValidationChecks.map((check) => ({
    check,
    passed: true,
    safeDetailCode: `${check}_ok`,
  }));
}

class ManifestProviderFake implements BackupManifestProvider {
  constructor(private readonly manifest: BackupManifest | undefined) {}

  loadLatestBackupManifest(): Promise<ApplicationPortResult<BackupManifest>> {
    if (this.manifest === undefined) {
      return Promise.resolve(
        ok({
          ...validManifest(),
          manifestAvailable: false,
        }),
      );
    }

    return Promise.resolve(ok(this.manifest));
  }
}

class RestoreProbeFake implements RestoreValidationProbe {
  fail = false;

  constructor(private readonly checks: readonly RestoreValidationCheckResult[]) {}

  validateRestore(): Promise<ApplicationPortResult<RestoreValidationProbeResult>> {
    if (this.fail) {
      throw new Error("Restore probe failed with secret token restore-secret.");
    }

    return Promise.resolve(
      ok({
        safeProbeRef: "restore-probe:latest",
        checkedAtEpochMilliseconds: now,
        checks: this.checks,
      }),
    );
  }
}
