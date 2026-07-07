#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const defaultProductionComposeFile = "deploy/docker/compose.production.yml";
export const defaultProductionEnvFile = "deploy/docker/env/production.env.example";

export const requiredProductionComposeServices = Object.freeze([
  "api",
  "worker",
  "webhook-dispatcher",
  "provider-runtime",
  "background",
  "postgres",
  "redis",
]);

export async function runProductionComposeTemplateCheck(options = {}) {
  const config = createProductionComposeTemplateConfig(options);
  const checks = [];
  let renderedConfig = "";

  await recordCheck(checks, "compose_config_renders", async () => {
    const result = await renderProductionComposeConfig(config);
    renderedConfig = result.stdout;

    if (renderedConfig.trim().length === 0) {
      throw new Error("Production compose rendered an empty config.");
    }

    return {
      composeFile: config.composeFile,
      envFile: config.envFile,
    };
  });

  await recordCheck(checks, "required_services_declared", async () => {
    const missingServices = config.requiredServices.filter(
      (service) => !hasRenderedService(renderedConfig, service),
    );

    if (missingServices.length > 0) {
      throw new Error(`Missing production services: ${missingServices.join(", ")}`);
    }

    return {
      services: config.requiredServices,
    };
  });

  await recordCheck(checks, "api_production_profile_declared", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_API_RUNTIME_PROFILE", ["production"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_API_REPOSITORY_PROFILE", ["postgresql"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_API_QUEUE_PROFILE", ["durable-worker-job"]);

    return {
      runtimeProfile: "production",
      repositoryProfile: "postgresql",
      queueProfile: "durable-worker-job",
    };
  });

  await recordCheck(checks, "plaintext_api_key_not_declared", async () => {
    if (/^\s*OMNIWA_API_KEY\s*:/mu.test(renderedConfig)) {
      throw new Error("Production compose must not declare plaintext OMNIWA_API_KEY.");
    }

    assertRenderedAssignment(renderedConfig, "OMNIWA_API_KEY_HASH", /^sha256:/u);

    return {
      apiKeyMaterial: "hash-only",
    };
  });

  await recordCheck(checks, "redis_rate_limit_declared", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_API_RATE_LIMIT_BACKEND", ["redis"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_API_RATE_LIMIT_REDIS_URL", /^redis:\/\//u);

    return {
      rateLimitBackend: "redis",
    };
  });

  await recordCheck(checks, "postgresql_eventlog_declared", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_EVENT_LOG_BACKEND", ["postgresql"]);

    return {
      eventLogBackend: "postgresql",
    };
  });

  await recordCheck(checks, "background_event_outbox_declared", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_BACKGROUND_RUNTIME_PROFILE", ["production"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_BACKGROUND_EVENT_LOG_BACKEND", ["postgresql"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_EVENT_OUTBOX_PUBLISHER_JSONL_PATH", /.+/u);
    assertRenderedAssignment(renderedConfig, "OMNIWA_EVENT_OUTBOX_METRICS_JSONL_PATH", /.+/u);

    return {
      runtimeProfile: "production",
      eventLogBackend: "postgresql",
      outboxPublisher: "jsonl",
      metrics: "jsonl",
    };
  });

  await recordCheck(checks, "postgres_auto_migrate_disabled", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_POSTGRES_AUTO_MIGRATE", ["false"]);

    return {
      autoMigrate: "false",
    };
  });

  await recordCheck(checks, "provider_bridge_production_declared", async () => {
    assertRenderedAssignment(renderedConfig, "OMNIWA_WORKER_RUNTIME_PROFILE", ["production"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_WORKER_REPOSITORY_PROFILE", ["postgresql"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_WORKER_QUEUE_PROFILE", ["durable-worker-job"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_WORKER_PROVIDER_MODE", [
      "provider-runtime-bridge",
    ]);
    assertRenderedAssignment(
      renderedConfig,
      "OMNIWA_PROVIDER_COMMAND_BRIDGE_URL",
      /^http:\/\/provider-runtime:3011\/internal\/provider-command\/v1\/commands$/u,
    );
    assertRenderedAssignmentCount(renderedConfig, "OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN", 3);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_COMMAND_BRIDGE_TOKEN", /.+/u);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_COMMAND_BRIDGE_HTTP", ["true"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_COMMAND_BRIDGE_HOST", ["0.0.0.0"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_COMMAND_BRIDGE_PORT", ["3011"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_RUNTIME_PROFILE", ["production"]);
    assertRenderedAssignment(renderedConfig, "OMNIWA_PROVIDER_RUNTIME_OWNER_REF", /.+/u);
    assertRenderedAssignmentCount(renderedConfig, "OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH", 3);
    assertRenderedAssignment(
      renderedConfig,
      "OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH",
      /^\/var\/lib\/omniwa\/outbound-message-intents\.secret\.json$/u,
    );

    return {
      workerRuntimeProfile: "production",
      workerRepositoryProfile: "postgresql",
      workerQueueProfile: "durable-worker-job",
      workerProviderMode: "provider-runtime-bridge",
      bridgeEndpoint: "provider-runtime:3011",
      providerRuntimeProfile: "production",
      outboundIntentStore: "shared-durable-json",
    };
  });

  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";

  return Object.freeze({
    status,
    composeFile: config.composeFile,
    envFile: config.envFile,
    checkedAtEpochMilliseconds: config.checkedAtEpochMilliseconds,
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
  });
}

export function createProductionComposeTemplateConfig(options = {}) {
  const now = options.now ?? Date.now;

  return Object.freeze({
    checkedAtEpochMilliseconds: options.checkedAtEpochMilliseconds ?? Number(now()),
    commandRunner: options.commandRunner ?? runCommand,
    composeFile: options.composeFile ?? defaultProductionComposeFile,
    envFile: options.envFile ?? defaultProductionEnvFile,
    requiredServices: options.requiredServices ?? requiredProductionComposeServices,
  });
}

async function renderProductionComposeConfig(config) {
  return config.commandRunner("docker", [
    "compose",
    "--env-file",
    config.envFile,
    "-f",
    config.composeFile,
    "config",
  ]);
}

async function recordCheck(checks, name, check) {
  try {
    const details = await check();
    const result = Object.freeze({
      name,
      status: "passed",
      details: details ?? {},
    });
    checks.push(result);
    return result;
  } catch (error) {
    const result = Object.freeze({
      name,
      status: "failed",
      error: safeErrorMessage(error),
    });
    checks.push(result);
    return result;
  }
}

function hasRenderedService(renderedConfig, service) {
  return new RegExp(`^\\s{2}${escapeRegExp(service)}:\\s*$`, "mu").test(renderedConfig);
}

function assertRenderedAssignment(renderedConfig, name, expected) {
  const match = renderedConfig.match(new RegExp(`^\\s*${escapeRegExp(name)}:\\s*(.+?)\\s*$`, "mu"));

  if (match === null) {
    throw new Error(`Missing rendered assignment for ${name}.`);
  }

  const value = unquote(match[1].trim());
  const isExpected =
    expected instanceof RegExp
      ? expected.test(value)
      : expected.some((allowed) => value === allowed);

  if (!isExpected) {
    throw new Error(`Unexpected rendered assignment for ${name}.`);
  }
}

function assertRenderedAssignmentCount(renderedConfig, name, expectedCount) {
  const matches = renderedConfig.match(
    new RegExp(`^\\s*${escapeRegExp(name)}:\\s*(.+?)\\s*$`, "gmu"),
  );
  const count = matches?.length ?? 0;

  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} rendered assignments for ${name}, found ${count}.`);
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function safeErrorMessage(error) {
  if (!(error instanceof Error)) {
    return "Production compose check failed.";
  }

  return sanitizeErrorText(error.message);
}

function sanitizeErrorText(value) {
  return value
    .replace(/postgresql:\/\/[^\s"']+/gu, "postgresql://[redacted]")
    .replace(/redis:\/\/[^\s"']+/gu, "redis://[redacted]")
    .replace(/sha256:[A-Fa-f0-9-]+/gu, "sha256:[redacted]");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function runCommand(command, args) {
  return execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 10,
  });
}

async function main() {
  const report = await runProductionComposeTemplateCheck();

  if (report.status === "passed") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.error("Production compose template gate failed:");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
