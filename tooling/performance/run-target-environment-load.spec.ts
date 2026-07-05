import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runTargetEnvironmentLoad,
  writeTargetEnvironmentLoadReport,
} from "./run-target-environment-load.mjs";

describe("target environment load runner", () => {
  it("runs bounded public API load with API key auth without exposing secrets", async () => {
    const calls: Array<Readonly<{ url: string; headers: Record<string, string> }>> = [];
    const report = await runTargetEnvironmentLoad({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      requestCount: 6,
      concurrency: 2,
      nowMilliseconds: monotonicClock(10),
      fetch: async (url: URL, init: RequestInit) => {
        calls.push(
          Object.freeze({
            url: url.toString(),
            headers: Object.freeze({ ...(init.headers as Record<string, string>) }),
          }),
        );

        return { ok: true, status: 200 };
      },
    });

    expect(report.status).toBe("passed");
    expect(report.budgets).toEqual(
      expect.objectContaining({
        requestCount: 6,
        concurrency: 2,
        maxP95LatencyMilliseconds: 2_000,
        minSuccessRatePercent: 100,
      }),
    );
    expect(report.summary).toEqual(
      expect.objectContaining({
        totalRequests: 6,
        successes: 6,
        failures: 0,
        successRatePercent: 100,
      }),
    );
    expect(report.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/v1/health", requests: 2 }),
        expect.objectContaining({ method: "GET", path: "/v1/health/readiness", requests: 2 }),
        expect.objectContaining({ method: "GET", path: "/v1/instances", requests: 2 }),
      ]),
    );
    expect(calls).toHaveLength(6);
    expect(calls[0]?.headers["x-api-key"]).toBe("target-secret-api-key");
    expect(calls[0]?.headers["x-request-id"]).toMatch(/^target-env-load-get-/u);
    expect(calls[0]?.headers["x-correlation-id"]).toBe("target-env-load");
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
  });

  it("fails safely when required target environment config is missing", async () => {
    const report = await runTargetEnvironmentLoad({
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      fetch: async () => ({ ok: true, status: 200 }),
    });

    expect(report).toEqual({
      status: "failed",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      budgets: {
        requestCount: 60,
        concurrency: 5,
        timeoutMilliseconds: 10_000,
        maxP95LatencyMilliseconds: 2_000,
        minSuccessRatePercent: 100,
      },
      summary: {
        totalRequests: 0,
        successes: 0,
        failures: 0,
        successRatePercent: 0,
        durationMilliseconds: 0,
        p95LatencyMilliseconds: 0,
        maxLatencyMilliseconds: 0,
      },
      endpoints: [],
      findings: [
        {
          code: "target_base_url_missing",
          severity: "blocker",
          safeDetailCode: "target_base_url_missing",
        },
        {
          code: "target_api_key_missing",
          severity: "blocker",
          safeDetailCode: "target_api_key_missing",
        },
      ],
    });
  });

  it("aggregates failed responses without serializing response bodies or target urls", async () => {
    const report = await runTargetEnvironmentLoad({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [{ method: "GET", path: "/v1/health/readiness" }],
      requestCount: 3,
      concurrency: 1,
      nowMilliseconds: monotonicClock(2),
      minSuccessRatePercent: 100,
      fetch: async () => ({ ok: false, status: 503, body: "secret downstream body" }),
    });

    expect(report.status).toBe("failed");
    expect(report.summary).toEqual(
      expect.objectContaining({
        totalRequests: 3,
        successes: 0,
        failures: 3,
        successRatePercent: 0,
      }),
    );
    expect(report.endpoints).toEqual([
      {
        method: "GET",
        path: "/v1/health/readiness",
        requests: 3,
        successes: 0,
        failures: 3,
        statusCodeCounts: { "503": 3 },
        safeErrorCodeCounts: {},
      },
    ]);
    expect(report.findings).toEqual([
      {
        code: "target_load_success_rate_below_budget",
        severity: "blocker",
        safeDetailCode: "target_load_success_rate_below_budget",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
    expect(JSON.stringify(report)).not.toContain("secret downstream body");
  });

  it("maps transport failures to a safe error code", async () => {
    const report = await runTargetEnvironmentLoad({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [{ method: "GET", path: "/v1/health" }],
      requestCount: 2,
      concurrency: 2,
      nowMilliseconds: monotonicClock(5),
      fetch: async () => {
        throw new Error("connect ECONNREFUSED https://api.prod.example with target-secret-api-key");
      },
    });

    expect(report.status).toBe("failed");
    expect(report.endpoints).toEqual([
      {
        method: "GET",
        path: "/v1/health",
        requests: 2,
        successes: 0,
        failures: 2,
        statusCodeCounts: { "0": 2 },
        safeErrorCodeCounts: { target_load_endpoint_unavailable: 2 },
      },
    ]);
    expect(report.findings).toEqual([
      {
        code: "target_load_success_rate_below_budget",
        severity: "blocker",
        safeDetailCode: "target_load_success_rate_below_budget",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
    expect(JSON.stringify(report)).not.toContain("ECONNREFUSED");
  });

  it("fails when p95 latency exceeds the configured budget", async () => {
    const report = await runTargetEnvironmentLoad({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [{ method: "GET", path: "/v1/instances" }],
      requestCount: 3,
      concurrency: 1,
      maxP95LatencyMilliseconds: 1,
      nowMilliseconds: monotonicClock(10),
      fetch: async () => ({ ok: true, status: 200 }),
    });

    expect(report.status).toBe("failed");
    expect(report.summary.p95LatencyMilliseconds).toBeGreaterThan(1);
    expect(report.findings).toEqual([
      {
        code: "target_load_p95_above_budget",
        severity: "blocker",
        safeDetailCode: "target_load_p95_above_budget",
      },
    ]);
  });

  it("writes a sanitized load report artifact when a report path is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-load-report-"));

    try {
      const report = await runTargetEnvironmentLoad({
        baseUrl: "https://api.prod.example",
        apiKey: "target-secret-api-key",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        endpoints: [{ method: "GET", path: "/v1/instances" }],
        requestCount: 1,
        fetch: async () => ({ ok: false, status: 503, body: "secret downstream body" }),
      });
      const reportPath = join(root, "nested", "load-report.json");

      await expect(writeTargetEnvironmentLoadReport(report, reportPath)).resolves.toEqual({
        ok: true,
      });

      const artifact = await readFile(reportPath, "utf8");
      expect(JSON.parse(artifact)).toEqual(report);
      expect(artifact).not.toContain("target-secret-api-key");
      expect(artifact).not.toContain("api.prod.example");
      expect(artifact).not.toContain("secret downstream body");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a safe write failure when the report path cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-load-report-"));

    try {
      const blockedFile = join(root, "existing-file");
      await writeFile(blockedFile, "not a directory", "utf8");

      const result = await writeTargetEnvironmentLoadReport(
        {
          status: "passed",
          checkedAtIso: "2026-07-05T00:00:00.000Z",
          budgets: {},
          summary: {},
          endpoints: [],
          findings: [],
        },
        join(blockedFile, "load-report.json"),
      );

      expect(result).toEqual({
        ok: false,
        safeErrorCode: "target_load_report_write_failed",
      });
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("existing-file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function monotonicClock(stepMilliseconds: number): () => number {
  let current = 0;

  return () => {
    current += stepMilliseconds;
    return current;
  };
}
