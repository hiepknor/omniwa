#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const defaultRequiredLocalServices = Object.freeze([
  "api",
  "worker",
  "webhook-dispatcher",
  "postgres",
]);

export async function runLocalStackSmokeCheck(options = {}) {
  const config = createLocalStackSmokeConfig(options);
  const checks = [];

  await recordCheck(checks, "compose_services_running", async () => {
    const services = await listRunningComposeServices(config);
    const missingServices = config.requiredServices.filter(
      (service) => !services.includes(service),
    );

    if (missingServices.length > 0) {
      throw new Error(`Missing running services: ${missingServices.join(", ")}`);
    }

    return { services };
  });

  const healthResult = await recordCheck(checks, "api_health_envelope", async () => {
    const response = await requestJson(config, "/v1/health", {
      method: "GET",
      headers: authenticatedHeaders(config),
    });

    assertEnvelope(response, "health response");

    if (response.data?.resourceType !== "health") {
      throw new Error("Health response data.resourceType must be health.");
    }

    return {
      requestId: response.meta.requestId,
      resourceType: response.data.resourceType,
    };
  });

  const createdInstance = await recordCheck(checks, "create_instance_command", async () => {
    const response = await requestJson(config, "/v1/instances", {
      method: "POST",
      headers: {
        ...authenticatedHeaders(config),
        "content-type": "application/json",
        "idempotency-key": config.idempotencyKey,
      },
      body: "{}",
    });

    assertEnvelope(response, "create instance response");

    const resultRef = response.data?.resultRef;
    if (typeof resultRef !== "string" || !resultRef.startsWith("inst:")) {
      throw new Error("Create instance response must include an inst:* resultRef.");
    }

    return {
      requestId: response.meta.requestId,
      resultRef,
    };
  });

  await recordCheck(checks, "postgres_instance_persisted", async () => {
    const resultRef = createdInstance.details?.resultRef;
    if (typeof resultRef !== "string" || resultRef.length === 0) {
      throw new Error("Create instance check did not produce a resultRef.");
    }

    const status = await readInstanceStatusFromPostgres(config, resultRef);

    if (status.length === 0) {
      throw new Error(`Instance ${resultRef} was not found in PostgreSQL.`);
    }

    return {
      instanceId: resultRef,
      status,
    };
  });

  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";

  return Object.freeze({
    status,
    apiBaseUrl: config.apiBaseUrl,
    composeFile: config.composeFile,
    checkedAtEpochMilliseconds: config.checkedAtEpochMilliseconds,
    checks: Object.freeze(checks.map((check) => Object.freeze(check))),
    healthRequestId: healthResult.details?.requestId,
    createdInstanceRef: createdInstance.details?.resultRef,
  });
}

export function createLocalStackSmokeConfig(options = {}) {
  const now = options.now ?? Date.now;
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Number(now());
  const defaultApiPort = process.env.OMNIWA_API_PUBLIC_PORT ?? "3000";

  return Object.freeze({
    apiBaseUrl:
      options.apiBaseUrl ??
      process.env.OMNIWA_LOCAL_STACK_API_URL ??
      `http://localhost:${defaultApiPort}`,
    apiKey: options.apiKey ?? process.env.OMNIWA_API_KEY ?? "local-dev-secret-change-me",
    checkedAtEpochMilliseconds,
    commandRunner: options.commandRunner ?? runCommand,
    composeFile: options.composeFile ?? "deploy/docker/compose.local.yml",
    fetcher: options.fetcher ?? globalThis.fetch,
    idempotencyKey: options.idempotencyKey ?? `local-stack-smoke-${checkedAtEpochMilliseconds}`,
    requiredServices: options.requiredServices ?? defaultRequiredLocalServices,
  });
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
      error: error instanceof Error ? error.message : String(error),
    });
    checks.push(result);
    return result;
  }
}

async function listRunningComposeServices(config) {
  const result = await config.commandRunner("docker", [
    "compose",
    "-f",
    config.composeFile,
    "ps",
    "--services",
    "--filter",
    "status=running",
  ]);

  return result.stdout
    .split(/\s+/u)
    .map((service) => service.trim())
    .filter(Boolean);
}

async function readInstanceStatusFromPostgres(config, instanceId) {
  const sql = `select status from omniwa_instances where id = ${sqlString(instanceId)} limit 1;`;
  const result = await config.commandRunner("docker", [
    "compose",
    "-f",
    config.composeFile,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "omniwa",
    "-d",
    "omniwa",
    "-At",
    "-c",
    sql,
  ]);

  return result.stdout.trim();
}

async function requestJson(config, path, init) {
  if (typeof config.fetcher !== "function") {
    throw new Error("Global fetch is unavailable. Use Node.js 22+ or inject a fetcher.");
  }

  const response = await config.fetcher(new URL(path, config.apiBaseUrl), init);
  const text = await response.text();
  const json = parseJson(text, path);

  if (!response.ok) {
    const code = json.error?.code ?? "http_request_failed";
    const message = json.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${path} failed with ${code}: ${message}`);
  }

  return json;
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return valid JSON.`);
  }
}

function authenticatedHeaders(config) {
  return {
    "x-api-key": config.apiKey,
  };
}

function assertEnvelope(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  if (!("data" in value)) {
    throw new Error(`${label} must include data.`);
  }

  if (!isRecord(value.meta)) {
    throw new Error(`${label} must include meta.`);
  }

  if (typeof value.meta.requestId !== "string" || value.meta.requestId.length === 0) {
    throw new Error(`${label} meta.requestId is required.`);
  }

  if (typeof value.meta.timestamp !== "string" || value.meta.timestamp.length === 0) {
    throw new Error(`${label} meta.timestamp is required.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runCommand(command, args) {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function printReport(report) {
  for (const check of report.checks) {
    if (check.status === "passed") {
      console.log(`PASS ${check.name}`);
    } else {
      console.error(`FAIL ${check.name}: ${check.error}`);
    }
  }

  if (report.status === "passed") {
    console.log(
      `Local Docker stack smoke check passed for ${report.apiBaseUrl}; created ${report.createdInstanceRef}.`,
    );
    return;
  }

  console.error(`Local Docker stack smoke check failed for ${report.apiBaseUrl}.`);
}

async function main() {
  const report = await runLocalStackSmokeCheck();
  printReport(report);

  if (report.status !== "passed") {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
