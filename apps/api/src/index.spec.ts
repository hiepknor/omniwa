import { describe, expect, it } from "vitest";

import { createApiRuntimeCompositionForProcess } from "./index.js";

describe("API process entrypoint composition", () => {
  it("composes from EnvSecretProvider when an API key secret name is configured", async () => {
    const rawApiKey = "process-secret-api-key";
    const composition = await createApiRuntimeCompositionForProcess({
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_KEY_SECRET_NAME: "OMNIWA_PROCESS_API_KEY",
      OMNIWA_PROCESS_API_KEY: rawApiKey,
      OMNIWA_API_KEY_ID: "process-secret-key",
      OMNIWA_API_KEY_SCOPES: "instances:read,health:read",
    });

    expect(composition.options.apiKeys).toBeUndefined();
    expect(composition.options.apiKeyVerifier?.verify(rawApiKey)).toEqual({
      kind: "api_key",
      keyId: "process-secret-key",
      scopes: ["instances:read", "health:read"],
    });
    expect(JSON.stringify(composition.options)).not.toContain(rawApiKey);
  });

  it("fails safe when the configured process secret is missing", async () => {
    await expect(
      createApiRuntimeCompositionForProcess({
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY_SECRET_NAME: "OMNIWA_PROCESS_API_KEY",
      }),
    ).rejects.toThrow(/secret_not_found/u);
  });
});
