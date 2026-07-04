import { describe, expect, it } from "vitest";

import {
  NodeRedisRateLimitScriptClient,
  createNodeRedisRateLimitScriptClient,
  normalizeRedisRateLimitUrl,
  type NodeRedisRateLimitEvalClient,
} from "./redis-rate-limit-client.js";

describe("NodeRedisRateLimitScriptClient", () => {
  it("connects lazily and delegates eval through the approved script boundary", async () => {
    const evalClient = new FakeNodeRedisRateLimitEvalClient();
    const client = new NodeRedisRateLimitScriptClient(evalClient);

    const result = await client.eval("return 1", {
      keys: ["omniwa:rate:hashed"],
      arguments: ["1", "2"],
    });

    expect(result).toEqual([1, 1, 2]);
    expect(evalClient.connectCalls).toBe(1);
    expect(evalClient.evalCalls).toEqual([
      {
        script: "return 1",
        keys: ["omniwa:rate:hashed"],
        arguments: ["1", "2"],
      },
    ]);
  });

  it("reuses an open client instead of reconnecting on every eval", async () => {
    const evalClient = new FakeNodeRedisRateLimitEvalClient();
    const client = new NodeRedisRateLimitScriptClient(evalClient);

    await client.eval("return 1", { keys: ["key-a"], arguments: ["1"] });
    await client.eval("return 1", { keys: ["key-b"], arguments: ["2"] });

    expect(evalClient.connectCalls).toBe(1);
    expect(evalClient.evalCalls).toHaveLength(2);
  });

  it("sanitizes connection and eval failures", async () => {
    const secretUrl = "redis://:super-secret@redis.internal:6379/0";
    const connectFailure = new FakeNodeRedisRateLimitEvalClient({
      connectError: new Error(secretUrl),
    });
    const evalFailure = new FakeNodeRedisRateLimitEvalClient({
      evalError: new Error(secretUrl),
    });

    await expect(
      new NodeRedisRateLimitScriptClient(connectFailure).eval("return 1", {
        keys: ["key-a"],
        arguments: ["1"],
      }),
    ).rejects.toThrow("Redis rate-limit dependency is unavailable.");
    await expect(
      new NodeRedisRateLimitScriptClient(evalFailure).eval("return 1", {
        keys: ["key-a"],
        arguments: ["1"],
      }),
    ).rejects.toThrow("Redis rate-limit dependency is unavailable.");

    await expect(
      new NodeRedisRateLimitScriptClient(connectFailure).eval("return 1", {
        keys: ["key-a"],
        arguments: ["1"],
      }),
    ).rejects.not.toThrow(secretUrl);
    await expect(
      new NodeRedisRateLimitScriptClient(evalFailure).eval("return 1", {
        keys: ["key-a"],
        arguments: ["1"],
      }),
    ).rejects.not.toThrow(secretUrl);
  });

  it("normalizes Redis URLs without logging or exposing secrets", () => {
    expect(normalizeRedisRateLimitUrl(" redis://localhost:6379/0 ")).toBe(
      "redis://localhost:6379/0",
    );
    expect(normalizeRedisRateLimitUrl("rediss://redis.example:6380/1")).toBe(
      "rediss://redis.example:6380/1",
    );

    expect(() => normalizeRedisRateLimitUrl("postgresql://redis.example/db")).toThrow(
      /must use redis or rediss protocol/u,
    );
    expect(() => normalizeRedisRateLimitUrl("redis://:secret with spaces")).toThrow(
      /must be a valid redis or rediss URL/u,
    );

    try {
      normalizeRedisRateLimitUrl("redis://:secret with spaces");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("creates a concrete redis client adapter without exposing connection details by JSON", () => {
    const client = createNodeRedisRateLimitScriptClient({
      url: "redis://:json-secret@redis.example:6379/0",
      connectTimeoutMilliseconds: 100,
      clientName: "omniwa-test-rate-limit",
    });

    expect(JSON.stringify(client)).toBe("{}");
    expect(JSON.stringify(client)).not.toContain("json-secret");
  });
});

type FakeNodeRedisRateLimitEvalClientOptions = Readonly<{
  connectError?: Error;
  evalError?: Error;
}>;

class FakeNodeRedisRateLimitEvalClient implements NodeRedisRateLimitEvalClient {
  isOpen = false;
  connectCalls = 0;
  readonly evalCalls: {
    script: string;
    keys: string[];
    arguments: string[];
  }[] = [];

  readonly #connectError: Error | undefined;
  readonly #evalError: Error | undefined;

  constructor(options: FakeNodeRedisRateLimitEvalClientOptions = {}) {
    this.#connectError = options.connectError;
    this.#evalError = options.evalError;
  }

  connect(): Promise<unknown> {
    this.connectCalls += 1;

    if (this.#connectError !== undefined) {
      return Promise.reject(this.#connectError);
    }

    this.isOpen = true;
    return Promise.resolve();
  }

  eval(
    script: string,
    input: {
      keys: string[];
      arguments: string[];
    },
  ): Promise<unknown> {
    this.evalCalls.push({
      script,
      keys: [...input.keys],
      arguments: [...input.arguments],
    });

    if (this.#evalError !== undefined) {
      return Promise.reject(this.#evalError);
    }

    return Promise.resolve([1, 1, 2]);
  }

  close(): Promise<unknown> {
    this.isOpen = false;
    return Promise.resolve();
  }
}
