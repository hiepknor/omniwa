import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runTargetEnvironmentSmoke,
  writeTargetEnvironmentSmokeReport,
} from "./run-target-environment-smoke.mjs";

describe("target environment smoke runner", () => {
  it("checks approved endpoints with API key auth without exposing secrets", async () => {
    const calls: Array<Readonly<{ url: string; headers: Record<string, string> }>> = [];
    const report = await runTargetEnvironmentSmoke({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
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
    expect(report.endpoints).toEqual([
      expect.objectContaining({ method: "GET", path: "/v1/health", ok: true, statusCode: 200 }),
      expect.objectContaining({
        method: "GET",
        path: "/v1/health/readiness",
        ok: true,
        statusCode: 200,
      }),
      expect.objectContaining({
        method: "GET",
        path: "/v1/instances",
        ok: true,
        statusCode: 200,
      }),
    ]);
    expect(calls).toHaveLength(3);
    expect(calls[0]?.headers["x-api-key"]).toBe("target-secret-api-key");
    expect(calls[0]?.headers["x-request-id"]).toMatch(/^target-env-smoke-get-/u);
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
  });

  it("fails safely when required target environment config is missing", async () => {
    const report = await runTargetEnvironmentSmoke({
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      fetch: async () => ({ ok: true, status: 200 }),
    });

    expect(report).toEqual({
      status: "failed",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
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

  it("marks failed endpoints without serializing response bodies or target urls", async () => {
    const report = await runTargetEnvironmentSmoke({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [{ method: "GET", path: "/v1/health/readiness" }],
      fetch: async () => ({ ok: false, status: 503, body: "secret downstream body" }),
    });

    expect(report.status).toBe("failed");
    expect(report.endpoints).toEqual([
      {
        method: "GET",
        path: "/v1/health/readiness",
        ok: false,
        statusCode: 503,
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
    expect(JSON.stringify(report)).not.toContain("secret downstream body");
  });

  it("maps transport failures to a safe error code", async () => {
    const report = await runTargetEnvironmentSmoke({
      baseUrl: "https://api.prod.example",
      apiKey: "target-secret-api-key",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [{ method: "GET", path: "/v1/health" }],
      fetch: async () => {
        throw new Error("connect ECONNREFUSED https://api.prod.example with target-secret-api-key");
      },
    });

    expect(report).toEqual({
      status: "failed",
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      endpoints: [
        {
          method: "GET",
          path: "/v1/health",
          ok: false,
          statusCode: 0,
          checkedAtIso: "2026-07-05T00:00:00.000Z",
          safeErrorCode: "target_endpoint_unavailable",
        },
      ],
      findings: [],
    });
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
    expect(JSON.stringify(report)).not.toContain("ECONNREFUSED");
  });

  it("writes a sanitized smoke report artifact when a report path is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-smoke-report-"));

    try {
      const report = await runTargetEnvironmentSmoke({
        baseUrl: "https://api.prod.example",
        apiKey: "target-secret-api-key",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        endpoints: [{ method: "GET", path: "/v1/instances" }],
        fetch: async () => ({ ok: false, status: 503, body: "secret downstream body" }),
      });
      const reportPath = join(root, "nested", "smoke-report.json");

      await expect(writeTargetEnvironmentSmokeReport(report, reportPath)).resolves.toEqual({
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
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-smoke-report-"));

    try {
      const blockedFile = join(root, "existing-file");
      await writeFile(blockedFile, "not a directory", "utf8");

      const result = await writeTargetEnvironmentSmokeReport(
        {
          status: "passed",
          checkedAtIso: "2026-07-05T00:00:00.000Z",
          endpoints: [],
          findings: [],
        },
        join(blockedFile, "smoke-report.json"),
      );

      expect(result).toEqual({
        ok: false,
        safeErrorCode: "target_smoke_report_write_failed",
      });
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("existing-file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
