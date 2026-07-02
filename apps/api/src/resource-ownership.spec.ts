import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import {
  authorizeApiResourceOwnership,
  InMemoryApiResourceOwnershipResolver,
  type ApiResourceOwnershipResolver,
  type ApiResourceOwnershipRequest,
} from "./resource-ownership.js";

const credential: ApiCredential = {
  kind: "api_key",
  keyId: "ownership-key",
  scopes: ["messages:read"],
  allowedInstanceRefs: ["inst_allowed"],
};

describe("API resource ownership", () => {
  it("allows direct instance targets owned by the credential", async () => {
    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "inst_allowed",
        operationRef: "GetInstanceStatus",
      }),
    ).resolves.toMatchObject({
      allowed: true,
      instanceRef: "inst_allowed",
    });
  });

  it("denies direct instance targets outside the credential boundary", async () => {
    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "inst_denied",
        operationRef: "GetInstanceStatus",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "resource_ownership_denied",
    });
  });

  it("resolves non-instance resources through an injected ownership resolver", async () => {
    const resolver: ApiResourceOwnershipResolver = {
      resolve: () => Promise.resolve({ status: "resolved", instanceRef: "inst_allowed" }),
    };

    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "msg_1",
        operationRef: "GetMessageStatus",
        resolver,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      instanceRef: "inst_allowed",
    });
  });

  it("passes explicit resource types for platform-owned resource IDs", async () => {
    const requests: ApiResourceOwnershipRequest[] = [];
    const resolver: ApiResourceOwnershipResolver = {
      resolve: (request) => {
        requests.push(request);
        return Promise.resolve({ status: "resolved", instanceRef: "inst_allowed" });
      },
    };

    await authorizeApiResourceOwnership({
      credential,
      targetRef: "msg_1",
      operationRef: "GetMessageStatus",
      resolver,
    });
    await authorizeApiResourceOwnership({
      credential,
      targetRef: "group_1",
      operationRef: "GetGroupStatus",
      resolver,
    });
    await authorizeApiResourceOwnership({
      credential,
      targetRef: "wh_1",
      operationRef: "GetWebhookStatus",
      resolver,
    });
    await authorizeApiResourceOwnership({
      credential,
      targetRef: "whd_1",
      operationRef: "GetWebhookDeliveryHistory",
      resolver,
    });
    await authorizeApiResourceOwnership({
      credential,
      targetRef: "job_1",
      operationRef: "GetWorkerJobStatus",
      resolver,
    });
    await authorizeApiResourceOwnership({
      credential,
      targetRef: "event_1",
      operationRef: "ListEvents",
      resolver,
    });

    expect(requests.map((request) => request.resourceType)).toEqual([
      "message",
      "group",
      "webhook",
      "delivery",
      "job",
      "event",
    ]);
  });

  it("denies unresolved resources when a resolver is available", async () => {
    const resolver: ApiResourceOwnershipResolver = {
      resolve: () => Promise.resolve({ status: "unresolved" }),
    };

    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "msg_1",
        operationRef: "GetMessageStatus",
        resolver,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "resource_ownership_unresolved",
    });
  });

  it("resolves resource ownership from an in-memory resource map", async () => {
    const resolver = new InMemoryApiResourceOwnershipResolver([
      {
        resourceType: "message",
        resourceRef: "msg_1",
        instanceRef: "inst_allowed",
      },
      {
        resourceType: "group",
        resourceRef: "group_1",
        instanceRef: "inst_denied",
      },
    ]);

    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "msg_1",
        operationRef: "GetMessageStatus",
        resolver,
      }),
    ).resolves.toMatchObject({
      allowed: true,
      instanceRef: "inst_allowed",
      resourceType: "message",
    });

    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "group_1",
        operationRef: "GetGroupStatus",
        resolver,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: "resource_ownership_denied",
      resourceType: "group",
    });
  });

  it("keeps backward-compatible allow behavior when no resolver is wired yet", async () => {
    await expect(
      authorizeApiResourceOwnership({
        credential,
        targetRef: "msg_1",
        operationRef: "GetMessageStatus",
      }),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("allows admin scope through an explicit bypass decision", async () => {
    await expect(
      authorizeApiResourceOwnership({
        credential: {
          kind: "admin_key",
          keyId: "admin-key",
          scopes: ["admin:*"],
          allowedInstanceRefs: ["inst_other"],
        },
        targetRef: "inst_allowed",
        operationRef: "DestroyInstance",
      }),
    ).resolves.toMatchObject({
      allowed: true,
      bypass: "admin_scope",
      resourceType: "instance",
    });
  });
});
