import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { describe, expect, it } from "vitest";

import { createApiRuntimeComposition, readRuntimeProfile } from "./runtime-composition.js";

describe("API runtime composition", () => {
  it("composes local runtime with a real Application dispatcher", async () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
    });

    const outcome = await composition.options.dispatcher?.executeCommand({
      kind: "command",
      name: "CreateInstance",
      commandRef: "runtime-create-instance",
      requestContext: createRequestContext({
        requestId: createRequestId("runtime-request"),
        correlationId: createCorrelationId("runtime-correlation"),
      }),
      actorRef: "api_key:local",
      idempotencyKey: "runtime-idempotency",
    });

    expect(composition.profile).toBe("local");
    expect(outcome).toEqual(
      expect.objectContaining({
        kind: "command_outcome",
        commandRef: "runtime-create-instance",
        outcome: "completed",
        accepted: true,
      }),
    );
  });

  it("allows test runtime without env API key for unit tests", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "test",
    });

    expect(composition.profile).toBe("test");
    expect(composition.options.apiKeys).toEqual([]);
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("fails fast for production profile until production adapters are implemented", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "production-secret",
        OMNIWA_API_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(/production profile requires production persistence/i);
  });

  it("requires an API key for local runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_RUNTIME_PROFILE: "local",
      }),
    ).toThrow(/requires OMNIWA_API_KEY/i);
  });

  it("normalizes runtime profile names", () => {
    expect(readRuntimeProfile({ NODE_ENV: "test" })).toBe("test");
    expect(readRuntimeProfile({ NODE_ENV: "development" })).toBe("local");
    expect(readRuntimeProfile({ OMNIWA_API_RUNTIME_PROFILE: "production" })).toBe("production");
  });
});
