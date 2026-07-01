import { systemClock, toIsoTimestamp, type Clock } from "@omniwa/shared";

const hourMilliseconds = 60 * 60 * 1000;
const dayMilliseconds = 24 * hourMilliseconds;

export const recoveryDrillNumericCounters = [
  "instanceCount",
  "activeSessionCount",
  "messageCount",
  "queueJobCount",
  "webhookSubscriptionCount",
  "webhookDeliveryCount",
  "auditRecordCount",
  "eventCount",
  "mediaObjectCount",
] as const;

export type RecoveryDrillNumericCounter = (typeof recoveryDrillNumericCounters)[number];

export type RecoveryDrillDataset = Readonly<
  Record<RecoveryDrillNumericCounter, number> & {
    sessionCredentialRefs: readonly string[];
    mediaObjectRefs: readonly string[];
  }
>;

export type RecoveryBackupArtifact = Readonly<{
  safeBackupRef: string;
  createdAtEpochMilliseconds: number;
  encrypted: boolean;
  integrityVerified: boolean;
  retentionDays: number;
  sourceDataset: RecoveryDrillDataset;
  containsSecretMaterial: boolean;
  redisSnapshotIncluded: boolean;
  opaquePayload?: unknown;
}>;

export type RecoveryDrillTargets = Readonly<{
  maxRpoMilliseconds: number;
  maxRtoMilliseconds: number;
  minimumRetentionDays: number;
}>;

export type RecoveryDrillInput = Readonly<{
  backupArtifact: RecoveryBackupArtifact;
  restoredDataset: RecoveryDrillDataset;
  startedAtEpochMilliseconds: number;
  completedAtEpochMilliseconds: number;
  clock?: Clock;
  targets?: RecoveryDrillTargets;
}>;

export type RecoveryDrillFindingSeverity = "critical" | "warning";

export type RecoveryDrillFinding = Readonly<{
  code: string;
  severity: RecoveryDrillFindingSeverity;
  safeDetailCode: string;
}>;

export type RecoveryDrillStatus = "passed" | "failed";

export type RecoveryDrillResult = Readonly<{
  status: RecoveryDrillStatus;
  safeBackupRef: string;
  checkedAtEpochMilliseconds: number;
  backupAgeMilliseconds: number;
  restoreDurationMilliseconds: number;
  rpoTargetMilliseconds: number;
  rtoTargetMilliseconds: number;
  recoveredDataset: RecoveryDrillDataset;
  findings: readonly RecoveryDrillFinding[];
}>;

export type RecoveryDrillFixtureOptions = Readonly<{
  checkedAtEpochMilliseconds?: number;
  restoreDurationMilliseconds?: number;
}>;

export const defaultRecoveryDrillTargets: RecoveryDrillTargets = Object.freeze({
  maxRpoMilliseconds: dayMilliseconds,
  maxRtoMilliseconds: 4 * hourMilliseconds,
  minimumRetentionDays: 14,
});

const counterFindingCodes: Readonly<Record<RecoveryDrillNumericCounter, string>> = Object.freeze({
  instanceCount: "restore_dataset_instance_count_mismatch",
  activeSessionCount: "restore_dataset_active_session_count_mismatch",
  messageCount: "restore_dataset_message_count_mismatch",
  queueJobCount: "restore_dataset_queue_job_count_mismatch",
  webhookSubscriptionCount: "restore_dataset_webhook_subscription_count_mismatch",
  webhookDeliveryCount: "restore_dataset_webhook_delivery_count_mismatch",
  auditRecordCount: "restore_dataset_audit_record_count_mismatch",
  eventCount: "restore_dataset_event_count_mismatch",
  mediaObjectCount: "restore_dataset_media_object_count_mismatch",
});

const unsafeSecretKeyPattern = /(?:secret|api[_-]?key|token|credential|password|sessionMaterial)/iu;
const safeReferenceKeyPattern = /(?:secretRefs|credentialRefs|safe[A-Z].*Ref|.*Ref)$/iu;
const unsafeSecretValuePattern =
  /(?:synthetic[-_\s]?(?:session|webhook|api)?[-_\s]?secret|raw[-_\s].*secret|plaintext[-_\s].*secret)/iu;

export function runBackupRestoreRecoveryDrill(input: RecoveryDrillInput): RecoveryDrillResult {
  const targets = freezeTargets(input.targets ?? defaultRecoveryDrillTargets);
  const checkedAtEpochMilliseconds =
    input.clock?.epochMilliseconds() ?? systemClock.epochMilliseconds();
  const backupAgeMilliseconds =
    checkedAtEpochMilliseconds - input.backupArtifact.createdAtEpochMilliseconds;
  const restoreDurationMilliseconds =
    input.completedAtEpochMilliseconds - input.startedAtEpochMilliseconds;
  const findings: RecoveryDrillFinding[] = [];

  if (!input.backupArtifact.encrypted) {
    findings.push(createFinding("backup_artifact_not_encrypted"));
  }

  if (!input.backupArtifact.integrityVerified) {
    findings.push(createFinding("backup_integrity_not_verified"));
  }

  if (input.backupArtifact.retentionDays < targets.minimumRetentionDays) {
    findings.push(createFinding("backup_retention_below_target"));
  }

  if (backupAgeMilliseconds < 0) {
    findings.push(createFinding("backup_artifact_from_future"));
  }

  if (backupAgeMilliseconds > targets.maxRpoMilliseconds) {
    findings.push(createFinding("backup_age_exceeds_rpo_target"));
  }

  if (restoreDurationMilliseconds < 0) {
    findings.push(createFinding("restore_duration_invalid"));
  }

  if (restoreDurationMilliseconds > targets.maxRtoMilliseconds) {
    findings.push(createFinding("restore_duration_exceeds_rto_target"));
  }

  if (input.backupArtifact.containsSecretMaterial) {
    findings.push(createFinding("backup_contains_secret_material"));
  }

  if (input.backupArtifact.redisSnapshotIncluded) {
    findings.push(createFinding("redis_snapshot_included_as_recoverable_state"));
  }

  const unsafeSecretPaths = findUnsafeSecretMaterial(input.backupArtifact.opaquePayload);
  if (unsafeSecretPaths.length > 0) {
    findings.push(
      createFinding("backup_payload_contains_secret_material", unsafeSecretPaths.join("|")),
    );
  }

  findings.push(
    ...compareRestoredDataset(input.backupArtifact.sourceDataset, input.restoredDataset),
  );

  return freezeResult({
    status: findings.some((finding) => finding.severity === "critical") ? "failed" : "passed",
    safeBackupRef: input.backupArtifact.safeBackupRef,
    checkedAtEpochMilliseconds,
    backupAgeMilliseconds,
    restoreDurationMilliseconds,
    rpoTargetMilliseconds: targets.maxRpoMilliseconds,
    rtoTargetMilliseconds: targets.maxRtoMilliseconds,
    recoveredDataset: freezeDataset(input.restoredDataset),
    findings,
  });
}

export function createProductionLikeRecoveryDrillFixture(
  options: RecoveryDrillFixtureOptions = {},
): RecoveryDrillInput {
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? 1_800_000_000_000;
  const restoreDurationMilliseconds = options.restoreDurationMilliseconds ?? 30 * 60 * 1000;
  const sourceDataset = freezeDataset({
    instanceCount: 3,
    activeSessionCount: 2,
    messageCount: 250,
    queueJobCount: 12,
    webhookSubscriptionCount: 4,
    webhookDeliveryCount: 41,
    auditRecordCount: 73,
    eventCount: 128,
    mediaObjectCount: 18,
    sessionCredentialRefs: [
      "secretref:session:instance_primary",
      "secretref:session:instance_support",
    ],
    mediaObjectRefs: ["objectref:media:001", "objectref:media:002", "objectref:media:003"],
  });
  const startedAtEpochMilliseconds = checkedAtEpochMilliseconds + 5 * 60 * 1000;

  return Object.freeze({
    backupArtifact: Object.freeze({
      safeBackupRef: "backup:drill:latest",
      createdAtEpochMilliseconds: checkedAtEpochMilliseconds - hourMilliseconds,
      encrypted: true,
      integrityVerified: true,
      retentionDays: 14,
      sourceDataset,
      containsSecretMaterial: false,
      redisSnapshotIncluded: false,
      opaquePayload: Object.freeze({
        manifestRef: "manifest:backup:drill:latest",
        sessionCredentialRefs: sourceDataset.sessionCredentialRefs,
        mediaObjectRefs: sourceDataset.mediaObjectRefs,
      }),
    }),
    restoredDataset: sourceDataset,
    startedAtEpochMilliseconds,
    completedAtEpochMilliseconds: startedAtEpochMilliseconds + restoreDurationMilliseconds,
    clock: fixedClock(checkedAtEpochMilliseconds),
    targets: defaultRecoveryDrillTargets,
  });
}

function compareRestoredDataset(
  sourceDataset: RecoveryDrillDataset,
  restoredDataset: RecoveryDrillDataset,
): RecoveryDrillFinding[] {
  const findings: RecoveryDrillFinding[] = [];

  for (const counter of recoveryDrillNumericCounters) {
    if (sourceDataset[counter] !== restoredDataset[counter]) {
      findings.push(createFinding(counterFindingCodes[counter]));
    }
  }

  if (
    !stringSetsEqual(sourceDataset.sessionCredentialRefs, restoredDataset.sessionCredentialRefs)
  ) {
    findings.push(createFinding("restore_dataset_session_credential_refs_mismatch"));
  }

  if (!stringSetsEqual(sourceDataset.mediaObjectRefs, restoredDataset.mediaObjectRefs)) {
    findings.push(createFinding("restore_dataset_media_object_refs_mismatch"));
  }

  return findings;
}

function findUnsafeSecretMaterial(value: unknown, safePath = "$"): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === "string") {
    return unsafeSecretValuePattern.test(value) ? [safePath] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUnsafeSecretMaterial(item, `${safePath}[${index}]`));
  }

  if (!isRecord(value)) {
    return [];
  }

  const findings: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${safePath}.${key}`;
    if (unsafeSecretKeyPattern.test(key) && !isSafeReferenceField(key, child)) {
      findings.push(childPath);
      continue;
    }

    findings.push(...findUnsafeSecretMaterial(child, childPath));
  }

  return findings;
}

function isSafeReferenceField(key: string, value: unknown): boolean {
  if (!safeReferenceKeyPattern.test(key)) {
    return false;
  }

  if (typeof value === "string") {
    return isSafeReferenceValue(value);
  }

  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string" && isSafeReferenceValue(item));
  }

  return false;
}

function isSafeReferenceValue(value: string): boolean {
  return /^(?:secretref|objectref|manifest):[a-z0-9:_-]+$/u.test(value);
}

function stringSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function fixedClock(epochMilliseconds: number): Clock {
  return Object.freeze({
    now: () => new Date(epochMilliseconds),
    epochMilliseconds: () => epochMilliseconds,
    isoNow: () => toIsoTimestamp(new Date(epochMilliseconds)),
  });
}

function freezeTargets(targets: RecoveryDrillTargets): RecoveryDrillTargets {
  return Object.freeze({ ...targets });
}

function freezeDataset(dataset: RecoveryDrillDataset): RecoveryDrillDataset {
  return Object.freeze({
    ...dataset,
    sessionCredentialRefs: Object.freeze([...dataset.sessionCredentialRefs]),
    mediaObjectRefs: Object.freeze([...dataset.mediaObjectRefs]),
  });
}

function createFinding(code: string, safeDetailCode = code): RecoveryDrillFinding {
  return Object.freeze({
    code,
    severity: "critical",
    safeDetailCode,
  });
}

function freezeResult(report: {
  status: RecoveryDrillStatus;
  safeBackupRef: string;
  checkedAtEpochMilliseconds: number;
  backupAgeMilliseconds: number;
  restoreDurationMilliseconds: number;
  rpoTargetMilliseconds: number;
  rtoTargetMilliseconds: number;
  recoveredDataset: RecoveryDrillDataset;
  findings: readonly RecoveryDrillFinding[];
}): RecoveryDrillResult {
  return Object.freeze({
    ...report,
    recoveredDataset: freezeDataset(report.recoveredDataset),
    findings: Object.freeze([...report.findings]),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
