import type { ApiCredential } from "@omniwa/interface-api";

export const apiResourceOwnershipResourceTypes = [
  "instance",
  "session",
  "message",
  "media",
  "chat",
  "contact",
  "label",
  "group",
  "webhook",
  "delivery",
  "job",
  "event",
  "audit_record",
  "api_key",
  "settings",
  "provider",
  "metrics",
  "health",
  "unknown",
] as const;

export type ApiResourceOwnershipResourceType = (typeof apiResourceOwnershipResourceTypes)[number];

export type ApiResourceOwnershipRequest = Readonly<{
  credential: ApiCredential;
  resourceType: ApiResourceOwnershipResourceType;
  targetRef?: string;
  operationRef: string;
}>;

export type ApiResourceOwnershipResolution =
  | Readonly<{
      status: "resolved";
      instanceRef: string;
    }>
  | Readonly<{
      status: "unresolved";
    }>;

export interface ApiResourceOwnershipResolver {
  resolve(request: ApiResourceOwnershipRequest): Promise<ApiResourceOwnershipResolution>;
}

export type ApiResourceOwnershipRecord = Readonly<{
  resourceType: ApiResourceOwnershipResourceType;
  resourceRef: string;
  instanceRef: string;
}>;

export type ApiResourceOwnershipDecision = Readonly<
  | {
      allowed: true;
      instanceRef?: string;
      resourceType: ApiResourceOwnershipResourceType;
      bypass?: "admin_scope";
    }
  | {
      allowed: false;
      code: "resource_ownership_denied" | "resource_ownership_unresolved";
      message: string;
      resourceType: ApiResourceOwnershipResourceType;
    }
>;

export class InMemoryApiResourceOwnershipResolver implements ApiResourceOwnershipResolver {
  private readonly records = new Map<string, ApiResourceOwnershipRecord>();

  constructor(records: readonly ApiResourceOwnershipRecord[] = []) {
    for (const record of records) {
      this.upsert(record);
    }
  }

  resolve(request: ApiResourceOwnershipRequest): Promise<ApiResourceOwnershipResolution> {
    if (request.targetRef === undefined) {
      return Promise.resolve(Object.freeze({ status: "unresolved" }));
    }

    const record = this.records.get(
      createOwnershipRecordKey(request.resourceType, request.targetRef),
    );

    if (record === undefined) {
      return Promise.resolve(Object.freeze({ status: "unresolved" }));
    }

    return Promise.resolve(
      Object.freeze({
        status: "resolved",
        instanceRef: record.instanceRef,
      }),
    );
  }

  upsert(record: ApiResourceOwnershipRecord): void {
    if (!isInstanceRef(record.instanceRef)) {
      throw new TypeError("Resource ownership records must resolve to an instance ref.");
    }

    this.records.set(
      createOwnershipRecordKey(record.resourceType, record.resourceRef),
      Object.freeze({ ...record }),
    );
  }

  delete(resourceType: ApiResourceOwnershipResourceType, resourceRef: string): void {
    this.records.delete(createOwnershipRecordKey(resourceType, resourceRef));
  }

  snapshot(): readonly ApiResourceOwnershipRecord[] {
    return Object.freeze([...this.records.values()]);
  }
}

export async function authorizeApiResourceOwnership(input: {
  credential: ApiCredential;
  resourceType?: ApiResourceOwnershipResourceType;
  targetRef?: string;
  operationRef: string;
  resolver?: ApiResourceOwnershipResolver;
}): Promise<ApiResourceOwnershipDecision> {
  const resourceType =
    input.resourceType ??
    inferApiResourceOwnershipResourceType(input.operationRef, input.targetRef);

  if (input.targetRef === undefined) {
    if (
      input.credential.allowedInstanceRefs !== undefined &&
      !input.credential.scopes.includes("admin:*") &&
      requiresExplicitTargetForInstanceScopedCredential(resourceType)
    ) {
      return Object.freeze({
        allowed: false,
        code: "resource_ownership_unresolved",
        message: "API resource ownership could not be resolved.",
        resourceType,
      });
    }

    return Object.freeze({ allowed: true, resourceType });
  }

  if (input.credential.scopes.includes("admin:*")) {
    return Object.freeze({
      allowed: true,
      resourceType,
      bypass: "admin_scope",
    });
  }

  if (input.credential.allowedInstanceRefs === undefined) {
    return Object.freeze({ allowed: true, resourceType });
  }

  if (isInstanceRef(input.targetRef)) {
    return decisionForInstanceRef(input.credential, input.targetRef, resourceType);
  }

  if (input.resolver === undefined) {
    return Object.freeze({ allowed: true, resourceType });
  }

  try {
    const resolution = await input.resolver.resolve({
      credential: input.credential,
      resourceType,
      targetRef: input.targetRef,
      operationRef: input.operationRef,
    });

    if (resolution.status === "unresolved") {
      return Object.freeze({
        allowed: false,
        code: "resource_ownership_unresolved",
        message: "API resource ownership could not be resolved.",
        resourceType,
      });
    }

    return decisionForInstanceRef(input.credential, resolution.instanceRef, resourceType);
  } catch {
    return Object.freeze({
      allowed: false,
      code: "resource_ownership_unresolved",
      message: "API resource ownership could not be resolved.",
      resourceType,
    });
  }
}

export function inferApiResourceOwnershipResourceType(
  operationRef: string,
  targetRef?: string,
): ApiResourceOwnershipResourceType {
  if (targetRef !== undefined) {
    if (isInstanceRef(targetRef)) return "instance";
    if (targetRef.startsWith("msg_")) return "message";
    if (targetRef.startsWith("media_")) return "media";
    if (targetRef.startsWith("chat_")) return "chat";
    if (targetRef.startsWith("contact_")) return "contact";
    if (targetRef.startsWith("label_")) return "label";
    if (targetRef.startsWith("group_")) return "group";
    if (targetRef.startsWith("whd_")) return "delivery";
    if (targetRef.startsWith("wh_")) return "webhook";
    if (targetRef.startsWith("job_")) return "job";
    if (targetRef.startsWith("event_")) return "event";
    if (targetRef.startsWith("audit_")) return "audit_record";
  }

  if (operationRef.includes("WebhookDelivery")) return "delivery";
  if (operationRef.includes("Webhook")) return "webhook";
  if (operationRef.includes("WorkerJob")) return "job";
  if (operationRef.includes("Group")) return "group";
  if (operationRef.includes("Instance")) return "instance";
  if (operationRef.includes("Session")) return "session";
  if (operationRef.includes("Message")) return "message";
  if (operationRef.includes("Media")) return "media";
  if (operationRef.includes("Chat")) return "chat";
  if (operationRef.includes("Contact")) return "contact";
  if (operationRef.includes("Label")) return "label";
  if (operationRef.includes("Events")) return "event";
  if (operationRef.includes("Audit")) return "audit_record";
  if (operationRef.includes("ApiKey")) return "api_key";
  if (operationRef.includes("Configuration")) return "settings";
  if (operationRef.includes("Provider")) return "provider";
  if (operationRef.includes("Metrics") || operationRef.includes("Queue")) return "metrics";
  if (operationRef.includes("Health") || operationRef.includes("ActionRequired")) return "health";

  return "unknown";
}

function decisionForInstanceRef(
  credential: ApiCredential,
  instanceRef: string,
  resourceType: ApiResourceOwnershipResourceType,
): ApiResourceOwnershipDecision {
  if (credential.allowedInstanceRefs?.includes(instanceRef)) {
    return Object.freeze({
      allowed: true,
      instanceRef,
      resourceType,
    });
  }

  return Object.freeze({
    allowed: false,
    code: "resource_ownership_denied",
    message: "API credential is not allowed to access the resolved resource owner.",
    resourceType,
  });
}

function isInstanceRef(value: string): boolean {
  return value.startsWith("inst_");
}

function requiresExplicitTargetForInstanceScopedCredential(
  resourceType: ApiResourceOwnershipResourceType,
): boolean {
  return instanceScopedCredentialTargetlessResourceTypes.has(resourceType);
}

const instanceScopedCredentialTargetlessResourceTypes = new Set<ApiResourceOwnershipResourceType>([
  "webhook",
  "delivery",
  "job",
  "event",
  "audit_record",
  "api_key",
  "settings",
  "provider",
  "metrics",
]);

function createOwnershipRecordKey(
  resourceType: ApiResourceOwnershipResourceType,
  resourceRef: string,
): string {
  return `${resourceType}:${resourceRef}`;
}
