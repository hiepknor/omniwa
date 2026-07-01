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
  targetRef?: string;
}>;

export type ApiRateLimitDecision = Readonly<
  | {
      allowed: true;
      limit: number;
      remaining: number;
      resetAtEpochMilliseconds: number;
    }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
      resetAtEpochMilliseconds: number;
      retryAfterMilliseconds: number;
    }
>;

export interface ApiRateLimiter {
  check(request: ApiRateLimitRequest): ApiRateLimitDecision;
}

export type InMemoryFixedWindowRateLimiterOptions = Readonly<{
  maxRequests: number;
  windowMilliseconds: number;
  clock?: Pick<ApiRateLimitClock, "epochMilliseconds">;
}>;

export type ApiRateLimitClock = Readonly<{
  epochMilliseconds(): number;
}>;

type RateLimitBucket = {
  windowStartEpochMilliseconds: number;
  count: number;
};

export class InMemoryFixedWindowRateLimiter implements ApiRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMilliseconds: number;
  private readonly clock: Pick<ApiRateLimitClock, "epochMilliseconds">;
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(options: InMemoryFixedWindowRateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMilliseconds = options.windowMilliseconds;
    this.clock = options.clock ?? { epochMilliseconds: () => Date.now() };
    assertPositiveInteger(this.maxRequests, "maxRequests");
    assertPositiveInteger(this.windowMilliseconds, "windowMilliseconds");
  }

  check(request: ApiRateLimitRequest): ApiRateLimitDecision {
    const now = this.clock.epochMilliseconds();
    const bucketKey = createRateLimitBucketKey(request);
    const bucket = this.getCurrentBucket(bucketKey, now);
    const resetAtEpochMilliseconds = bucket.windowStartEpochMilliseconds + this.windowMilliseconds;

    if (bucket.count >= this.maxRequests) {
      return Object.freeze({
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetAtEpochMilliseconds,
        retryAfterMilliseconds: Math.max(0, resetAtEpochMilliseconds - now),
      });
    }

    bucket.count += 1;

    return Object.freeze({
      allowed: true,
      limit: this.maxRequests,
      remaining: this.maxRequests - bucket.count,
      resetAtEpochMilliseconds,
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

function createRateLimitBucketKey(request: ApiRateLimitRequest): string {
  return [request.credential.keyId, request.endpointClass, request.targetRef ?? "global"].join(":");
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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}
