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

function optional<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}
