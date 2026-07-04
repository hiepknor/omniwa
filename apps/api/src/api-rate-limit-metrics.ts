import {
  classifyValue,
  createCatalogMetricPoint,
  toSafeLogFields,
  type MetricPoint,
} from "@omniwa/observability";

import type {
  ApiRateLimitBucketSnapshot,
  ApiRateLimitEndpointClass,
  ApiRateLimitSnapshot,
} from "./api-rate-limiter.js";

type RateLimitMetricAggregateKey =
  `${ApiRateLimitEndpointClass}:${ApiRateLimitBucketSnapshot["scopeKind"]}`;

type RateLimitMetricAggregate = {
  endpointClass: ApiRateLimitEndpointClass;
  scopeKind: ApiRateLimitBucketSnapshot["scopeKind"];
  count: number;
  remaining: number;
  limit: number;
};

export function createApiRateLimitMetricPoints(
  snapshot: ApiRateLimitSnapshot,
): readonly MetricPoint[] {
  const aggregates = aggregateRateLimitBuckets(snapshot.buckets);

  return Object.freeze(
    aggregates.flatMap((aggregate) => [
      createRateLimitMetricPoint("api.rate_limit.bucket.count", aggregate, aggregate.count),
      createRateLimitMetricPoint("api.rate_limit.bucket.remaining", aggregate, aggregate.remaining),
      createRateLimitMetricPoint("api.rate_limit.bucket.limit", aggregate, aggregate.limit),
    ]),
  );
}

function aggregateRateLimitBuckets(
  buckets: readonly ApiRateLimitBucketSnapshot[],
): readonly RateLimitMetricAggregate[] {
  const aggregates = new Map<RateLimitMetricAggregateKey, RateLimitMetricAggregate>();

  for (const bucket of buckets) {
    const key: RateLimitMetricAggregateKey = `${bucket.endpointClass}:${bucket.scopeKind}`;
    const current =
      aggregates.get(key) ??
      ({
        endpointClass: bucket.endpointClass,
        scopeKind: bucket.scopeKind,
        count: 0,
        remaining: 0,
        limit: 0,
      } satisfies RateLimitMetricAggregate);

    current.count += bucket.count;
    current.remaining += bucket.remaining;
    current.limit += bucket.limit;
    aggregates.set(key, current);
  }

  return Object.freeze(
    [...aggregates.values()].map((aggregate) =>
      Object.freeze({
        ...aggregate,
      }),
    ),
  );
}

function createRateLimitMetricPoint(
  name:
    | "api.rate_limit.bucket.count"
    | "api.rate_limit.bucket.remaining"
    | "api.rate_limit.bucket.limit",
  aggregate: RateLimitMetricAggregate,
  value: number,
): MetricPoint {
  return createCatalogMetricPoint(name, {
    value,
    labels: toSafeLogFields({
      endpoint_class: classifyValue(aggregate.endpointClass, "public"),
      scope_kind: classifyValue(aggregate.scopeKind, "public"),
    }),
  });
}
