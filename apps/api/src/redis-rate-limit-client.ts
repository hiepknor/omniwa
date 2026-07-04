import { createClient } from "redis";

import type { RedisRateLimitScriptClient } from "./api-rate-limiter.js";

const DEFAULT_CONNECT_TIMEOUT_MILLISECONDS = 5_000;

export type NodeRedisRateLimitEvalClient = {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  eval(
    script: string,
    input: {
      keys: string[];
      arguments: string[];
    },
  ): Promise<unknown>;
  close?(): Promise<unknown>;
  destroy?(): void;
};

export type NodeRedisRateLimitScriptClientOptions = Readonly<{
  url: string;
  connectTimeoutMilliseconds?: number;
  clientName?: string;
}>;

export class NodeRedisRateLimitScriptClient implements RedisRateLimitScriptClient {
  readonly #client: NodeRedisRateLimitEvalClient;
  #connectPromise: Promise<void> | undefined;

  constructor(client: NodeRedisRateLimitEvalClient) {
    this.#client = client;
  }

  async eval(
    script: string,
    input: Readonly<{
      keys: readonly string[];
      arguments: readonly string[];
    }>,
  ): Promise<unknown> {
    await this.ensureConnected();

    try {
      return await this.#client.eval(script, {
        keys: [...input.keys],
        arguments: [...input.arguments],
      });
    } catch {
      throw createRedisRateLimitDependencyError();
    }
  }

  async close(): Promise<void> {
    try {
      if (this.#client.close !== undefined) {
        await this.#client.close();
        return;
      }

      this.#client.destroy?.();
    } catch {
      throw createRedisRateLimitDependencyError();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.#client.isOpen) {
      return;
    }

    this.#connectPromise ??= this.#client
      .connect()
      .then(() => undefined)
      .catch(() => {
        throw createRedisRateLimitDependencyError();
      })
      .finally(() => {
        this.#connectPromise = undefined;
      });

    await this.#connectPromise;
  }
}

export function createNodeRedisRateLimitScriptClient(
  options: NodeRedisRateLimitScriptClientOptions,
): NodeRedisRateLimitScriptClient {
  const connectTimeoutMilliseconds =
    options.connectTimeoutMilliseconds ?? DEFAULT_CONNECT_TIMEOUT_MILLISECONDS;

  assertPositiveInteger(connectTimeoutMilliseconds, "connectTimeoutMilliseconds");

  const client = createClient({
    url: normalizeRedisRateLimitUrl(options.url),
    name: normalizeRedisRateLimitClientName(options.clientName),
    disableOfflineQueue: true,
    socket: {
      connectTimeout: connectTimeoutMilliseconds,
      reconnectStrategy: false,
    },
  });

  client.on("error", () => undefined);

  return new NodeRedisRateLimitScriptClient(client as unknown as NodeRedisRateLimitEvalClient);
}

export function normalizeRedisRateLimitUrl(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(
      "OMNIWA_API_RATE_LIMIT_REDIS_URL is required when OMNIWA_API_RATE_LIMIT_BACKEND=redis.",
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("OMNIWA_API_RATE_LIMIT_REDIS_URL must be a valid redis or rediss URL.");
  }

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("OMNIWA_API_RATE_LIMIT_REDIS_URL must use redis or rediss protocol.");
  }

  return parsed.toString();
}

function normalizeRedisRateLimitClientName(value: string | undefined): string {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0
    ? "omniwa-api-rate-limit"
    : normalized;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function createRedisRateLimitDependencyError(): Error {
  return new Error("Redis rate-limit dependency is unavailable.");
}
