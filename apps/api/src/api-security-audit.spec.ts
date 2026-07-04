import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DurableJsonApiSecurityAuditSink,
  InMemoryApiSecurityAuditSink,
  type ApiSecurityAuditEvent,
} from "./api-security-audit.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("API security audit sinks", () => {
  it("keeps in-memory denied-decision evidence safe and inspectable", () => {
    const sink = new InMemoryApiSecurityAuditSink();

    sink.record(auditEvent());

    expect(sink.snapshot()).toEqual([auditEvent()]);
  });

  it("persists durable JSON audit evidence across sink reloads", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-security-audit-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "audit-log.json");
    const firstSink = new DurableJsonApiSecurityAuditSink(filePath);

    firstSink.record(auditEvent({ requestId: "req-durable-1" }));

    const secondSink = new DurableJsonApiSecurityAuditSink(filePath);

    expect(secondSink.snapshot()).toEqual([auditEvent({ requestId: "req-durable-1" })]);
  });

  it("does not serialize unexpected raw secret fields into durable JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-security-audit-redaction-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "audit-log.json");
    const sink = new DurableJsonApiSecurityAuditSink(filePath);

    sink.record({
      ...auditEvent(),
      rawApiKey: "raw-secret-should-not-persist",
    } as ApiSecurityAuditEvent & { rawApiKey: string });

    expect(readFileSync(filePath, "utf8")).not.toContain("raw-secret-should-not-persist");
    expect(sink.snapshot()).toEqual([auditEvent()]);
  });
});

function auditEvent(overrides: Partial<ApiSecurityAuditEvent> = {}): ApiSecurityAuditEvent {
  return Object.freeze({
    eventType: "authentication_denied",
    requestId: "req-audit-1",
    correlationId: "corr-audit-1",
    timestamp: "2026-07-05T00:00:00.000Z",
    method: "GET",
    path: "/v1/instances",
    code: "missing_or_invalid_api_key",
    statusCode: 401,
    ...overrides,
  });
}
