import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import {
  InMemoryFixedWindowRateLimiter,
  InMemoryRateLimitCounterStore,
  RedisRateLimitCounterStore,
  SharedFixedWindowRateLimiter,
  classifyRateLimitEndpoint,
  type RedisRateLimitScriptClient,
} from "./api-rate-limiter.js";

const credential: ApiCredential = {
  kind: "api_key",
  keyId: "rate-key",
  scopes: ["instances:read"],
};

describe("API rate limiter", () => {
  it("limits requests by credential, endpoint class, and target reference", () => {
    const clock = new ManualClock(1000);
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 2,
      windowMilliseconds: 1000,
      clock,
    });

    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances/inst_1",
        endpointClass: "read",
        targetRef: "inst_1",
      }),
    ).toMatchObject({ allowed: true, remaining: 1 });
    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances/inst_1",
        endpointClass: "read",
        targetRef: "inst_1",
      }),
    ).toMatchObject({ allowed: true, remaining: 0 });
    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances/inst_1",
        endpointClass: "read",
        targetRef: "inst_1",
      }),
    ).toMatchObject({
      allowed: false,
      retryAfterMilliseconds: 1000,
    });

    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances/inst_2",
        endpointClass: "read",
        targetRef: "inst_2",
      }),
    ).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("prefers resolved instance scope over non-instance resource targets", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 1,
      windowMilliseconds: 1000,
      clock: new ManualClock(1000),
    });

    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/messages/msg_1",
        endpointClass: "read",
        instanceRef: "inst_allowed",
        targetRef: "msg_1",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/messages/msg_2",
        endpointClass: "read",
        instanceRef: "inst_allowed",
        targetRef: "msg_2",
      }),
    ).toMatchObject({ allowed: false });
  });

  it("supports endpoint-class guardrail limits and observable snapshots", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 10,
      endpointClassLimits: {
        message_send: 1,
      },
      windowMilliseconds: 1000,
      clock: new ManualClock(1000),
    });

    const first = limiter.check({
      credential,
      method: "POST",
      url: "/v1/instances/inst_allowed/messages/text",
      endpointClass: "message_send",
      instanceRef: "inst_allowed",
    });
    const second = limiter.check({
      credential,
      method: "POST",
      url: "/v1/instances/inst_allowed/messages/text",
      endpointClass: "message_send",
      instanceRef: "inst_allowed",
    });

    expect(first).toMatchObject({ allowed: true, limit: 1, remaining: 0 });
    expect(second).toMatchObject({ allowed: false, limit: 1 });
    expect(limiter.snapshot()).toMatchObject({
      windowMilliseconds: 1000,
      buckets: [
        {
          keyId: "rate-key",
          endpointClass: "message_send",
          scopeRef: "inst_allowed",
          scopeKind: "instance",
          count: 1,
          limit: 1,
          remaining: 0,
        },
      ],
    });
  });

  it("resets fixed-window buckets when the window advances", () => {
    const clock = new ManualClock(1000);
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 1,
      windowMilliseconds: 1000,
      clock,
    });

    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances",
        endpointClass: "read",
      }),
    ).toMatchObject({ allowed: true });
    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances",
        endpointClass: "read",
      }),
    ).toMatchObject({ allowed: false });

    clock.advance(1000);

    expect(
      limiter.check({
        credential,
        method: "GET",
        url: "/v1/instances",
        endpointClass: "read",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("supports shared counter stores for multi-process rate limit semantics", async () => {
    const clock = new ManualClock(1000);
    const store = new InMemoryRateLimitCounterStore();
    const firstRuntimeLimiter = new SharedFixedWindowRateLimiter({
      maxRequests: 2,
      windowMilliseconds: 1000,
      store,
      clock,
    });
    const secondRuntimeLimiter = new SharedFixedWindowRateLimiter({
      maxRequests: 2,
      windowMilliseconds: 1000,
      store,
      clock,
    });
    const request = {
      credential,
      method: "GET",
      url: "/v1/instances/inst_shared",
      endpointClass: "read" as const,
      targetRef: "inst_shared",
    };

    await expect(firstRuntimeLimiter.check(request)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(secondRuntimeLimiter.check(request)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    await expect(firstRuntimeLimiter.check(request)).resolves.toMatchObject({
      allowed: false,
      retryAfterMilliseconds: 1000,
    });
    await expect(firstRuntimeLimiter.snapshot()).resolves.toMatchObject({
      buckets: [
        {
          keyId: "rate-key",
          scopeRef: "inst_shared",
          count: 2,
          limit: 2,
          remaining: 0,
        },
      ],
    });
  });

  it("uses hashed Redis keys without raw credential or resource identifiers", async () => {
    const clock = new ManualClock(1000);
    const redisClient = new FakeRedisRateLimitScriptClient();
    const limiter = new SharedFixedWindowRateLimiter({
      maxRequests: 1,
      windowMilliseconds: 1000,
      store: new RedisRateLimitCounterStore({
        client: redisClient,
        keyPrefix: "omniwa:test-rate-limit",
      }),
      clock,
    });
    const rawKeyId = "rate-key-sensitive";
    const rawInstanceRef = "inst_sensitive";
    const request = {
      credential: {
        ...credential,
        keyId: rawKeyId,
      },
      method: "GET",
      url: `/v1/instances/${rawInstanceRef}`,
      endpointClass: "read" as const,
      instanceRef: rawInstanceRef,
    };

    await expect(limiter.check(request)).resolves.toMatchObject({ allowed: true });
    await expect(limiter.check(request)).resolves.toMatchObject({ allowed: false });

    expect(redisClient.calls).toHaveLength(2);
    expect(redisClient.calls[0]?.keys[0]).toMatch(/^omniwa:test-rate-limit:[a-f0-9]{64}$/u);
    expect(JSON.stringify(redisClient.calls)).not.toContain(rawKeyId);
    expect(JSON.stringify(redisClient.calls)).not.toContain(rawInstanceRef);
  });

  it("classifies endpoint classes from public API surface shape", () => {
    expect(classifyRateLimitEndpoint("GET", "/v1/events/stream")).toBe("event_stream");
    expect(classifyRateLimitEndpoint("POST", "/v1/instances/inst_1/messages/text")).toBe(
      "message_send",
    );
    expect(classifyRateLimitEndpoint("GET", "/v1/settings")).toBe("admin");
    expect(classifyRateLimitEndpoint("GET", "/v1/instances")).toBe("read");
    expect(classifyRateLimitEndpoint("POST", "/v1/webhooks")).toBe("write");
  });
});

class ManualClock {
  constructor(private currentEpochMilliseconds: number) {}

  epochMilliseconds(): number {
    return this.currentEpochMilliseconds;
  }

  advance(milliseconds: number): void {
    this.currentEpochMilliseconds += milliseconds;
  }
}

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
    const key = required(input.keys[0], "redis key");
    const windowStartEpochMilliseconds = Number(required(input.arguments[0], "window start"));
    const resetAtEpochMilliseconds = Number(required(input.arguments[1], "reset at"));
    const limit = Number(required(input.arguments[3], "limit"));
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

function required(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new TypeError(`${label} is required.`);
  }

  return value;
}
