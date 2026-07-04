import {
  type AuditRecord,
  type AuditRecordId,
  type AuditRecordRepositoryPort,
  type RepositorySaveResult,
} from "@omniwa/domain";
import { createUuid, type UUIDGenerator } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import type { AuditRecordSourceSignalRecorder } from "./authorization-audit-service.js";
import { SecurityAuditEvidenceApplicationService } from "./security-audit-evidence-service.js";

describe("SecurityAuditEvidenceApplicationService", () => {
  it("records safe security audit evidence as an AuditRecord", async () => {
    const repository = new FakeAuditRecordRepository();
    const service = createService(repository);

    const result = await service.record({
      sourceSignalRef: "api_security.signal_1",
      auditCategory: "api_security.authentication_denied",
      evidenceSummaryCode: "api_security.authentication_denied.missing_or_invalid_api_key.401",
      dataClassification: "internal",
      redacted: true,
    });

    expect(result.ok).toBe(true);
    expect(repository.list()).toEqual([
      expect.objectContaining({
        auditCategory: "api_security.authentication_denied",
        evidenceSummaryCode: "api_security.authentication_denied.missing_or_invalid_api_key.401",
        status: "recorded",
        redacted: true,
      }),
    ]);
  });

  it("is idempotent for the same source signal and category", async () => {
    const repository = new FakeAuditRecordRepository();
    const service = createService(repository);
    const input = {
      sourceSignalRef: "api_security.signal_duplicate",
      auditCategory: "api_security.rate_limit_denied",
      evidenceSummaryCode: "api_security.rate_limit_denied.rate_limit_exceeded.429",
      dataClassification: "internal" as const,
      redacted: true,
    };

    const first = await service.record(input);
    const second = await service.record(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(repository.list()).toHaveLength(1);
    expect(second.ok && first.ok ? second.value : undefined).toBe(
      first.ok ? first.value : undefined,
    );
  });

  it("rejects unsafe secret audit evidence before persistence", async () => {
    const repository = new FakeAuditRecordRepository();
    const service = createService(repository);

    const result = await service.record({
      sourceSignalRef: "api_security.secret_signal",
      auditCategory: "api_security.authentication_denied",
      evidenceSummaryCode: "api_security.authentication_denied.secret.401",
      dataClassification: "secret",
      redacted: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      category: "validation",
      code: "unsafe_audit_evidence",
      ownerContext: "audit",
    });
    expect(repository.list()).toHaveLength(0);
  });
});

function createService(
  auditRecordRepository: FakeAuditRecordRepository,
): SecurityAuditEvidenceApplicationService {
  return new SecurityAuditEvidenceApplicationService({
    auditRecordRepository,
    uuidGenerator: fixedUuidGenerator([
      "550e8400-e29b-41d4-a716-446655440101",
      "550e8400-e29b-41d4-a716-446655440102",
    ]),
  });
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
