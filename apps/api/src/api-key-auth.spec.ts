import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import {
  createApiKeyVerifierFromPlaintext,
  createHashedApiKeyConfig,
  createHashedApiKeyVerifier,
  hashApiKey,
  revokeApiKey,
  rotateApiKey,
} from "./api-key-auth.js";

const credential: ApiCredential = {
  kind: "api_key",
  keyId: "test-key",
  scopes: ["instances:read"],
};

describe("API key auth", () => {
  it("hashes API keys into a non-plaintext stable digest", () => {
    const hash = hashApiKey(" local-secret ");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(hash).not.toContain("local-secret");
    expect(hashApiKey("local-secret")).toBe(hash);
  });

  it("verifies plaintext keys against hashed records", () => {
    const verifier = createHashedApiKeyVerifier([
      createHashedApiKeyConfig({
        key: "local-secret",
        credential,
      }),
    ]);

    expect(verifier.verify("local-secret")).toBe(credential);
    expect(verifier.verify("wrong-secret")).toBeUndefined();
    expect(verifier.verify(undefined)).toBeUndefined();
  });

  it("builds a hashed verifier from legacy plaintext config without exposing the key", () => {
    const verifier = createApiKeyVerifierFromPlaintext([
      {
        key: "legacy-secret",
        credential,
      },
    ]);

    expect(verifier.verify("legacy-secret")).toBe(credential);
    expect(JSON.stringify(verifier)).not.toContain("legacy-secret");
  });

  it("does not authenticate revoked keys", () => {
    const revoked = revokeApiKey(
      createHashedApiKeyConfig({
        key: "revoked-secret",
        credential,
      }),
    );
    const verifier = createHashedApiKeyVerifier([revoked]);

    expect(verifier.verify("revoked-secret")).toBeUndefined();
  });

  it("rotates keys by revoking the current hash and accepting the replacement", () => {
    const current = createHashedApiKeyConfig({
      key: "current-secret",
      credential,
    });
    const nextCredential: ApiCredential = {
      ...credential,
      keyId: "rotated-key",
    };
    const rotation = rotateApiKey({
      current,
      nextKey: "next-secret",
      nextCredential,
    });
    const verifier = createHashedApiKeyVerifier([rotation.revoked, rotation.replacement]);

    expect(rotation.revoked.status).toBe("revoked");
    expect(rotation.replacement).toMatchObject({
      status: "active",
      rotatedFromKeyId: "test-key",
    });
    expect(verifier.verify("current-secret")).toBeUndefined();
    expect(verifier.verify("next-secret")).toBe(nextCredential);
  });
});
