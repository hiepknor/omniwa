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
  check(request: ApiRateLimitRequest): ApiRateLimitDecision;
  snapshot?(): ApiRateLimitSnapshot;
}

export type InMemoryFixedWindowRateLimiterOptions = Readonly<{
  maxRequests: number;
  windowMilliseconds: number;
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

export function classifyRateLimitEndpoint(
  methodInput: string,
  urlInput: string,
): ApiRateLimitEndpointClass {
  const method = methodInput.toUpperCase();
  const pathname = parsePathname(urlInput);

  if (pathname === "/v1/events/stream") {
    return "event_stream";
  }

  if (pathname.startsWith("/v1/settings") || pathname.startsWith("/v1/audit-records")) {
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
