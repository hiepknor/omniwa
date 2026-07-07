import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SecretValue, type SecretDescriptor, type SecretProvider } from "@omniwa/config";
import type { ApiCredential } from "@omniwa/interface-api";
import { DurableJsonOutboundMessageIntentStore } from "@omniwa/infrastructure-persistence";
import { InMemoryProviderCommandTransport } from "@omniwa/infrastructure-provider-bridge";
import type { MetricPoint, MetricRecorder } from "@omniwa/observability";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApiRuntimeComposition,
  createApiRuntimeCompositionFromSecrets,
  readApiEventLogBackend,
  readApiQueueProfile,
  readRepositoryProfile,
  readRuntimeProfile,
} from "./runtime-composition.js";
import { hashApiKey } from "./api-key-auth.js";
import { handleApiHttpRequest } from "./http-server.js";
import { ApiKeyLifecycleService, DurableJsonApiKeyLifecycleStore } from "./api-key-lifecycle.js";
import {
  DomainAuditRecordApiSecurityAuditSink,
  DurableJsonApiSecurityAuditSink,
  InMemoryApiSecurityAuditSink,
} from "./api-security-audit.js";
import { createApiRateLimitMetricPoints } from "./api-rate-limit-metrics.js";
import type { RedisRateLimitScriptClient } from "./api-rate-limiter.js";
import { RepositoryApiResourceOwnershipResolver } from "./repository-resource-ownership-resolver.js";

const runtimeRateLimitCredential: ApiCredential = {
  kind: "api_key",
  keyId: "runtime-rate-key",
  scopes: ["messages:send"],
};

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
    expect(composition.queueProfile).toBe("in-memory");
    expect(composition.options.apiKeys).toEqual([]);
    expect(composition.options.dispatcher).toBeDefined();
    expect(composition.options.outboundMessageIntentStore).toBeDefined();
  });

  it("keeps local API runtime on the in-memory queue by default", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
    });

    expect(composition.queueProfile).toBe("in-memory");
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("wires durable WorkerJob queue profile for API runtime when requested", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_QUEUE_PROFILE: "durable-worker-job",
    });

    expect(composition.queueProfile).toBe("durable-worker-job");
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("wires an injected provider command bridge into the API runtime dispatcher", () => {
    const providerCommandTransport = new InMemoryProviderCommandTransport();
    const composition = createApiRuntimeComposition(
      {
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
      },
      { providerCommandTransport },
    );

    expect(composition.providerCommandTransport).toBe(providerCommandTransport);
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("wires provider command bridge transport from env without exposing the bridge token", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_URL:
        "http://provider-runtime:3011/internal/provider-command/v1/commands",
      OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN: "private-provider-bridge-token",
    });

    expect(composition.providerCommandTransport).toBeDefined();
    expect(composition.options.dispatcher).toBeDefined();
    expect(JSON.stringify(composition)).not.toContain("private-provider-bridge-token");
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

  it("composes local runtime from SecretProvider without retaining plaintext API key config", async () => {
    const rawApiKey = "secret-provider-runtime-key";
    const composition = await createApiRuntimeCompositionFromSecrets(
      {
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY_SECRET_NAME: "OMNIWA_API_KEY",
        OMNIWA_API_KEY_ID: "secret-provider-env-key",
        OMNIWA_API_KEY_SCOPES: "instances:read",
      },
      {
        secretProvider: new FakeSecretProvider({
          OMNIWA_API_KEY: rawApiKey,
        }),
      },
    );

    expect(composition.options.apiKeys).toBeUndefined();
    expect(composition.options.apiKeyVerifier?.verify(rawApiKey)).toEqual({
      kind: "api_key",
      keyId: "secret-provider-env-key",
      scopes: ["instances:read"],
    });
    expect(JSON.stringify(composition.options)).not.toContain(rawApiKey);
  });

  it("rejects mixing SecretProvider API key source with env key sources", async () => {
    await expect(
      createApiRuntimeCompositionFromSecrets(
        {
          OMNIWA_API_RUNTIME_PROFILE: "local",
          OMNIWA_API_KEY_SECRET_NAME: "OMNIWA_API_KEY",
          OMNIWA_API_KEY_HASH: hashApiKey("hashed-secret"),
        },
        {
          secretProvider: new FakeSecretProvider({
            OMNIWA_API_KEY: "secret-provider-runtime-key",
          }),
        },
      ),
    ).rejects.toThrow(/without OMNIWA_API_KEY/u);
  });

  it("rejects mixed plaintext and hashed API key runtime configuration", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY: "plaintext-secret",
        OMNIWA_API_KEY_HASH: hashApiKey("hashed-secret"),
      }),
    ).toThrow(/Configure exactly one API key source/u);
  });

  it("composes local runtime from durable API key lifecycle records", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-key-runtime-"));
    temporaryDirectories.push(directory);
    const storePath = join(directory, "api-keys.json");
    const rawApiKey = "durable-runtime-secret";
    const service = new ApiKeyLifecycleService({
      store: new DurableJsonApiKeyLifecycleStore(storePath),
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await service.provision({
      key: rawApiKey,
      credential: {
        kind: "api_key",
        keyId: "durable-runtime-key",
        scopes: ["instances:read"],
      },
    });

    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_KEY_LIFECYCLE_STORE_PATH: storePath,
    });

    expect(composition.options.apiKeys).toBeUndefined();
    expect(composition.options.apiKeyVerifier?.verify(rawApiKey)).toEqual({
      kind: "api_key",
      keyId: "durable-runtime-key",
      scopes: ["instances:read"],
    });
    expect(composition.options.apiKeyLifecycleService).toBeDefined();
    expect(JSON.stringify(composition.options)).not.toContain(rawApiKey);
  });

  it("keeps runtime API key lifecycle service and verifier on the same durable store", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-key-runtime-live-"));
    temporaryDirectories.push(directory);
    const storePath = join(directory, "api-keys.json");
    const initialApiKey = "initial-lifecycle-secret";
    const managedApiKey = "managed-lifecycle-secret";
    const seedService = new ApiKeyLifecycleService({
      store: new DurableJsonApiKeyLifecycleStore(storePath),
      now: () => new Date("2026-07-04T00:00:00.000Z"),
    });

    await seedService.provision({
      key: initialApiKey,
      credential: {
        kind: "admin_key",
        keyId: "initial-admin-key",
        scopes: ["admin:*"],
      },
    });

    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_KEY_LIFECYCLE_STORE_PATH: storePath,
    });
    const lifecycleService = composition.options.apiKeyLifecycleService;

    expect(lifecycleService).toBeDefined();
    await lifecycleService?.provision({
      key: managedApiKey,
      credential: {
        kind: "api_key",
        keyId: "managed-runtime-key",
        scopes: ["instances:read"],
      },
      actorRef: "admin_key:initial-admin-key",
    });

    expect(composition.options.apiKeyVerifier?.verify(managedApiKey)).toEqual({
      kind: "api_key",
      keyId: "managed-runtime-key",
      scopes: ["instances:read"],
    });

    await lifecycleService?.revoke({
      keyId: "managed-runtime-key",
      actorRef: "admin_key:initial-admin-key",
      reasonCode: "operator_requested",
    });

    expect(composition.options.apiKeyVerifier?.verify(managedApiKey)).toBeUndefined();
    expect(JSON.stringify(composition.options)).not.toContain(initialApiKey);
    expect(JSON.stringify(composition.options)).not.toContain(managedApiKey);
  });

  it("rejects mixing API key lifecycle store with env key sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-key-runtime-mixed-"));
    temporaryDirectories.push(directory);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY_HASH: hashApiKey("hashed-secret"),
        OMNIWA_API_KEY_LIFECYCLE_STORE_PATH: join(directory, "api-keys.json"),
      }),
    ).toThrow(/Configure exactly one API key source/u);
  });

  it("rejects API key lifecycle stores without active keys", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-key-runtime-empty-"));
    temporaryDirectories.push(directory);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_KEY_LIFECYCLE_STORE_PATH: join(directory, "api-keys.json"),
      }),
    ).toThrow(/must contain an active API key/u);
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
      safeInput: {
        displayName: "Runtime Durable Instance",
      },
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
        items: [
          expect.objectContaining({
            status: "created",
            displayName: "Runtime Durable Instance",
          }),
        ],
      }),
    );

    const createdInstance = Array.isArray(queryOutcome?.items) ? queryOutcome.items[0] : undefined;
    const createdInstanceId =
      typeof createdInstance === "object" &&
      createdInstance !== null &&
      "id" in createdInstance &&
      typeof createdInstance.id === "string"
        ? createdInstance.id
        : undefined;

    expect(createdInstanceId).toMatch(/^inst:/u);

    const statusOutcome = await secondComposition.options.dispatcher?.executeQuery({
      kind: "query",
      name: "GetInstanceStatus",
      queryRef: "runtime-get-durable-instance",
      requestContext: createRequestContext({
        requestId: createRequestId("runtime-durable-get-request"),
        correlationId: createCorrelationId("runtime-durable-get-correlation"),
      }),
      actorRef: "api_key:local",
      targetRef: createdInstanceId,
    });

    expect(statusOutcome).toEqual(
      expect.objectContaining({
        kind: "query_outcome",
        queryRef: "runtime-get-durable-instance",
        outcome: "result",
        resource: expect.objectContaining({
          id: createdInstanceId,
          status: "created",
          displayName: "Runtime Durable Instance",
        }),
      }),
    );
  });

  it("composes an EventLog-backed realtime source when configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-event-log-"));
    temporaryDirectories.push(directory);

    const composition = createApiRuntimeComposition({
      OMNIWA_API_RUNTIME_PROFILE: "test",
      OMNIWA_EVENT_LOG_PATH: join(directory, "event-log.json"),
    });

    expect(composition.eventLogBackend).toBe("durable-json");
    await expect(composition.options.eventSource?.replay({ limit: 10 })).resolves.toEqual([]);
    expect(
      await composition.options.eventSource?.inspectCursor?.({ cursor: "eventlog:1", limit: 10 }),
    ).toMatchObject({
      status: "not_found",
    });
  });

  it("wires PostgreSQL EventLog backend when requested", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_EVENT_LOG_BACKEND: "postgresql",
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
    });

    expect(composition.eventLogBackend).toBe("postgresql");
    expect(composition.options.eventSource).toBeDefined();
    expect(composition.options.dispatcher).toBeDefined();
  });

  it("wires env-configured API request metrics into a safe JSONL recorder", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-metrics-runtime-"));
    temporaryDirectories.push(directory);
    const metricsPath = join(directory, "api-metrics.jsonl");
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_METRICS_JSONL_PATH: metricsPath,
    });

    expect(composition.options.metricRecorder).toBeDefined();

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "local-secret",
          "x-request-id": "runtime-metrics-request",
          "x-correlation-id": "runtime-metrics-correlation",
        },
      },
      composition.options,
    );
    const metricLines = readFileSync(metricsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(response.statusCode).toBe(200);
    expect(metricLines).toEqual([
      expect.objectContaining({
        name: "api.request.latency",
        labels: {
          method: "GET",
          route: "/v1/instances",
          outcome: "success",
        },
      }),
    ]);
  });

  it("wires an env-configured API rate limiter into the HTTP runtime", async () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
      OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
    });

    const first = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "local-secret",
          "x-request-id": "runtime-rate-1",
          "x-correlation-id": "runtime-rate-correlation",
        },
      },
      composition.options,
    );
    const second = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "local-secret",
          "x-request-id": "runtime-rate-2",
          "x-correlation-id": "runtime-rate-correlation",
        },
      },
      composition.options,
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect("error" in second.body ? second.body.error : undefined).toMatchObject({
      code: "rate_limit_exceeded",
      details: {
        endpointClass: "read",
        limit: 1,
        remaining: 0,
      },
    });
    const rateLimitSnapshot =
      composition.options.rateLimiter?.snapshot === undefined
        ? {
            windowMilliseconds: 0,
            buckets: [],
          }
        : await composition.options.rateLimiter.snapshot();

    expect(createApiRateLimitMetricPoints(rateLimitSnapshot)).toContainEqual(
      expect.objectContaining({
        name: "api.rate_limit.bucket.count",
        value: 1,
        labels: {
          endpoint_class: "read",
          scope_kind: "global",
        },
      }),
    );
  });

  it("wires an injected Redis-backed API rate limiter into the HTTP runtime", async () => {
    const redisClient = new FakeRedisRateLimitScriptClient();
    const composition = createApiRuntimeComposition(
      {
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_KEY_ID: "runtime-redis-key",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_KEY_PREFIX: "omniwa:test-runtime-rate",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      },
      {
        redisRateLimitScriptClient: redisClient,
      },
    );

    const first = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_runtime_redis",
        headers: {
          "x-api-key": "local-secret",
          "x-request-id": "runtime-redis-rate-1",
          "x-correlation-id": "runtime-redis-rate-correlation",
        },
      },
      composition.options,
    );
    const second = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances/inst_runtime_redis",
        headers: {
          "x-api-key": "local-secret",
          "x-request-id": "runtime-redis-rate-2",
          "x-correlation-id": "runtime-redis-rate-correlation",
        },
      },
      composition.options,
    );

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(redisClient.calls).toHaveLength(2);
    expect(redisClient.calls[0]?.keys[0]).toMatch(/^omniwa:test-runtime-rate:[a-f0-9]{64}$/u);
    expect(JSON.stringify(redisClient.calls)).not.toContain("local-secret");
    expect(JSON.stringify(redisClient.calls)).not.toContain("runtime-redis-key");
    expect(JSON.stringify(redisClient.calls)).not.toContain("inst_runtime_redis");
  });

  it("composes local runtime from Redis rate limit URL without an injected client", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
      OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://:runtime-secret@redis.example:6379/0",
      OMNIWA_API_RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS: "1000",
      OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
      OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
    });

    expect(composition.options.rateLimiter).toBeDefined();
    expect(JSON.stringify(composition.options.rateLimiter)).not.toContain("runtime-secret");
  });

  it("fails fast when Redis rate limit backend is selected without URL or injected client", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/requires OMNIWA_API_RATE_LIMIT_REDIS_URL or an injected/u);
  });

  it("rejects invalid Redis rate limit URL configuration safely", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "postgresql://redis-secret@redis.example/db",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/OMNIWA_API_RATE_LIMIT_REDIS_URL must use redis or rediss protocol/u);

    try {
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://:redis secret",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("redis secret");
    }
  });

  it("rejects unsupported rate limit backend values safely", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_BACKEND: "unsupported",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "1",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/OMNIWA_API_RATE_LIMIT_BACKEND must be in-memory or redis/u);
  });

  it("wires endpoint-class rate limits for message sends", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "10",
      OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      OMNIWA_API_RATE_LIMIT_MESSAGE_SEND_MAX_REQUESTS: "1",
    });
    const rateLimiter = composition.options.rateLimiter;

    expect(rateLimiter).toBeDefined();
    expect(
      rateLimiter?.check({
        credential: runtimeRateLimitCredential,
        method: "POST",
        url: "/v1/instances/inst_allowed/messages/text",
        endpointClass: "message_send",
        instanceRef: "inst_allowed",
      }),
    ).toMatchObject({ allowed: true, limit: 1, remaining: 0 });
    expect(
      rateLimiter?.check({
        credential: runtimeRateLimitCredential,
        method: "POST",
        url: "/v1/instances/inst_allowed/messages/text",
        endpointClass: "message_send",
        instanceRef: "inst_allowed",
      }),
    ).toMatchObject({ allowed: false, limit: 1 });
  });

  it("requires max requests and window to be configured together for API rate limiting", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "10",
      }),
    ).toThrow(/MAX_REQUESTS and OMNIWA_API_RATE_LIMIT_WINDOW_MS together/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/MAX_REQUESTS and OMNIWA_API_RATE_LIMIT_WINDOW_MS together/u);
  });

  it("rejects invalid API rate limiter environment values safely", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "0",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/OMNIWA_API_RATE_LIMIT_MAX_REQUESTS must be a positive integer/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "10",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_RATE_LIMIT_ADMIN_MAX_REQUESTS: "NaN",
      }),
    ).toThrow(/OMNIWA_API_RATE_LIMIT_ADMIN_MAX_REQUESTS must be a positive integer/u);
  });

  it("wires an env-configured in-memory security audit sink for denied decisions", async () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_SECURITY_AUDIT_IN_MEMORY: "true",
    });
    const securityAuditSink = composition.options.securityAuditSink;

    expect(securityAuditSink).toBeInstanceOf(InMemoryApiSecurityAuditSink);

    const response = await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "invalid-runtime-secret",
          "x-request-id": "runtime-audit-denied",
          "x-correlation-id": "runtime-audit-correlation",
        },
      },
      composition.options,
    );
    const events = (securityAuditSink as InMemoryApiSecurityAuditSink).snapshot();

    expect(response.statusCode).toBe(401);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: "authentication_denied",
        requestId: "runtime-audit-denied",
        correlationId: "runtime-audit-correlation",
        path: "/v1/instances",
        code: "missing_or_invalid_api_key",
        statusCode: 401,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("invalid-runtime-secret");
  });

  it("wires an env-configured durable JSON security audit sink", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-security-audit-runtime-"));
    temporaryDirectories.push(directory);
    const auditPath = join(directory, "audit-log.json");
    const firstComposition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_SECURITY_AUDIT_LOG_PATH: auditPath,
    });

    expect(firstComposition.options.securityAuditSink).toBeInstanceOf(
      DurableJsonApiSecurityAuditSink,
    );

    await handleApiHttpRequest(
      {
        method: "GET",
        url: "/v1/instances",
        headers: {
          "x-api-key": "invalid-runtime-secret",
          "x-request-id": "runtime-durable-audit-denied",
          "x-correlation-id": "runtime-durable-audit-correlation",
        },
      },
      firstComposition.options,
    );

    const secondComposition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_SECURITY_AUDIT_LOG_PATH: auditPath,
    });
    const events = (
      secondComposition.options.securityAuditSink as DurableJsonApiSecurityAuditSink
    ).snapshot();

    expect(events).toEqual([
      expect.objectContaining({
        eventType: "authentication_denied",
        requestId: "runtime-durable-audit-denied",
        path: "/v1/instances",
        code: "missing_or_invalid_api_key",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("invalid-runtime-secret");
  });

  it("rejects mixed security audit sink runtime configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-security-audit-mixed-"));
    temporaryDirectories.push(directory);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "local-secret",
        OMNIWA_API_RUNTIME_PROFILE: "local",
        OMNIWA_API_SECURITY_AUDIT_IN_MEMORY: "true",
        OMNIWA_API_SECURITY_AUDIT_LOG_PATH: join(directory, "audit-log.json"),
      }),
    ).toThrow(/Configure only one API security audit sink/u);
  });

  it("wires API security audit events into domain AuditRecord persistence when requested", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
    });

    expect(composition.options.securityAuditSink).toBeInstanceOf(
      DomainAuditRecordApiSecurityAuditSink,
    );
  });

  it("wires AuditRecord security audit persistence for PostgreSQL repository profile", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
      OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@127.0.0.1:55432/omniwa",
      OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
    });

    expect(composition.options.securityAuditSink).toBeInstanceOf(
      DomainAuditRecordApiSecurityAuditSink,
    );
  });

  it("wires an env-configured repository-backed resource ownership resolver", () => {
    const composition = createApiRuntimeComposition({
      OMNIWA_API_KEY: "local-secret",
      OMNIWA_API_RUNTIME_PROFILE: "local",
      OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
    });

    expect(composition.options.resourceOwnershipResolver).toBeInstanceOf(
      RepositoryApiResourceOwnershipResolver,
    );
  });

  it("requires PostgreSQL repository profile for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY: "production-secret",
        OMNIWA_API_RUNTIME_PROFILE: "production",
      }),
    ).toThrow(/OMNIWA_API_REPOSITORY_PROFILE=postgresql/u);
  });

  it("rejects local PostgreSQL database hosts for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://safe_user:safe_password@127.0.0.1:5432/omniwa",
      }),
    ).toThrow(/must not use local PostgreSQL host credentials/u);
  });

  it("rejects known development PostgreSQL credentials for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL: "postgresql://omniwa:omniwa@db.prod.example/omniwa",
      }),
    ).toThrow(/must not use known development PostgreSQL credentials/u);
  });

  it("requires distributed rate limiting for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
      }),
    ).toThrow(/requires OMNIWA_API_RATE_LIMIT_MAX_REQUESTS and OMNIWA_API_RATE_LIMIT_WINDOW_MS/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "in-memory",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/requires OMNIWA_API_RATE_LIMIT_BACKEND=redis/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/requires OMNIWA_API_RATE_LIMIT_REDIS_URL or an injected/u);
  });

  it("requires AuditRecord-backed security audit evidence for production runtime composition", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-production-audit-"));
    temporaryDirectories.push(directory);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://redis.prod.example:6379/0",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
      }),
    ).toThrow(/requires OMNIWA_API_SECURITY_AUDIT_RECORDS=true/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://redis.prod.example:6379/0",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_SECURITY_AUDIT_IN_MEMORY: "true",
      }),
    ).toThrow(/requires OMNIWA_API_SECURITY_AUDIT_RECORDS=true/u);

    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://redis.prod.example:6379/0",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_SECURITY_AUDIT_LOG_PATH: join(directory, "audit-log.json"),
      }),
    ).toThrow(/requires OMNIWA_API_SECURITY_AUDIT_RECORDS=true/u);
  });

  it("requires repository-backed ownership resolution for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://redis.prod.example:6379/0",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
      }),
    ).toThrow(/requires OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true/u);
  });

  it("requires durable queue profile for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition({
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_REDIS_URL: "redis://redis.prod.example:6379/0",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
        OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
      }),
    ).toThrow(/requires OMNIWA_API_QUEUE_PROFILE=durable/u);
  });

  it("requires PostgreSQL EventLog backend for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition(
        {
          OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
          OMNIWA_API_RUNTIME_PROFILE: "production",
          OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
          OMNIWA_POSTGRES_DATABASE_URL:
            "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
          OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
          OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
          OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
          OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
          OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
          OMNIWA_API_QUEUE_PROFILE: "durable-worker-job",
        },
        {
          redisRateLimitScriptClient: new FakeRedisRateLimitScriptClient(),
          metricRecorder: new CapturingMetricRecorder(),
        },
      ),
    ).toThrow(/requires OMNIWA_EVENT_LOG_BACKEND=postgresql/u);
  });

  it("requires API request metrics for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition(
        {
          OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
          OMNIWA_API_RUNTIME_PROFILE: "production",
          OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
          OMNIWA_POSTGRES_DATABASE_URL:
            "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
          OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
          OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
          OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
          OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
          OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
          OMNIWA_API_QUEUE_PROFILE: "durable-worker-job",
          OMNIWA_EVENT_LOG_BACKEND: "postgresql",
        },
        {
          redisRateLimitScriptClient: new FakeRedisRateLimitScriptClient(),
        },
      ),
    ).toThrow(/requires OMNIWA_API_METRICS_JSONL_PATH or an injected metric recorder/u);
  });

  it("requires shared outbound message intent storage for production runtime composition", () => {
    expect(() =>
      createApiRuntimeComposition(
        {
          OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
          OMNIWA_API_RUNTIME_PROFILE: "production",
          OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
          OMNIWA_POSTGRES_DATABASE_URL:
            "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
          OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
          OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
          OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
          OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
          OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
          OMNIWA_API_QUEUE_PROFILE: "durable-worker-job",
          OMNIWA_EVENT_LOG_BACKEND: "postgresql",
        },
        {
          redisRateLimitScriptClient: new FakeRedisRateLimitScriptClient(),
          metricRecorder: new CapturingMetricRecorder(),
        },
      ),
    ).toThrow(/requires OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH/u);
  });

  it("composes production runtime when required production adapters are configured", () => {
    const directory = mkdtempSync(join(tmpdir(), "omniwa-api-production-intents-"));
    temporaryDirectories.push(directory);
    const metricRecorder = new CapturingMetricRecorder();
    const composition = createApiRuntimeComposition(
      {
        OMNIWA_API_KEY_HASH: hashApiKey("production-secret"),
        OMNIWA_API_RUNTIME_PROFILE: "production",
        OMNIWA_API_REPOSITORY_PROFILE: "postgresql",
        OMNIWA_POSTGRES_DATABASE_URL:
          "postgresql://omniwa_prod_app:strong-prod-password@db.prod.example/omniwa",
        OMNIWA_API_RATE_LIMIT_BACKEND: "redis",
        OMNIWA_API_RATE_LIMIT_MAX_REQUESTS: "100",
        OMNIWA_API_RATE_LIMIT_WINDOW_MS: "60000",
        OMNIWA_API_SECURITY_AUDIT_RECORDS: "true",
        OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY: "true",
        OMNIWA_API_QUEUE_PROFILE: "durable-worker-job",
        OMNIWA_EVENT_LOG_BACKEND: "postgresql",
        OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH: join(
          directory,
          "outbound-message-intents.secret.json",
        ),
      },
      {
        redisRateLimitScriptClient: new FakeRedisRateLimitScriptClient(),
        metricRecorder,
      },
    );

    expect(composition.profile).toBe("production");
    expect(composition.repositoryProfile).toBe("postgresql");
    expect(composition.queueProfile).toBe("durable-worker-job");
    expect(composition.eventLogBackend).toBe("postgresql");
    expect(composition.options.metricRecorder).toBe(metricRecorder);
    expect(composition.options.outboundMessageIntentStore).toBeInstanceOf(
      DurableJsonOutboundMessageIntentStore,
    );
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

  it("normalizes API queue profile names", () => {
    expect(readApiQueueProfile({})).toBe("in-memory");
    expect(readApiQueueProfile({ OMNIWA_API_QUEUE_PROFILE: "in-memory" })).toBe("in-memory");
    expect(readApiQueueProfile({ OMNIWA_API_QUEUE_PROFILE: "durable" })).toBe("durable-worker-job");
    expect(readApiQueueProfile({ OMNIWA_API_QUEUE_PROFILE: "durable-worker-job" })).toBe(
      "durable-worker-job",
    );
    expect(() => readApiQueueProfile({ OMNIWA_API_QUEUE_PROFILE: "invalid" })).toThrow(
      /Unsupported OmniWA API queue profile/u,
    );
  });

  it("normalizes EventLog backend names", () => {
    expect(readApiEventLogBackend({})).toBe("in-memory");
    expect(readApiEventLogBackend({ OMNIWA_EVENT_LOG_PATH: "/tmp/event-log.json" })).toBe(
      "durable-json",
    );
    expect(readApiEventLogBackend({ OMNIWA_EVENT_LOG_BACKEND: "in-memory" })).toBe("in-memory");
    expect(readApiEventLogBackend({ OMNIWA_EVENT_LOG_BACKEND: "durable-json" })).toBe(
      "durable-json",
    );
    expect(readApiEventLogBackend({ OMNIWA_EVENT_LOG_BACKEND: "postgresql" })).toBe("postgresql");
    expect(() => readApiEventLogBackend({ OMNIWA_EVENT_LOG_BACKEND: "invalid" })).toThrow(
      /Unsupported OmniWA API EventLog backend/u,
    );
  });
});

class FakeRedisRateLimitScriptClient implements RedisRateLimitScriptClient {
  readonly calls: {
    keys: readonly string[];
    arguments: readonly string[];
  }[] = [];

  private readonly buckets = new Map<
    string,
    {
      windowStartEpochMilliseconds: number;
      count: number;
    }
  >();

  eval(
    _script: string,
    input: Readonly<{
      keys: readonly string[];
      arguments: readonly string[];
    }>,
  ): Promise<unknown> {
    this.calls.push({
      keys: Object.freeze([...input.keys]),
      arguments: Object.freeze([...input.arguments]),
    });
    const key = requiredString(input.keys[0], "redis key");
    const windowStartEpochMilliseconds = Number(requiredString(input.arguments[0], "window start"));
    const resetAtEpochMilliseconds = Number(requiredString(input.arguments[1], "reset at"));
    const limit = Number(requiredString(input.arguments[3], "limit"));
    const current = this.buckets.get(key);
    const bucket =
      current !== undefined && current.windowStartEpochMilliseconds === windowStartEpochMilliseconds
        ? current
        : {
            windowStartEpochMilliseconds,
            count: 0,
          };

    this.buckets.set(key, bucket);

    if (bucket.count >= limit) {
      return Promise.resolve([0, bucket.count, resetAtEpochMilliseconds]);
    }

    bucket.count += 1;

    return Promise.resolve([1, bucket.count, resetAtEpochMilliseconds]);
  }
}

class CapturingMetricRecorder implements MetricRecorder {
  readonly points: MetricPoint[] = [];

  recordMetric(point: MetricPoint): void {
    this.points.push(point);
  }
}

class FakeSecretProvider implements SecretProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  readSecret(descriptor: SecretDescriptor): ReturnType<SecretProvider["readSecret"]> {
    return Promise.resolve(ok(SecretValue.fromString(this.values[String(descriptor.name)] ?? "")));
  }
}

function requiredString(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new TypeError(`${label} is required.`);
  }

  return value;
}
