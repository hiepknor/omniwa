import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import {
  authorizeApiResourceOwnership,
  type ApiResourceOwnershipResolver,
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
});
