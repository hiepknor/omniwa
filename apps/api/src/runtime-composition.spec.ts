import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createApiRuntimeComposition, readRuntimeProfile } from "./runtime-composition.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

  it("composes an EventLog-backed realtime source when configured", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-event-log-"));
    temporaryDirectories.push(directory);

    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "test",
      OMNIWA_EVENT_LOG_PATH: join(directory, "event-log.json"),
    });

    expect(composition.options.eventSource?.replay({ limit: 10 })).toEqual([]);
    expect(
      composition.options.eventSource?.inspectCursor?.({ cursor: "eventlog:1", limit: 10 }),
    ).toMatchObject({
      status: "not_found",
    });
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
