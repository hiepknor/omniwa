import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SecretValue, type SecretDescriptor, type SecretProvider } from "@omniwa/config";
import type { ApiCredential } from "@omniwa/interface-api";
import { createCorrelationId, createRequestContext, createRequestId, ok } from "@omniwa/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApiRuntimeComposition,
  createApiRuntimeCompositionFromSecrets,
  readRepositoryProfile,
  readRuntimeProfile,
} from "./runtime-composition.js";
import { hashApiKey } from "./api-key-auth.js";
import { handleApiHttpRequest } from "./http-server.js";
import { ApiKeyLifecycleService, DurableJsonApiKeyLifecycleStore } from "./api-key-lifecycle.js";
import {
  DurableJsonApiSecurityAuditSink,
  InMemoryApiSecurityAuditSink,
} from "./api-security-audit.js";
import { createApiRateLimitMetricPoints } from "./api-rate-limit-metrics.js";
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
    expect(
      createApiRateLimitMetricPoints(
        composition.options.rateLimiter?.snapshot?.() ?? {
          windowMilliseconds: 0,
          buckets: [],
        },
      ),
    ).toContainEqual(
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
    ).toThrow(/Configure either OMNIWA_API_SECURITY_AUDIT_LOG_PATH/u);
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

class FakeSecretProvider implements SecretProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  readSecret(descriptor: SecretDescriptor): ReturnType<SecretProvider["readSecret"]> {
    return Promise.resolve(ok(SecretValue.fromString(this.values[String(descriptor.name)] ?? "")));
  }
}
