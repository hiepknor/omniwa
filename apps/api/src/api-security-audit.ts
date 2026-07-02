import type { ApiCredentialKind } from "@omniwa/interface-api";

import type { ApiRateLimitEndpointClass } from "./api-rate-limiter.js";
import type { ApiResourceOwnershipResourceType } from "./resource-ownership.js";

export const apiSecurityAuditEventTypes = [
  "authentication_denied",
  "authorization_denied",
  "rate_limit_denied",
  "admin_bypass",
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
