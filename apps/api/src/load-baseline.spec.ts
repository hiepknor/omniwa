import { performance } from "node:perf_hooks";

import {
  createApplicationCommandOutcome,
  createApplicationQueryOutcome,
  type ApplicationCommandEnvelope,
  type ApplicationCommandOutcome,
  type ApplicationQueryEnvelope,
  type ApplicationQueryOutcome,
} from "@omniwa/application";
import type { ApiCredential, ApplicationInterfaceDispatcher } from "@omniwa/interface-api";
import { describe, expect, it } from "vitest";

import { handleApiHttpRequest, type ApiKeyConfig } from "./http-server.js";

const requestCount = 400;
const p95LatencyBudgetMilliseconds = 50;
const minimumThroughputRequestsPerSecond = 250;
const maxErrorRate = 0;

const loadCredential: ApiCredential = {
  kind: "api_key",
  keyId: "load-baseline-key",
  scopes: ["health:read", "instances:read", "messages:read", "messages:send"],
  allowedInstanceRefs: ["inst_load"],
};

const apiKeys: readonly ApiKeyConfig[] = [
  {
    key: "load-baseline-secret",
    credential: loadCredential,
  },
];

describe("API load baseline", () => {
  it("keeps in-process REST adapter latency, throughput, and error budgets within baseline", async () => {
    const dispatcher = new LoadBaselineDispatcher();
    const latencies: number[] = [];
    const startedAt = performance.now();
    let errorCount = 0;

    for (let index = 0; index < requestCount; index += 1) {
      const requestStartedAt = performance.now();
      const response = await handleApiHttpRequest(
        {
          method: "GET",
          url: routeForIndex(index),
          headers: {
            "x-api-key": "load-baseline-secret",
            "x-request-id": `req-load-${index}`,
            "x-correlation-id": `corr-load-${index}`,
          },
        },
        {
          dispatcher,
          apiKeys,
          now: () => new Date("2026-07-01T00:00:00.000Z"),
          requestRefGenerator: () => `http-load-${index}`,
        },
      );
      latencies.push(performance.now() - requestStartedAt);

      if (response.statusCode >= 500) {
        errorCount += 1;
      }
    }

    const totalDurationMilliseconds = performance.now() - startedAt;
    const summary = summarizeLoadBaseline({
      latencies,
      totalDurationMilliseconds,
      errorCount,
    });

    expect(summary.errorRate).toBe(maxErrorRate);
    expect(summary.p95LatencyMilliseconds).toBeLessThanOrEqual(p95LatencyBudgetMilliseconds);
    expect(summary.throughputRequestsPerSecond).toBeGreaterThanOrEqual(
      minimumThroughputRequestsPerSecond,
    );
    expect(dispatcher.queryCount).toBe(requestCount);
  });
});

function routeForIndex(index: number): string {
  if (index % 4 === 0) {
    return "/v1/health";
  }

  if (index % 4 === 1) {
    return "/v1/instances";
  }

  if (index % 4 === 2) {
    return "/v1/instances/inst_load";
  }

  return "/v1/instances/inst_load/messages";
}

function summarizeLoadBaseline(input: {
  latencies: readonly number[];
  totalDurationMilliseconds: number;
  errorCount: number;
}): Readonly<{
  p95LatencyMilliseconds: number;
  throughputRequestsPerSecond: number;
  errorRate: number;
}> {
  const sorted = [...input.latencies].sort((left, right) => left - right);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return Object.freeze({
    p95LatencyMilliseconds: sorted[p95Index] ?? 0,
    throughputRequestsPerSecond: input.latencies.length / (input.totalDurationMilliseconds / 1000),
    errorRate: input.errorCount / input.latencies.length,
  });
}

class LoadBaselineDispatcher implements ApplicationInterfaceDispatcher {
  queryCount = 0;

  executeCommand(envelope: ApplicationCommandEnvelope): ApplicationCommandOutcome {
    return createApplicationCommandOutcome({
      commandRef: envelope.commandRef,
      outcome: "queued",
      accepted: true,
      retryable: false,
      resultRef: `${envelope.commandRef}:load-result`,
    });
  }

  executeQuery(envelope: ApplicationQueryEnvelope): ApplicationQueryOutcome {
    this.queryCount += 1;

    return Object.freeze({
      ...createApplicationQueryOutcome({
        queryRef: envelope.queryRef,
        outcome: "result",
        consistency: envelope.requestedConsistency ?? "eventual_projection",
        freshness: {
          stale: false,
          refreshedAtEpochMilliseconds: 1_800_000_000_000,
        },
        resultRef: `${envelope.queryRef}:load-result`,
      }),
      ...(envelope.name === "ListInstances" ? { items: [{ instanceId: "inst_load" }] } : {}),
    }) as ApplicationQueryOutcome;
  }
}
