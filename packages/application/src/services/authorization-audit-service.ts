import {
  createAccessDecisionAggregate,
  createAccessDecisionId,
  createAuditRecordAggregate,
  createAuditRecordId,
  createRetentionPolicy,
  evaluateAuditRedactionPolicy,
  evaluatePrivilegedActionPolicy,
  type AccessDecision,
  type AccessDecisionId,
  type AccessDecisionRepositoryPort,
  type AuditRecord,
  type AuditRecordId,
  type AuditRecordRepositoryPort,
  type DomainDataClassification,
  type RetentionPolicy,
} from "@omniwa/domain";
import { cryptoUUIDGenerator, err, ok, type Result, type UUIDGenerator } from "@omniwa/shared";

import {
  getApplicationCommandDefinition,
  type ApplicationCommandName,
} from "../commands/command-catalog.js";
import type { ApplicationCommandEnvelope } from "../commands/command-model.js";
import { createApplicationError, type ApplicationError } from "../errors/application-error.js";

export type AccessDecisionOutcome = "granted" | "denied";

export type AccessDecisionTargetContextRecorder = Readonly<{
  recordTargetContext(
    decisionId: AccessDecisionId,
    targetContextRef: string,
  ): Promise<void> | void;
}>;

export type AuditRecordSourceSignalRecorder = Readonly<{
  recordSourceSignal(auditRecordId: AuditRecordId, sourceSignalRef: string): Promise<void> | void;
}>;

export type AuthorizationAuditRepositories = Readonly<{
  accessDecisionRepository: AccessDecisionRepositoryPort & AccessDecisionTargetContextRecorder;
  auditRecordRepository: AuditRecordRepositoryPort & AuditRecordSourceSignalRecorder;
}>;

export type AuditEvidenceInput = Readonly<{
  sourceSignalRef?: string;
  auditCategory?: string;
  evidenceSummaryCode?: string;
  dataClassification?: DomainDataClassification;
  redacted?: boolean;
  retentionPolicy?: RetentionPolicy;
}>;

export type AuthorizeApplicationCommandInput = Readonly<{
  command: ApplicationCommandEnvelope;
  accessOutcome: AccessDecisionOutcome;
  capability?: string;
  targetContextRef?: string;
  privileged?: boolean;
  auditEvidence?: AuditEvidenceInput;
}>;

export type AuthorizationAuditDecision = Readonly<{
  allowed: boolean;
  privileged: boolean;
  capability: string;
  targetContextRef: string;
  accessDecision: AccessDecision;
  auditRecord?: AuditRecord;
}>;

export type AuthorizationAuditServiceOptions = Readonly<{
  repositories: AuthorizationAuditRepositories;
  uuidGenerator?: UUIDGenerator;
  defaultAuditRetentionPolicy?: RetentionPolicy;
}>;

export type AuthorizationAuditResult = Result<AuthorizationAuditDecision, ApplicationError>;

const defaultAuditRetentionPolicy = createRetentionPolicy({
  category: "audit_record",
  retentionDays: 180,
});

export class AuthorizationAuditApplicationService {
  private readonly repositories: AuthorizationAuditRepositories;
  private readonly uuidGenerator: UUIDGenerator;
  private readonly defaultAuditRetentionPolicy: RetentionPolicy;

  constructor(options: AuthorizationAuditServiceOptions) {
    this.repositories = options.repositories;
    this.uuidGenerator = options.uuidGenerator ?? cryptoUUIDGenerator;
    this.defaultAuditRetentionPolicy =
      options.defaultAuditRetentionPolicy ?? defaultAuditRetentionPolicy;
  }

  async authorizeCommand(
    input: AuthorizeApplicationCommandInput,
  ): Promise<AuthorizationAuditResult> {
    const commandDefinition = getApplicationCommandDefinition(input.command.name);
    const actorRef = input.command.actorRef;

    if (actorRef === undefined) {
      return err(
        applicationError(
          "authorization",
          "missing_actor_ref",
          "Protected Application commands require a safe actor reference.",
          false,
          "security_access",
        ),
      );
    }

    const privileged = input.privileged ?? commandDefinition.privileged;
    const capability = input.capability ?? capabilityFromCommand(input.command.name);
    const targetContextRef = input.targetContextRef ?? input.command.targetRef ?? "global";
    const accessDecisionResult = await this.resolveAccessDecision({
      actorRef,
      capability,
      targetContextRef,
      outcome: input.accessOutcome,
      privileged,
    });

    if (!accessDecisionResult.ok) {
      return accessDecisionResult;
    }

    const accessDecision = accessDecisionResult.value;
    const allowed = privileged
      ? evaluatePrivilegedActionPolicy(accessDecision, accessDecision.capability).outcome ===
        "allow"
      : accessDecision.outcome === "granted" && accessDecision.status === "granted";
    const auditRecordResult =
      privileged || input.auditEvidence !== undefined
        ? await this.recordAuditEvidence({
            command: input.command,
            accessOutcome: input.accessOutcome,
            accessAllowed: allowed,
            evidence: input.auditEvidence,
          })
        : ok(undefined);

    if (!auditRecordResult.ok) {
      return auditRecordResult;
    }

    const decision = {
      allowed,
      privileged,
      capability: accessDecision.capability,
      targetContextRef,
      accessDecision,
    };

    return ok(
      freezeAuthorizationAuditDecision(
        auditRecordResult.value === undefined
          ? decision
          : { ...decision, auditRecord: auditRecordResult.value },
      ),
    );
  }

  private async resolveAccessDecision(input: {
    actorRef: string;
    capability: string;
    targetContextRef: string;
    outcome: AccessDecisionOutcome;
    privileged: boolean;
  }): Promise<Result<AccessDecision, ApplicationError>> {
    try {
      const candidate = createAccessDecisionAggregate({
        id: createAccessDecisionId(this.uuidGenerator.random()),
        actorRef: input.actorRef,
        capability: input.capability,
        outcome: input.outcome,
        privileged: input.privileged,
      });
      const existing = await this.repositories.accessDecisionRepository.findUnexpiredByCapability(
        candidate.actorRef,
        candidate.capability,
        input.targetContextRef,
      );

      if (existing !== undefined) {
        return ok(existing);
      }

      await this.repositories.accessDecisionRepository.save(candidate);
      await this.repositories.accessDecisionRepository.recordTargetContext(
        candidate.id,
        input.targetContextRef,
      );

      return ok(candidate);
    } catch (error) {
      return err(
        applicationError(
          "validation",
          "invalid_access_decision",
          errorMessage(error, "Access decision input is invalid."),
          false,
          "security_access",
        ),
      );
    }
  }

  private async recordAuditEvidence(input: {
    command: ApplicationCommandEnvelope;
    accessOutcome: AccessDecisionOutcome;
    accessAllowed: boolean;
    evidence: AuditEvidenceInput | undefined;
  }): Promise<Result<AuditRecord | undefined, ApplicationError>> {
    const evidence = completeAuditEvidence(input);
    const safety = evaluateAuditRedactionPolicy({
      sourceSignalRef: evidence.sourceSignalRef,
      dataClassification: evidence.dataClassification,
      redacted: evidence.redacted,
      retentionCategoryPresent: true,
    });

    if (safety.outcome !== "allow") {
      return err(
        applicationError(
          "validation",
          "unsafe_audit_evidence",
          safety.specification.passed
            ? "Audit evidence was rejected by policy."
            : safety.specification.error.message,
          false,
          "audit",
        ),
      );
    }

    try {
      const existingRecords = await this.repositories.auditRecordRepository.findBySourceSignal(
        evidence.sourceSignalRef,
      );
      const existingRecord = existingRecords.find(
        (record) => record.auditCategory === evidence.auditCategory,
      );

      if (existingRecord !== undefined) {
        return ok(existingRecord);
      }

      const auditRecord = createAuditRecordAggregate({
        id: createAuditRecordId(this.uuidGenerator.random()),
        auditCategory: evidence.auditCategory,
        retentionPolicy: evidence.retentionPolicy,
        evidenceSummaryCode: evidence.evidenceSummaryCode,
        redacted: evidence.redacted,
      });

      await this.repositories.auditRecordRepository.save(auditRecord);
      await this.repositories.auditRecordRepository.recordSourceSignal(
        auditRecord.id,
        evidence.sourceSignalRef,
      );

      return ok(auditRecord);
    } catch (error) {
      return err(
        applicationError(
          "validation",
          "invalid_audit_evidence",
          errorMessage(error, "Audit evidence input is invalid."),
          false,
          "audit",
        ),
      );
    }
  }
}

type CompleteAuditEvidence = Readonly<{
  sourceSignalRef: string;
  auditCategory: string;
  evidenceSummaryCode: string;
  dataClassification: DomainDataClassification;
  redacted: boolean;
  retentionPolicy: RetentionPolicy;
}>;

function completeAuditEvidence(input: {
  command: ApplicationCommandEnvelope;
  accessOutcome: AccessDecisionOutcome;
  accessAllowed: boolean;
  evidence: AuditEvidenceInput | undefined;
}): CompleteAuditEvidence {
  const commandCode = commandNameToSafeCode(input.command.name);
  const outcomeCode = input.accessAllowed ? "allowed" : "blocked";

  return Object.freeze({
    sourceSignalRef: input.evidence?.sourceSignalRef ?? input.command.commandRef,
    auditCategory: input.evidence?.auditCategory ?? `authorization.${commandCode}`,
    evidenceSummaryCode:
      input.evidence?.evidenceSummaryCode ?? `${commandCode}_${input.accessOutcome}_${outcomeCode}`,
    dataClassification:
      input.evidence?.dataClassification ?? input.command.dataClassification ?? "internal",
    redacted: input.evidence?.redacted ?? false,
    retentionPolicy: input.evidence?.retentionPolicy ?? defaultAuditRetentionPolicy,
  });
}

function capabilityFromCommand(commandName: ApplicationCommandName): string {
  return `command.${commandNameToSafeCode(commandName)}`;
}

function commandNameToSafeCode(commandName: ApplicationCommandName): string {
  return commandName
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1_$2")
    .toLowerCase();
}

function applicationError(
  category: ApplicationError["category"],
  code: string,
  message: string,
  retryable: boolean,
  ownerContext: NonNullable<ApplicationError["ownerContext"]>,
): ApplicationError {
  return createApplicationError({
    category,
    code,
    message,
    recoverability: retryable ? "time_correctable" : "caller_correctable",
    retryable,
    ownerContext,
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function freezeAuthorizationAuditDecision(
  decision: AuthorizationAuditDecision,
): AuthorizationAuditDecision {
  return Object.freeze(decision);
}
