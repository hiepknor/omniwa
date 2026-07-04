import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCorrelationId, createRequestContext, createRequestId } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApiRuntimeComposition,
  readRepositoryProfile,
  readRuntimeProfile,
} from "./runtime-composition.js";
import { hashApiKey } from "./api-key-auth.js";

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
    expect(composition.repositoryProfile).toBe("in-memory");
    expect(composition.options.apiKeys).toEqual([]);
    expect(composition.options.dispatcher).toBeDefined();
    expect(composition.options.outboundMessageIntentStore).toBeDefined();
  });

  it("composes local runtime from a hashed API key without keeping plaintext config", () => {
    const rawApiKey = "hashed-runtime-secret";
    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_KEY_HASH: hashApiKey(rawApiKey),
      OMNIWA_API_KEY_ID: "hashed-env-key",
      OMNIWA_API_KEY_SCOPES: "instances:read,health:read",
      OMNIWA_API_KEY_ALLOWED_INSTANCES: "inst_allowed",
    });

    expect(composition.options.apiKeys).toBeUndefined();
    expect(composition.options.apiKeyVerifier?.verify(rawApiKey)).toEqual({
      kind: "api_key",
      keyId: "hashed-env-key",
      scopes: ["instances:read", "health:read"],
      allowedInstanceRefs: ["inst_allowed"],
    });
    expect(JSON.stringify(composition.options)).not.toContain(rawApiKey);
  });

  it("rejects mixed plaintext and hashed API key runtime configuration", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY: "plaintext-secret",
        OMNIWA_API_KEY_HASH: hashApiKey("hashed-secret"),
      }),
    ).toThrow(/either OMNIWA_API_KEY or OMNIWA_API_KEY_HASH/u);
  });

  it("composes a durable JSON repository profile for restartable local state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-repositories-"));
    temporaryDirectories.push(directory);
    const env = {
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_REPOSITORY_PROFILE: "durable-json",
      OMNIWA_API_REPOSITORY_STATE_DIR: directory,
    };

    const firstComposition = createApiRuntimeComposition(env);

    await firstComposition.options.dispatcher?.executeCommand({
      kind: "command",
      name: "CreateInstance",
      commandRef: "runtime-create-durable-instance",
      requestContext: createRequestContext({
        requestId: createRequestId("runtime-durable-request"),
        correlationId: createCorrelationId("runtime-durable-correlation"),
      }),
      actorRef: "api_key:local",
      idempotencyKey: "runtime-durable-idempotency",
    });

    const secondComposition = createApiRuntimeComposition(env);
    const queryOutcome = await secondComposition.options.dispatcher?.executeQuery({
      kind: "query",
      name: "ListInstances",
      queryRef: "runtime-list-durable-instances",
      requestContext: createRequestContext({
        requestId: createRequestId("runtime-durable-list-request"),
        correlationId: createCorrelationId("runtime-durable-list-correlation"),
      }),
      actorRef: "api_key:local",
    });

    expect(firstComposition.repositoryProfile).toBe("durable-json");
    expect(secondComposition.repositoryProfile).toBe("durable-json");
    expect(queryOutcome).toEqual(
      expect.objectContaining({
        kind: "query_outcome",
        queryRef: "runtime-list-durable-instances",
        outcome: "result",
        resultRef: "instances:list:1",
      }),
    );
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
    ).toThrow(/requires OMNIWA_API_KEY or OMNIWA_API_KEY_HASH/i);
  });

  it("requires a repository state directory for durable JSON composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_REPOSITORY_PROFILE: "durable-json",
      }),
    ).toThrow(/OMNIWA_API_REPOSITORY_STATE_DIR/);
  });

  it("requires a PostgreSQL database URL for PostgreSQL repository composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
      }),
    ).toThrow(/OMNIWA_POSTGRES_DATABASE_URL/);
  });

  it("composes PostgreSQL repository profile when a database URL is provided", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
      OMNIWA_POSTGRES_AUTO_MIGRATE: "true",
    });

    expect(composition.repositoryProfile).toBe("postgresql");
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("normalizes runtime profile names", () => {
    expect(readRuntimeProfile({ NODE_ENV: "test" })).toBe("test");
    expect(readRuntimeProfile({ NODE_ENV: "development" })).toBe("local");
    expect(readRuntimeProfile({ OMNIWA_API_RUNTIME_PROFILE: "production" })).toBe("production");
  });

  it("normalizes repository profile names", () => {
    expect(readRepositoryProfile({})).toBe("in-memory");
    expect(readRepositoryProfile({ OMNIWA_API_REPOSITORY_PROFILE: "in-memory" })).toBe("in-memory");
    expect(readRepositoryProfile({ OMNIWA_API_REPOSITORY_PROFILE: "durable-json" })).toBe(
      "durable-json",
    );
    expect(readRepositoryProfile({ OMNIWA_API_REPOSITORY_PROFILE: "postgresql" })).toBe(
      "postgresql",
    );
  });
});
