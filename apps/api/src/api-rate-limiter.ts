import { createHash } from "node:crypto";

import type { ApiCredential } from "@omniwa/interface-api";

export const apiRateLimitEndpointClasses = [
  "read",
  "write",
  "message_send",
  "admin",
  "event_stream",
] as const;

export type ApiRateLimitEndpointClass = (typeof apiRateLimitEndpointClasses)[number];

export type ApiRateLimitRequest = Readonly<{
  credential: ApiCredential;
  method: string;
  url: string;
  endpointClass: ApiRateLimitEndpointClass;
  instanceRef?: string;
  targetRef?: string;
}>;

export type ApiRateLimitDecision = Readonly<
  | {
      allowed: true;
      limit: number;
      remaining: number;
      resetAtEpochMilliseconds: number;
      bucketKey: string;
    }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
      resetAtEpochMilliseconds: number;
      retryAfterMilliseconds: number;
      bucketKey: string;
    }
>;

export interface ApiRateLimiter {
  check(request: ApiRateLimitRequest): ApiRateLimitDecision | Promise<ApiRateLimitDecision>;
  snapshot?(): ApiRateLimitSnapshot | Promise<ApiRateLimitSnapshot>;
}

export type InMemoryFixedWindowRateLimiterOptions = Readonly<{
  maxRequests: number;
  windowMilliseconds: number;
  endpointClassLimits?: Partial<Record<ApiRateLimitEndpointClass, number>>;
  clock?: Pick<ApiRateLimitClock, "epochMilliseconds">;
}>;

export type SharedFixedWindowRateLimiterOptions = Readonly<{
  maxRequests: number;
  windowMilliseconds: number;
  store: ApiRateLimitCounterStore;
  endpointClassLimits?: Partial<Record<ApiRateLimitEndpointClass, number>>;
  clock?: Pick<ApiRateLimitClock, "epochMilliseconds">;
}>;

export type ApiRateLimitClock = Readonly<{
  epochMilliseconds(): number;
}>;

export type ApiRateLimitSnapshot = Readonly<{
  windowMilliseconds: number;
  buckets: readonly ApiRateLimitBucketSnapshot[];
}>;

export type ApiRateLimitBucketSnapshot = Readonly<{
  bucketKey: string;
  keyId: string;
  endpointClass: ApiRateLimitEndpointClass;
  scopeRef: string;
  scopeKind: "instance" | "resource" | "global";
  count: number;
  limit: number;
  remaining: number;
  resetAtEpochMilliseconds: number;
}>;

type RateLimitBucket = {
  windowStartEpochMilliseconds: number;
  count: number;
};

export type ApiRateLimitCounterConsumeInput = Readonly<{
  bucketKey: string;
  descriptor: RateLimitBucketDescriptor;
  limit: number;
  windowStartEpochMilliseconds: number;
  resetAtEpochMilliseconds: number;
  expiresAfterMilliseconds: number;
}>;

export type ApiRateLimitCounterConsumeResult = Readonly<{
  allowed: boolean;
  count: number;
  resetAtEpochMilliseconds: number;
}>;

export interface ApiRateLimitCounterStore {
  consume(input: ApiRateLimitCounterConsumeInput): Promise<ApiRateLimitCounterConsumeResult>;
  snapshot?(
    input: Readonly<{
      nowEpochMilliseconds: number;
      windowMilliseconds: number;
    }>,
  ): Promise<readonly ApiRateLimitBucketSnapshot[]>;
}

export type InMemoryRateLimitCounterStoreOptions = Readonly<{
  sharedBuckets?: Map<string, RateLimitBucket>;
}>;

export class InMemoryRateLimitCounterStore implements ApiRateLimitCounterStore {
  private readonly buckets: Map<string, RateLimitBucket>;
  private readonly bucketDescriptors = new Map<string, RateLimitBucketDescriptor>();
  private readonly bucketLimits = new Map<string, number>();

  constructor(options: InMemoryRateLimitCounterStoreOptions = {}) {
    this.buckets = options.sharedBuckets ?? new Map();
  }

  consume(input: ApiRateLimitCounterConsumeInput): Promise<ApiRateLimitCounterConsumeResult> {
    this.bucketDescriptors.set(input.bucketKey, input.descriptor);
    this.bucketLimits.set(input.bucketKey, input.limit);

    const current = this.buckets.get(input.bucketKey);
    const bucket =
      current !== undefined &&
      current.windowStartEpochMilliseconds === input.windowStartEpochMilliseconds
        ? current
        : {
            windowStartEpochMilliseconds: input.windowStartEpochMilliseconds,
            count: 0,
          };

    this.buckets.set(input.bucketKey, bucket);

    if (bucket.count >= input.limit) {
      return Promise.resolve(
        Object.freeze({
          allowed: false,
          count: bucket.count,
          resetAtEpochMilliseconds: input.resetAtEpochMilliseconds,
        }),
      );
    }

    bucket.count += 1;

    return Promise.resolve(
      Object.freeze({
        allowed: true,
        count: bucket.count,
        resetAtEpochMilliseconds: input.resetAtEpochMilliseconds,
      }),
    );
  }

  snapshot(input: Readonly<{ nowEpochMilliseconds: number; windowMilliseconds: number }>) {
    return Promise.resolve(
      Object.freeze(
        [...this.buckets.entries()].map(([bucketKey, bucket]) => {
          const descriptor = this.bucketDescriptors.get(bucketKey);
          const endpointClass = descriptor?.endpointClass ?? "read";
          const limit = this.bucketLimits.get(bucketKey) ?? 1;
          const count = isCurrentWindow(
            bucket,
            input.nowEpochMilliseconds,
            input.windowMilliseconds,
          )
            ? bucket.count
            : 0;

          return Object.freeze({
            bucketKey,
            keyId: descriptor?.keyId ?? "unknown",
            endpointClass,
            scopeRef: descriptor?.scopeRef ?? "global",
            scopeKind: descriptor?.scopeKind ?? "global",
            count,
            limit,
            remaining: Math.max(0, limit - count),
            resetAtEpochMilliseconds:
              bucket.windowStartEpochMilliseconds + input.windowMilliseconds,
          });
        }),
      ),
    );
  }
}

export type RedisRateLimitScriptClient = Readonly<{
  eval(
    script: string,
    input: Readonly<{
      keys: readonly string[];
      arguments: readonly string[];
    }>,
  ): Promise<unknown>;
}>;

export type RedisRateLimitCounterStoreOptions = Readonly<{
  client: RedisRateLimitScriptClient;
  keyPrefix?: string;
}>;

export class RedisRateLimitCounterStore implements ApiRateLimitCounterStore {
  private readonly client: RedisRateLimitScriptClient;
  private readonly keyPrefix: string;

  constructor(options: RedisRateLimitCounterStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? "omniwa:api-rate-limit";
  }

  async consume(input: ApiRateLimitCounterConsumeInput): Promise<ApiRateLimitCounterConsumeResult> {
    const result = await this.client.eval(redisFixedWindowConsumeScript, {
      keys: [this.keyFor(input.bucketKey)],
      arguments: [
        String(input.windowStartEpochMilliseconds),
        String(input.resetAtEpochMilliseconds),
        String(input.expiresAfterMilliseconds),
        String(input.limit),
      ],
    });
    const [allowed, count, resetAtEpochMilliseconds] = parseRedisConsumeResult(result);

    return Object.freeze({
      allowed,
      count,
      resetAtEpochMilliseconds,
    });
  }

  private keyFor(bucketKey: string): string {
    return `${this.keyPrefix}:${hashSafeBucketKey(bucketKey)}`;
  }
}

export class InMemoryFixedWindowRateLimiter implements ApiRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMilliseconds: number;
  private readonly endpointClassLimits: Partial<Record<ApiRateLimitEndpointClass, number>>;
  private readonly clock: Pick<ApiRateLimitClock, "epochMilliseconds">;
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly bucketDescriptors = new Map<string, RateLimitBucketDescriptor>();

  constructor(options: InMemoryFixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMilliseconds = options.windowMilliseconds;
    this.endpointClassLimits = Object.freeze({ ...(options.endpointClassLimits ?? {}) });
    this.clock = options.clock ?? { epochMilliseconds: () => Date.now() };
    assertPositiveInteger(this.maxRequests, "maxRequests");
    assertPositiveInteger(this.windowMilliseconds, "windowMilliseconds");
    for (const [endpointClass, limit] of Object.entries(this.endpointClassLimits)) {
      if (!isApiRateLimitEndpointClass(endpointClass)) {
        throw new TypeError(`Unsupported endpoint class limit: ${endpointClass}`);
      }
      assertPositiveInteger(limit, `${endpointClass} limit`);
    }
  }

  check(request: ApiRateLimitRequest): ApiRateLimitDecision {
    const now = this.clock.epochMilliseconds();
    const descriptor = createRateLimitBucketDescriptor(request);
    const bucketKey = createRateLimitBucketKey(descriptor);
    const limit = this.limitFor(request.endpointClass);
    this.bucketDescriptors.set(bucketKey, descriptor);
    const bucket = this.getCurrentBucket(bucketKey, now);
    const resetAtEpochMilliseconds = bucket.windowStartEpochMilliseconds + this.windowMilliseconds;

    if (bucket.count >= limit) {
      return Object.freeze({
        allowed: false,
        limit,
        remaining: 0,
        resetAtEpochMilliseconds,
        retryAfterMilliseconds: Math.max(0, resetAtEpochMilliseconds - now),
        bucketKey,
      });
    }

    bucket.count += 1;

    return Object.freeze({
      allowed: true,
      limit,
      remaining: limit - bucket.count,
      resetAtEpochMilliseconds,
      bucketKey,
    });
  }

  snapshot(): ApiRateLimitSnapshot {
    const now = this.clock.epochMilliseconds();

    return Object.freeze({
      windowMilliseconds: this.windowMilliseconds,
      buckets: Object.freeze(
        [...this.buckets.entries()].map(([bucketKey, bucket]) => {
          const descriptor = this.bucketDescriptors.get(bucketKey);
          const endpointClass = descriptor?.endpointClass ?? "read";
          const limit = this.limitFor(endpointClass);
          const resetAtEpochMilliseconds =
            bucket.windowStartEpochMilliseconds + this.windowMilliseconds;

          return Object.freeze({
            bucketKey,
            keyId: descriptor?.keyId ?? "unknown",
            endpointClass,
            scopeRef: descriptor?.scopeRef ?? "global",
            scopeKind: descriptor?.scopeKind ?? "global",
            count: isCurrentWindow(bucket, now, this.windowMilliseconds) ? bucket.count : 0,
            limit,
            remaining: Math.max(
              0,
              limit - (isCurrentWindow(bucket, now, this.windowMilliseconds) ? bucket.count : 0),
            ),
            resetAtEpochMilliseconds,
          });
        }),
      ),
    });
  }

  private getCurrentBucket(bucketKey: string, now: number): RateLimitBucket {
    const windowStartEpochMilliseconds = getWindowStart(now, this.windowMilliseconds);
    const current = this.buckets.get(bucketKey);

    if (
      current !== undefined &&
      current.windowStartEpochMilliseconds === windowStartEpochMilliseconds
    ) {
      return current;
    }

    const next = {
      windowStartEpochMilliseconds,
      count: 0,
    };
    this.buckets.set(bucketKey, next);

    return next;
  }

  private limitFor(endpointClass: ApiRateLimitEndpointClass): number {
    return this.endpointClassLimits[endpointClass] ?? this.maxRequests;
  }
}

export class SharedFixedWindowRateLimiter implements ApiRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMilliseconds: number;
  private readonly endpointClassLimits: Partial<Record<ApiRateLimitEndpointClass, number>>;
  private readonly clock: Pick<ApiRateLimitClock, "epochMilliseconds">;
  private readonly store: ApiRateLimitCounterStore;

  constructor(options: SharedFixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMilliseconds = options.windowMilliseconds;
    this.endpointClassLimits = Object.freeze({ ...(options.endpointClassLimits ?? {}) });
    this.clock = options.clock ?? { epochMilliseconds: () => Date.now() };
    this.store = options.store;
    assertPositiveInteger(this.maxRequests, "maxRequests");
    assertPositiveInteger(this.windowMilliseconds, "windowMilliseconds");
    for (const [endpointClass, limit] of Object.entries(this.endpointClassLimits)) {
      if (!isApiRateLimitEndpointClass(endpointClass)) {
        throw new TypeError(`Unsupported endpoint class limit: ${endpointClass}`);
      }
      assertPositiveInteger(limit, `${endpointClass} limit`);
    }
  }

  async check(request: ApiRateLimitRequest): Promise<ApiRateLimitDecision> {
    const now = this.clock.epochMilliseconds();
    const descriptor = createRateLimitBucketDescriptor(request);
    const bucketKey = createRateLimitBucketKey(descriptor);
    const limit = this.limitFor(request.endpointClass);
    const windowStartEpochMilliseconds = getWindowStart(now, this.windowMilliseconds);
    const resetAtEpochMilliseconds = windowStartEpochMilliseconds + this.windowMilliseconds;
    const result = await this.store.consume({
      bucketKey,
      descriptor,
      limit,
      windowStartEpochMilliseconds,
      resetAtEpochMilliseconds,
      expiresAfterMilliseconds: Math.max(1, resetAtEpochMilliseconds - now),
    });

    if (!result.allowed) {
      return Object.freeze({
        allowed: false,
        limit,
        remaining: 0,
        resetAtEpochMilliseconds: result.resetAtEpochMilliseconds,
        retryAfterMilliseconds: Math.max(0, result.resetAtEpochMilliseconds - now),
        bucketKey,
      });
    }

    return Object.freeze({
      allowed: true,
      limit,
      remaining: Math.max(0, limit - result.count),
      resetAtEpochMilliseconds: result.resetAtEpochMilliseconds,
      bucketKey,
    });
  }

  async snapshot(): Promise<ApiRateLimitSnapshot> {
    const now = this.clock.epochMilliseconds();

    return Object.freeze({
      windowMilliseconds: this.windowMilliseconds,
      buckets: this.store.snapshot
        ? await this.store.snapshot({
            nowEpochMilliseconds: now,
            windowMilliseconds: this.windowMilliseconds,
          })
        : Object.freeze([]),
    });
  }

  private limitFor(endpointClass: ApiRateLimitEndpointClass): number {
    return this.endpointClassLimits[endpointClass] ?? this.maxRequests;
  }
}

export function classifyRateLimitEndpoint(
  methodInput: string,
  urlInput: string,
): ApiRateLimitEndpointClass {
  const method = methodInput.toUpperCase();
  const pathname = parsePathname(urlInput);

  if (pathname === "/v1/events/stream") {
    return "event_stream";
  }

  if (
    pathname.startsWith("/v1/settings") ||
    pathname.startsWith("/v1/audit-records") ||
    pathname.startsWith("/v1/api-keys")
  ) {
    return "admin";
  }

  if (pathname.includes("/messages") && method !== "GET") {
    return "message_send";
  }

  if (method === "GET" || method === "HEAD") {
    return "read";
  }

  return "write";
}

type RateLimitBucketDescriptor = Readonly<{
  keyId: string;
  endpointClass: ApiRateLimitEndpointClass;
  scopeRef: string;
  scopeKind: "instance" | "resource" | "global";
}>;

function createRateLimitBucketDescriptor(request: ApiRateLimitRequest): RateLimitBucketDescriptor {
  if (request.instanceRef !== undefined) {
    return Object.freeze({
      keyId: request.credential.keyId,
      endpointClass: request.endpointClass,
      scopeRef: request.instanceRef,
      scopeKind: "instance",
    });
  }

  if (request.targetRef !== undefined) {
    return Object.freeze({
      keyId: request.credential.keyId,
      endpointClass: request.endpointClass,
      scopeRef: request.targetRef,
      scopeKind: "resource",
    });
  }

  return Object.freeze({
    keyId: request.credential.keyId,
    endpointClass: request.endpointClass,
    scopeRef: "global",
    scopeKind: "global",
  });
}

function createRateLimitBucketKey(descriptor: RateLimitBucketDescriptor): string {
  return [
    descriptor.keyId,
    descriptor.endpointClass,
    descriptor.scopeKind,
    descriptor.scopeRef,
  ].join(":");
}

function parsePathname(urlInput: string): string {
  try {
    return new URL(urlInput, "http://omniwa.local").pathname;
  } catch {
    return "/";
  }
}

function getWindowStart(now: number, windowMilliseconds: number): number {
  return Math.floor(now / windowMilliseconds) * windowMilliseconds;
}

function isCurrentWindow(
  bucket: RateLimitBucket,
  now: number,
  windowMilliseconds: number,
): boolean {
  return bucket.windowStartEpochMilliseconds === getWindowStart(now, windowMilliseconds);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function isApiRateLimitEndpointClass(value: string): value is ApiRateLimitEndpointClass {
  return apiRateLimitEndpointClasses.includes(value as ApiRateLimitEndpointClass);
}

function hashSafeBucketKey(bucketKey: string): string {
  return createHash("sha256").update(bucketKey).digest("hex");
}

const redisFixedWindowConsumeScript = `
local windowStart = redis.call("HGET", KEYS[1], "windowStart")
local count = 0

if windowStart ~= ARGV[1] then
  redis.call("HSET", KEYS[1], "windowStart", ARGV[1], "count", 0)
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
else
  count = tonumber(redis.call("HGET", KEYS[1], "count") or "0")
end

local limit = tonumber(ARGV[4])

if count >= limit then
  return {0, count, tonumber(ARGV[2])}
end

count = redis.call("HINCRBY", KEYS[1], "count", 1)
redis.call("PEXPIRE", KEYS[1], ARGV[3])

return {1, count, tonumber(ARGV[2])}
`;

function parseRedisConsumeResult(result: unknown): readonly [boolean, number, number] {
  if (!Array.isArray(result) || result.length < 3) {
    throw new TypeError("Redis rate limit script returned an invalid result.");
  }

  const allowed = Number(result[0]);
  const count = Number(result[1]);
  const resetAtEpochMilliseconds = Number(result[2]);

  if (
    (allowed !== 0 && allowed !== 1) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isSafeInteger(resetAtEpochMilliseconds) ||
    resetAtEpochMilliseconds < 0
  ) {
    throw new TypeError("Redis rate limit script returned an invalid result.");
  }

  return Object.freeze([allowed === 1, count, resetAtEpochMilliseconds]);
}
