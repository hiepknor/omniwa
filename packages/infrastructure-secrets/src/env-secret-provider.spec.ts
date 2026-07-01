import { createSecretName, createSecretPurpose } from "@omniwa/config";
import { describe, expect, it } from "vitest";

import { EnvSecretProvider } from "./env-secret-provider.js";

describe("EnvSecretProvider", () => {
  it("reads secrets from the configured environment without exposing raw values", async () => {
    const provider = new EnvSecretProvider({
      env: {
        OMNIWA_API_KEY: "  local-secret  ",
      },
    });

    const result = await provider.readSecret({
      name: createSecretName("OMNIWA_API_KEY"),
      purpose: createSecretPurpose("api-authentication"),
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.revealForUse() : undefined).toBe("local-secret");
    expect(result.ok ? String(result.value) : undefined).toBe("[secret]");
  });

  it("returns a safe configuration error when a secret is missing", async () => {
    const provider = new EnvSecretProvider({ env: {} });

    const result = await provider.readSecret({
      name: createSecretName("OMNIWA_API_KEY"),
      purpose: createSecretPurpose("api-authentication"),
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.toSafeShape()).toMatchObject({
      category: "configuration",
      code: "secret_not_found",
      retryable: false,
      metadata: {
        secretName: "OMNIWA_API_KEY",
        secretPurpose: "api-authentication",
      },
    });
  });
});
