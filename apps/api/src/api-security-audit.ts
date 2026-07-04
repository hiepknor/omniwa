import { createHash } from "node:crypto";

import type { SecurityAuditEvidenceApplicationService } from "@omniwa/application";
import { DurableJsonStateStore } from "@omniwa/infrastructure-persistence";
import type { ApiCredentialKind } from "@omniwa/interface-api";

import type { ApiRateLimitEndpointClass } from "./api-rate-limiter.js";
import type { ApiResourceOwnershipResourceType } from "./resource-ownership.js";

export const apiSecurityAuditEventTypes = [
  "authentication_denied",
  "authorization_denied",
  "rate_limit_denied",
  "admin_bypass",
  "admin_action",
] as const;

export type ApiSecurityAuditEventType = (typeof apiSecurityAuditEventTypes)[number];

export type ApiSecurityAuditEvent = Readonly<{
  eventType: ApiSecurityAuditEventType;
  requestId: string;
  correlationId: string;
  timestamp: string;
  method: string;
  path: string;
  code: string;
  statusCode: number;
  keyId?: string;
  credentialKind?: ApiCredentialKind;
  operationRef?: string;
  targetRef?: string;
  instanceRef?: string;
  resourceType?: ApiResourceOwnershipResourceType;
  endpointClass?: ApiRateLimitEndpointClass;
  rateLimitBucketKey?: string;
}>;

export interface ApiSecurityAuditSink {
  record(event: ApiSecurityAuditEvent): Promise<void> | void;
}

type ApiSecurityAuditState = Readonly<{
  events: readonly ApiSecurityAuditEvent[];
}>;

export class InMemoryApiSecurityAuditSink implements ApiSecurityAuditSink {
  private readonly events: ApiSecurityAuditEvent[] = [];

  record(event: ApiSecurityAuditEvent): void {
    this.events.push(Object.freeze({ ...event }));
  }

  snapshot(): readonly ApiSecurityAuditEvent[] {
    return Object.freeze([...this.events]);
  }

  clear(): void {
    this.events.length = 0;
  }
}

export class DurableJsonApiSecurityAuditSink implements ApiSecurityAuditSink {
  private readonly store: DurableJsonStateStore<ApiSecurityAuditState>;

  constructor(filePath: string) {
    this.store = new DurableJsonStateStore(filePath, () => ({ events: [] }));
  }

  record(event: ApiSecurityAuditEvent): void {
    const state = this.store.read();

    this.store.write({
      events: Object.freeze([...state.events, normalizeAuditEvent(event)]),
    });
  }

  snapshot(): readonly ApiSecurityAuditEvent[] {
    return Object.freeze(this.store.read().events.map(normalizeAuditEvent));
  }

  clear(): void {
    this.store.write({ events: [] });
  }
}

export class DomainAuditRecordApiSecurityAuditSink implements ApiSecurityAuditSink {
  private readonly service: SecurityAuditEvidenceApplicationService;

  constructor(service: SecurityAuditEvidenceApplicationService) {
    this.service = service;
  }

  async record(event: ApiSecurityAuditEvent): Promise<void> {
    const normalized = normalizeAuditEvent(event);
    const result = await this.service.record({
      sourceSignalRef: createAuditSourceSignalRef(normalized),
      auditCategory: `api_security.${normalized.eventType}`,
      evidenceSummaryCode: createAuditEvidenceSummaryCode(normalized),
      dataClassification: "internal",
      redacted: true,
    });

    if (!result.ok) {
      throw new Error(result.error.code);
    }
  }
}

function normalizeAuditEvent(event: ApiSecurityAuditEvent): ApiSecurityAuditEvent {
  return Object.freeze({
    eventType: event.eventType,
    requestId: event.requestId,
    correlationId: event.correlationId,
    timestamp: event.timestamp,
    method: event.method,
    path: event.path,
    code: event.code,
    statusCode: event.statusCode,
    ...optional("keyId", event.keyId),
    ...optional("credentialKind", event.credentialKind),
    ...optional("operationRef", event.operationRef),
    ...optional("targetRef", event.targetRef),
    ...optional("instanceRef", event.instanceRef),
    ...optional("resourceType", event.resourceType),
    ...optional("endpointClass", event.endpointClass),
    ...optional("rateLimitBucketKey", event.rateLimitBucketKey),
  });
}

function createAuditSourceSignalRef(event: ApiSecurityAuditEvent): string {
  const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 32);

  return `api_security.${digest}`;
}

function createAuditEvidenceSummaryCode(event: ApiSecurityAuditEvent): string {
  return `api_security.${event.eventType}.${safeCodeSegment(event.code)}.${event.statusCode}`;
}

function safeCodeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "_")
    .replace(/^[_\-.]+|[_\-.]+$/gu, "");

  return normalized.length === 0 || !/^[a-z]/u.test(normalized)
    ? `code_${normalized || "unknown"}`
    : normalized;
}

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
