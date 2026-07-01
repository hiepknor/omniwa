import type { ApiCredential } from "@omniwa/interface-api";

export type ApiResourceOwnershipRequest = Readonly<{
  credential: ApiCredential;
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

export type ApiResourceOwnershipDecision = Readonly<
  | {
      allowed: true;
      instanceRef?: string;
    }
  | {
      allowed: false;
      code: "resource_ownership_denied" | "resource_ownership_unresolved";
      message: string;
    }
>;

export async function authorizeApiResourceOwnership(input: {
  credential: ApiCredential;
  targetRef?: string;
  operationRef: string;
  resolver?: ApiResourceOwnershipResolver;
}): Promise<ApiResourceOwnershipDecision> {
  if (
    input.targetRef === undefined ||
    input.credential.scopes.includes("admin:*") ||
    input.credential.allowedInstanceRefs === undefined
  ) {
    return Object.freeze({ allowed: true });
  }

  if (isInstanceRef(input.targetRef)) {
    return decisionForInstanceRef(input.credential, input.targetRef);
  }

  if (input.resolver === undefined) {
    return Object.freeze({ allowed: true });
  }

  try {
    const resolution = await input.resolver.resolve({
      credential: input.credential,
      targetRef: input.targetRef,
      operationRef: input.operationRef,
    });

    if (resolution.status === "unresolved") {
      return Object.freeze({
        allowed: false,
        code: "resource_ownership_unresolved",
        message: "API resource ownership could not be resolved.",
      });
    }

    return decisionForInstanceRef(input.credential, resolution.instanceRef);
  } catch {
    return Object.freeze({
      allowed: false,
      code: "resource_ownership_unresolved",
      message: "API resource ownership could not be resolved.",
    });
  }
}

function decisionForInstanceRef(
  credential: ApiCredential,
  instanceRef: string,
): ApiResourceOwnershipDecision {
  if (credential.allowedInstanceRefs?.includes(instanceRef)) {
    return Object.freeze({
      allowed: true,
      instanceRef,
    });
  }

  return Object.freeze({
    allowed: false,
    code: "resource_ownership_denied",
    message: "API credential is not allowed to access the resolved resource owner.",
  });
}

function isInstanceRef(value: string): boolean {
  return value.startsWith("inst_");
}
