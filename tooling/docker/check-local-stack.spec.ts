import { describe, expect, it } from "vitest";

import { createLocalStackSmokeConfig, runLocalStackSmokeCheck } from "./check-local-stack.mjs";

describe("local Docker stack smoke check", () => {
  it("passes when compose services, API envelope, and PostgreSQL persistence are valid", async () => {
    const report = await runLocalStackSmokeCheck({
      apiBaseUrl: "http://localhost:3000",
      apiKey: "test-key",
      checkedAtEpochMilliseconds: 1_800_000_000_000,
      commandRunner: successfulCommandRunner,
      fetcher: successfulFetcher,
      idempotencyKey: "test-idempotency-key",
    });

    expect(report).toMatchObject({
      status: "passed",
      apiBaseUrl: "http://localhost:3000",
      checkedAtEpochMilliseconds: 1_800_000_000_000,
      healthRequestId: "req-health",
      createdInstanceRef: "inst:test-instance",
    });
    expect(report.checks.map((check) => check.name)).toEqual([
      "compose_services_running",
      "api_health_envelope",
      "create_instance_command",
      "postgres_instance_persisted",
    ]);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("fails when a required runtime service is not running", async () => {
    const report = await runLocalStackSmokeCheck({
      commandRunner: async (command: string, args: string[]) => {
        if (isComposeServicesCommand(command, args)) {
          return { stdout: "api\npostgres\n", stderr: "" };
        }

        return successfulCommandRunner(command, args);
      },
      fetcher: successfulFetcher,
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "compose_services_running",
          status: "failed",
          error: "Missing running services: worker, webhook-dispatcher",
        }),
      ]),
    );
  });

  it("fails when the health route does not return the public response envelope", async () => {
    const report = await runLocalStackSmokeCheck({
      commandRunner: successfulCommandRunner,
      fetcher: async (url: URL | RequestInfo, init?: RequestInit) => {
        if (String(url).endsWith("/v1/health")) {
          return jsonResponse({ ok: true }, 200);
        }

        return successfulFetcher(url, init);
      },
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "api_health_envelope",
          status: "failed",
          error: "health response must include data.",
        }),
      ]),
    );
  });

  it("builds defaults from local stack environment variables", () => {
    const config = createLocalStackSmokeConfig({
      now: () => 1_800_000_000_000,
    });

    expect(config.composeFile).toBe("deploy/docker/compose.local.yml");
    expect(config.idempotencyKey).toBe("local-stack-smoke-1800000000000");
    expect(config.requiredServices).toEqual(["api", "worker", "webhook-dispatcher", "postgres"]);
  });
});

async function successfulCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  if (isComposeServicesCommand(command, args)) {
    return { stdout: "api\nworker\nwebhook-dispatcher\npostgres\n", stderr: "" };
  }

  if (isPostgresLookupCommand(command, args)) {
    return { stdout: "created\n", stderr: "" };
  }

  throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
}

async function successfulFetcher(url: URL | RequestInfo, init?: RequestInit): Promise<Response> {
  const path = new URL(String(url)).pathname;

  if (init?.headers === undefined) {
    throw new Error("Expected authenticated headers.");
  }

  if (path === "/v1/health") {
    return jsonResponse({
      data: {
        resourceType: "health",
      },
      meta: {
        requestId: "req-health",
        timestamp: "2026-07-02T00:00:00.000Z",
      },
    });
  }

  if (path === "/v1/instances") {
    return jsonResponse({
      data: {
        resultRef: "inst:test-instance",
      },
      meta: {
        requestId: "req-create",
        timestamp: "2026-07-02T00:00:00.000Z",
      },
    });
  }

  throw new Error(`Unexpected URL: ${String(url)}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function isComposeServicesCommand(command: string, args: string[]): boolean {
  return command === "docker" && args.includes("ps") && args.includes("--services");
}

function isPostgresLookupCommand(command: string, args: string[]): boolean {
  return command === "docker" && args.includes("postgres") && args.includes("psql");
}
