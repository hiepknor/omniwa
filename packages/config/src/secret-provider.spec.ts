import { describe, expect, it } from "vitest";

import { SecretValue, createSecretName, createSecretPurpose } from "./secret-provider.js";

describe("secret provider contracts", () => {
  it("keeps secret values redacted by default", () => {
    const secret = SecretValue.fromString("synthetic-secret");

    expect(secret.toString()).toBe("[secret]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[secret]"}');
    expect(secret.revealForUse()).toBe("synthetic-secret");
  });

  it("creates secret descriptors from non-empty values", () => {
    expect(createSecretName("api-key")).toBe("api-key");
    expect(createSecretPurpose("api-authentication")).toBe("api-authentication");
  });
});
