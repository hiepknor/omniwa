import type { ApiCredential } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import { InMemoryFixedWindowRateLimiter, classifyRateLimitEndpoint } from "./api-rate-limiter.js";

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
