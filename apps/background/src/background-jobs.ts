import {
  createApplicationPortFailure,
  type ApplicationPortContext,
  type ApplicationPortFailure,
  type ApplicationPortResult,
  type QueueProviderPort,
} from "@omniwa/application";
import { err, ok } from "@omniwa/shared";

import type { BackupValidationCapable } from "./recovery-validation.js";

export const backgroundJobKinds = ["queue_recovery", "backup_validation"] as const;

export type BackgroundJobKind = (typeof backgroundJobKinds)[number];

export type BackgroundJobDefinition = Readonly<{
  id: string;
  name: string;
  kind: BackgroundJobKind;
  idempotent: boolean;
  retrySafe: boolean;
}>;

export type QueueRecoveryResult = Readonly<{
  recovered: number;
}>;

export type QueueRecoveryCapableProvider = QueueProviderPort &
  Readonly<{
    recoverVisibleJobs?: () => Promise<QueueRecoveryResult>;
  }>;

export type BackgroundJobOutcome = Readonly<{
  jobId: string;
  kind: BackgroundJobKind;
  status: "completed" | "skipped";
  reasonCode: string;
  recovered?: number;
  validationStatus?: "passed" | "failed";
  findingCount?: number;
}>;

export type BackgroundJobRunnerOptions = Readonly<{
  queueProvider: QueueRecoveryCapableProvider;
  backupValidation?: BackupValidationCapable;
}>;

export const backgroundJobDefinitions: readonly BackgroundJobDefinition[] = Object.freeze([
  Object.freeze({
    id: "BG-QUEUE-RECOVERY",
    name: "Queue Recovery Reconciliation",
    kind: "queue_recovery",
    idempotent: true,
    retrySafe: true,
  }),
  Object.freeze({
    id: "BG-BACKUP-VALIDATION",
    name: "Backup And Restore Validation",
    kind: "backup_validation",
    idempotent: true,
    retrySafe: true,
  }),
]);

export class BackgroundJobRunner {
  private readonly queueProvider: QueueRecoveryCapableProvider;
  private readonly backupValidation: BackupValidationCapable | undefined;

  constructor(options: BackgroundJobRunnerOptions) {
    this.queueProvider = options.queueProvider;
    this.backupValidation = options.backupValidation;
  }

  run(
    definition: BackgroundJobDefinition,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<BackgroundJobOutcome>> {
    switch (definition.kind) {
      case "queue_recovery":
        return this.runQueueRecovery(definition, context);
      case "backup_validation":
        return this.runBackupValidation(definition, context);
    }
  }

  private async runQueueRecovery(
    definition: BackgroundJobDefinition,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<BackgroundJobOutcome>> {
    try {
      void context;

      if (this.queueProvider.recoverVisibleJobs === undefined) {
        return ok(
          freezeOutcome({
            jobId: definition.id,
            kind: definition.kind,
            status: "skipped",
            recovered: 0,
            reasonCode: "queue_recovery_not_supported",
          }),
        );
      }

      const recovery = await this.queueProvider.recoverVisibleJobs();

      return ok(
        freezeOutcome({
          jobId: definition.id,
          kind: definition.kind,
          status: "completed",
          recovered: recovery.recovered,
          reasonCode: "queue_recovery_completed",
        }),
      );
    } catch (error) {
      return err(toBackgroundJobFailure(error));
    }
  }

  private async runBackupValidation(
    definition: BackgroundJobDefinition,
    context: ApplicationPortContext,
  ): Promise<ApplicationPortResult<BackgroundJobOutcome>> {
    try {
      if (this.backupValidation === undefined) {
        return ok(
          freezeOutcome({
            jobId: definition.id,
            kind: definition.kind,
            status: "skipped",
            reasonCode: "backup_validation_not_supported",
          }),
        );
      }

      const validation = await this.backupValidation.validateLatestBackup(context);

      if (!validation.ok) {
        return validation;
      }

      return ok(
        freezeOutcome({
          jobId: definition.id,
          kind: definition.kind,
          status: "completed",
          reasonCode:
            validation.value.status === "passed"
              ? "backup_validation_passed"
              : "backup_validation_action_required",
          validationStatus: validation.value.status,
          findingCount: validation.value.findings.length,
        }),
      );
    } catch (error) {
      return err(toBackgroundJobFailure(error));
    }
  }
}

function freezeOutcome(outcome: BackgroundJobOutcome): BackgroundJobOutcome {
  return Object.freeze(outcome);
}

function toBackgroundJobFailure(error: unknown): ApplicationPortFailure {
  if (error instanceof Error) {
    return createApplicationPortFailure({
      category: "unknown",
      code: "background_job_failed",
      message: "Background job failed before a safe outcome was recorded.",
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
    code: "background_job_failed",
    message: "Background job failed before a safe outcome was recorded.",
    retryable: true,
    ownerContext: "operations",
    failureCategory: "unexpected",
  });
}
