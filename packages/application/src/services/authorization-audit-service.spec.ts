import {
  type AccessDecision,
  type AccessDecisionId,
  type AccessDecisionRepositoryPort,
  type AuditRecord,
  type AuditRecordId,
  type AuditRecordRepositoryPort,
  type RepositorySaveResult,
} from "@omniwa/domain";
import {
  createCorrelationId,
  createRequestContext,
  createRequestId,
  createUuid,
  type UUIDGenerator,
} from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createApplicationCommandEnvelope } from "../commands/command-model.js";
import {
  AuthorizationAuditApplicationService,
  type AccessDecisionTargetContextRecorder,
  type AuditRecordSourceSignalRecorder,
} from "./authorization-audit-service.js";

const requestContext = createRequestContext({
  correlationId: createCorrelationId("authorization-audit-correlation"),
  requestId: createRequestId("authorization-audit-request"),
});

describe("AuthorizationAuditApplicationService", () => {
  it("grants privileged command access and records audit evidence before mutation", async () => {
    const repositories = createFakeRepositories();
    const service = createService(repositories);
    const command = createApplicationCommandEnvelope({
      name: "DestroyInstance",
      commandRef: "destroy-instance-command",
      requestContext,
      actorRef: "admin.operator",
      targetRef: "instance_1",
      dataClassification: "internal",
    });

    const result = await service.authorizeCommand({
      command,
      accessOutcome: "granted",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value).toMatchObject({
      allowed: true,
      privileged: true,
      capability: "command.destroy_instance",
      targetContextRef: "instance_1",
    });
    expect(result.value.accessDecision).toMatchObject({
      actorRef: "admin.operator",
      capability: "command.destroy_instance",
      status: "granted",
      outcome: "granted",
      privileged: true,
      auditEligible: true,
    });
    expect(result.value.auditRecord).toMatchObject({
      auditCategory: "authorization.destroy_instance",
      evidenceSummaryCode: "destroy_instance_granted_allowed",
      status: "recorded",
    });
    expect(repositories.accessDecisionRepository.list()).toHaveLength(1);
    expect(repositories.auditRecordRepository.list()).toHaveLength(1);
  });

  it("persists denied privileged access with safe audit evidence and blocks mutation", async () => {
    const repositories = createFakeRepositories();
    const service = createService(repositories);
    const command = createApplicationCommandEnvelope({
      name: "RequestDiagnosticCapture",
      commandRef: "diagnostic-command",
      requestContext,
      actorRef: "operator.limited",
      targetRef: "media_1",
      dataClassification: "internal",
    });

    const result = await service.authorizeCommand({
      command,
      accessOutcome: "denied",
      auditEvidence: {
        sourceSignalRef: "diagnostic.denied.v1",
        evidenceSummaryCode: "diagnostic_denied",
      },
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.value.allowed).toBe(false);
    expect(result.value.accessDecision).toMatchObject({
      status: "denied",
      outcome: "denied",
      privileged: true,
      auditEligible: true,
    });
    expect(result.value.auditRecord).toMatchObject({
      auditCategory: "authorization.request_diagnostic_capture",
      evidenceSummaryCode: "diagnostic_denied",
      status: "recorded",
    });
  });

  it("rejects unsafe confidential audit evidence before an audit record is stored", async () => {
    const repositories = createFakeRepositories();
    const service = createService(repositories);
    const command = createApplicationCommandEnvelope({
      name: "DestroyInstance",
      commandRef: "unsafe-audit-command",
      requestContext,
      actorRef: "admin.operator",
      targetRef: "instance_2",
      dataClassification: "confidential",
    });

    const result = await service.authorizeCommand({
      command,
      accessOutcome: "granted",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "validation",
      code: "unsafe_audit_evidence",
      ownerContext: "audit",
    });
    expect(repositories.accessDecisionRepository.list()).toHaveLength(1);
    expect(repositories.auditRecordRepository.list()).toHaveLength(0);
  });

  it("reuses existing access and audit records for the same target and source signal", async () => {
    const repositories = createFakeRepositories();
    const service = createService(repositories);
    const command = createApplicationCommandEnvelope({
      name: "DestroyInstance",
      commandRef: "repeat-destroy-command",
      requestContext,
      actorRef: "admin.operator",
      targetRef: "instance_repeat",
      dataClassification: "confidential",
    });
    const input = {
      command,
      accessOutcome: "granted" as const,
      auditEvidence: {
        sourceSignalRef: "repeat.destroy.v1",
        dataClassification: "confidential" as const,
        redacted: true,
      },
    };

    const first = await service.authorizeCommand(input);
    const second = await service.authorizeCommand(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    if (!first.ok || !second.ok) return;

    expect(second.value.accessDecision).toBe(first.value.accessDecision);
    expect(second.value.auditRecord).toBe(first.value.auditRecord);
    expect(repositories.accessDecisionRepository.list()).toHaveLength(1);
    expect(repositories.auditRecordRepository.list()).toHaveLength(1);
    expect(first.value.auditRecord?.redacted).toBe(true);
  });

  it("rejects protected commands without a safe actor reference", async () => {
    const repositories = createFakeRepositories();
    const service = createService(repositories);
    const command = createApplicationCommandEnvelope({
      name: "DestroyInstance",
      commandRef: "missing-actor-command",
      requestContext,
      targetRef: "instance_3",
    });

    const result = await service.authorizeCommand({
      command,
      accessOutcome: "granted",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "authorization",
      code: "missing_actor_ref",
      ownerContext: "security_access",
    });
    expect(repositories.accessDecisionRepository.list()).toHaveLength(0);
    expect(repositories.auditRecordRepository.list()).toHaveLength(0);
  });
});

function createService(repositories: FakeRepositories): AuthorizationAuditApplicationService {
  return new AuthorizationAuditApplicationService({
    repositories,
    uuidGenerator: fixedUuidGenerator([
      "550e8400-e29b-41d4-a716-446655440001",
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
      "550e8400-e29b-41d4-a716-446655440004",
      "550e8400-e29b-41d4-a716-446655440005",
      "550e8400-e29b-41d4-a716-446655440006",
    ]),
  });
}

type FakeRepositories = Readonly<{
  accessDecisionRepository: FakeAccessDecisionRepository;
  auditRecordRepository: FakeAuditRecordRepository;
}>;

function createFakeRepositories(): FakeRepositories {
  return Object.freeze({
    accessDecisionRepository: new FakeAccessDecisionRepository(),
    auditRecordRepository: new FakeAuditRecordRepository(),
  });
}

class FakeAccessDecisionRepository
  implements AccessDecisionRepositoryPort, AccessDecisionTargetContextRecorder
{
  private readonly records = new Map<string, AccessDecision>();
  private readonly targetContextByDecisionId = new Map<string, string>();

  load(id: AccessDecisionId): Promise<AccessDecision | undefined> {
    return Promise.resolve(this.records.get(keyOf(id)));
  }

  save(aggregate: AccessDecision): Promise<RepositorySaveResult> {
    this.records.set(keyOf(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: AccessDecisionId): Promise<boolean> {
    return Promise.resolve(this.records.has(keyOf(id)));
  }

  findUnexpiredByCapability(
    actorRef: string,
    capability: string,
    targetContextRef: string,
  ): Promise<AccessDecision | undefined> {
    return Promise.resolve(
      this.list().find(
        (decision) =>
          decision.status !== "expired" &&
          decision.actorRef === actorRef &&
          decision.capability === capability &&
          this.targetContextByDecisionId.get(keyOf(decision.id)) === targetContextRef,
      ),
    );
  }

  recordTargetContext(decisionId: AccessDecisionId, targetContextRef: string): void {
    this.targetContextByDecisionId.set(keyOf(decisionId), targetContextRef);
  }

  list(): readonly AccessDecision[] {
    return Object.freeze([...this.records.values()]);
  }
}

class FakeAuditRecordRepository
  implements AuditRecordRepositoryPort, AuditRecordSourceSignalRecorder
{
  private readonly records = new Map<string, AuditRecord>();
  private readonly sourceSignalByAuditRecordId = new Map<string, string>();

  load(id: AuditRecordId): Promise<AuditRecord | undefined> {
    return Promise.resolve(this.records.get(keyOf(id)));
  }

  save(aggregate: AuditRecord): Promise<RepositorySaveResult> {
    this.records.set(keyOf(aggregate.id), aggregate);
    return Promise.resolve({ saved: true });
  }

  exists(id: AuditRecordId): Promise<boolean> {
    return Promise.resolve(this.records.has(keyOf(id)));
  }

  findBySourceSignal(sourceSignalRef: string): Promise<readonly AuditRecord[]> {
    return Promise.resolve(
      this.list().filter(
        (record) => this.sourceSignalByAuditRecordId.get(keyOf(record.id)) === sourceSignalRef,
      ),
    );
  }

  findRetentionExpired(): Promise<readonly AuditRecord[]> {
    return Promise.resolve(this.list().filter((record) => record.status === "retention_expired"));
  }

  recordSourceSignal(auditRecordId: AuditRecordId, sourceSignalRef: string): void {
    this.sourceSignalByAuditRecordId.set(keyOf(auditRecordId), sourceSignalRef);
  }

  list(): readonly AuditRecord[] {
    return Object.freeze([...this.records.values()]);
  }
}

function fixedUuidGenerator(values: readonly string[]): UUIDGenerator {
  let index = 0;

  return {
    random() {
      const value = values[index];
      index += 1;

      if (value === undefined) {
        throw new TypeError("Fixed UUID generator is exhausted.");
      }

      return createUuid(value);
    },
  };
}

function keyOf(value: unknown): string {
  return String(value);
}
