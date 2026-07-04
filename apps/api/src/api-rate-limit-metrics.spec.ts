import { describe, expect, it } from "vitest";

import { InMemoryFixedWindowRateLimiter } from "./api-rate-limiter.js";
import { createApiRateLimitMetricPoints } from "./api-rate-limit-metrics.js";

describe("API rate-limit metrics", () => {
  it("exports aggregate rate-limit bucket metrics without raw identifiers", () => {
    const limiter = new InMemoryFixedWindowRateLimiter({
      maxRequests: 10,
      endpointClassLimits: {
        message_send: 2,
      },
      windowMilliseconds: 60_000,
      clock: { epochMilliseconds: () => 1_804_000_000_000 },
    });

    limiter.check({
      credential: {
        kind: "api_key",
        keyId: "sensitive-key-id",
        scopes: ["messages:send"],
      },
      method: "POST",
      url: "/v1/instances/inst_sensitive/messages/text",
      endpointClass: "message_send",
      instanceRef: "inst_sensitive",
      targetRef: "msg_sensitive",
    });
    limiter.check({
      credential: {
        kind: "api_key",
        keyId: "sensitive-key-id",
        scopes: ["messages:send"],
      },
      method: "GET",
      url: "/v1/messages/msg_sensitive",
      endpointClass: "read",
      instanceRef: "inst_sensitive",
      targetRef: "msg_sensitive",
    });

    const points = createApiRateLimitMetricPoints(limiter.snapshot());
    const serialized = JSON.stringify(points);

    expect(points).toHaveLength(6);
    expect(points.map((point) => point.name)).toContain("api.rate_limit.bucket.count");
    expect(points).toContainEqual(
      expect.objectContaining({
        labels: {
          endpoint_class: "message_send",
          scope_kind: "instance",
        },
      }),
    );
    expect(serialized).not.toContain("sensitive-key-id");
    expect(serialized).not.toContain("inst_sensitive");
    expect(serialized).not.toContain("msg_sensitive");
  });

  it("aggregates buckets by low-cardinality endpoint class and scope kind", () => {
    const points = createApiRateLimitMetricPoints({
      windowMilliseconds: 60_000,
      buckets: [
        {
          bucketKey: "key-1:read:instance:inst_1",
          keyId: "key-1",
          endpointClass: "read",
          scopeKind: "instance",
          scopeRef: "inst_1",
          count: 2,
          limit: 10,
          remaining: 8,
          resetAtEpochMilliseconds: 1_804_000_060_000,
        },
        {
          bucketKey: "key-2:read:instance:inst_2",
          keyId: "key-2",
          endpointClass: "read",
          scopeKind: "instance",
          scopeRef: "inst_2",
          count: 3,
          limit: 10,
          remaining: 7,
          resetAtEpochMilliseconds: 1_804_000_060_000,
        },
      ],
    });

    expect(points).toEqual([
      expect.objectContaining({
        name: "api.rate_limit.bucket.count",
        value: 5,
        labels: {
          endpoint_class: "read",
          scope_kind: "instance",
        },
      }),
      expect.objectContaining({
        name: "api.rate_limit.bucket.remaining",
        value: 15,
      }),
      expect.objectContaining({
        name: "api.rate_limit.bucket.limit",
        value: 20,
      }),
    ]);
  });
});
