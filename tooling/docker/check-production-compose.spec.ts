import { describe, expect, it } from "vitest";

import {
  createProductionComposeTemplateConfig,
  runProductionComposeTemplateCheck,
} from "./check-production-compose.mjs";

describe("production Docker compose template check", () => {
  it("passes when the rendered production compose template preserves required runtime invariants", async () => {
    const report = await runProductionComposeTemplateCheck({
      checkedAtEpochMilliseconds: 1_800_000_000_000,
      commandRunner: successfulCommandRunner,
    });

    expect(report).toMatchObject({
      status: "passed",
      composeFile: "deploy/docker/compose.production.yml",
      envFile: "deploy/docker/env/production.env.example",
      checkedAtEpochMilliseconds: 1_800_000_000_000,
    });
    expect(report.checks.map((check) => check.name)).toEqual([
      "compose_config_renders",
      "required_services_declared",
      "api_production_profile_declared",
      "plaintext_api_key_not_declared",
      "redis_rate_limit_declared",
      "postgresql_eventlog_declared",
      "postgres_auto_migrate_disabled",
      "controlled_pilot_profiles_declared",
    ]);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("fails when a required runtime service is missing", async () => {
    const report = await runProductionComposeTemplateCheck({
      commandRunner: async () => ({
        stdout: renderedProductionComposeConfig().replace(/^\s{2}worker:\n(?:\s{4}.+\n)+/mu, ""),
        stderr: "",
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "required_services_declared",
          status: "failed",
          error: "Missing production services: worker",
        }),
      ]),
    );
  });

  it("fails when plaintext API key configuration is rendered", async () => {
    const report = await runProductionComposeTemplateCheck({
      commandRunner: async () => ({
        stdout: renderedProductionComposeConfig().replace(
          "      OMNIWA_API_KEY_HASH: sha256:replace-with-api-key-sha256-hex",
          [
            "      OMNIWA_API_KEY: unsafe-plaintext-key",
            "      OMNIWA_API_KEY_HASH: sha256:replace-with-api-key-sha256-hex",
          ].join("\n"),
        ),
        stderr: "",
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "plaintext_api_key_not_declared",
          status: "failed",
          error: "Production compose must not declare plaintext OMNIWA_API_KEY.",
        }),
      ]),
    );
  });

  it("fails safely without leaking rendered secret URLs when command execution fails", async () => {
    const report = await runProductionComposeTemplateCheck({
      commandRunner: async () => {
        throw new Error(
          "failed with postgresql://omniwa:secret@postgres:5432/omniwa and redis://:secret@redis:6379/0",
        );
      },
    });

    expect(report.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("secret@");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "compose_config_renders",
          status: "failed",
          error: "failed with postgresql://[redacted] and redis://[redacted]",
        }),
      ]),
    );
  });

  it("fails when PostgreSQL EventLog backend is not declared for the API runtime", async () => {
    const report = await runProductionComposeTemplateCheck({
      commandRunner: async () => ({
        stdout: renderedProductionComposeConfig().replace(
          "      OMNIWA_EVENT_LOG_BACKEND: postgresql\n",
          "",
        ),
        stderr: "",
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "postgresql_eventlog_declared",
          status: "failed",
          error: "Missing rendered assignment for OMNIWA_EVENT_LOG_BACKEND.",
        }),
      ]),
    );
  });

  it("builds defaults from the checked-in production template paths", () => {
    const config = createProductionComposeTemplateConfig({
      now: () => 1_800_000_000_000,
    });

    expect(config.composeFile).toBe("deploy/docker/compose.production.yml");
    expect(config.envFile).toBe("deploy/docker/env/production.env.example");
    expect(config.requiredServices).toEqual([
      "api",
      "worker",
      "webhook-dispatcher",
      "provider-runtime",
      "postgres",
      "redis",
    ]);
    expect(config.checkedAtEpochMilliseconds).toBe(1_800_000_000_000);
  });
});

async function successfulCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  expect(command).toBe("docker");
  expect(args).toEqual([
    "compose",
    "--env-file",
    "deploy/docker/env/production.env.example",
    "-f",
    "deploy/docker/compose.production.yml",
    "config",
  ]);

  return {
    stdout: renderedProductionComposeConfig(),
    stderr: "",
  };
}

function renderedProductionComposeConfig(): string {
  return [
    "name: omniwa-production",
    "services:",
    "  api:",
    "    environment:",
    "      OMNIWA_API_RUNTIME_PROFILE: production",
    "      OMNIWA_API_REPOSITORY_PROFILE: postgresql",
    "      OMNIWA_API_QUEUE_PROFILE: durable-worker-job",
    "      OMNIWA_EVENT_LOG_BACKEND: postgresql",
    "      OMNIWA_API_KEY_HASH: sha256:replace-with-api-key-sha256-hex",
    "      OMNIWA_API_RATE_LIMIT_BACKEND: redis",
    "      OMNIWA_API_RATE_LIMIT_REDIS_URL: redis://:replace-with-redis-secret@redis:6379/0",
    '      OMNIWA_POSTGRES_AUTO_MIGRATE: "false"',
    "  worker:",
    "    environment:",
    "      OMNIWA_WORKER_RUNTIME_PROFILE: local",
    "      OMNIWA_WORKER_PROVIDER_MODE: multi-process-unsupported",
    "  webhook-dispatcher:",
    "    environment:",
    "      OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE: production",
    "  provider-runtime:",
    "    environment:",
    "      OMNIWA_PROVIDER_RUNTIME_PROFILE: local",
    "  postgres:",
    "    image: postgres:17-alpine",
    "  redis:",
    "    image: redis:7-alpine",
    "",
  ].join("\n");
}
