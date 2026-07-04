#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const defaultClientContractPath = "docs/api/client-contract/omniwa-tui-capabilities.json";
export const defaultOpenApiPath = "docs/api/openapi/omniwa-v1.openapi.json";

export const implementedPublicEndpointAllowList = Object.freeze([
  "GET /v1/health",
  "GET /v1/health/readiness",
  "GET /v1/instances",
  "GET /v1/instances/{instanceId}",
  "GET /v1/instances/{instanceId}/sessions",
  "GET /v1/instances/{instanceId}/messages",
  "POST /v1/instances",
  "GET /v1/messages/{messageId}",
  "GET /v1/events",
  "GET /v1/events/stream",
  "GET /v1/queue",
  "GET /v1/jobs",
  "GET /v1/jobs/{jobId}",
  "GET /v1/instances/{instanceId}/chats",
  "GET /v1/chats/{chatId}",
  "GET /v1/instances/{instanceId}/contacts",
  "GET /v1/contacts/{contactId}",
  "GET /v1/instances/{instanceId}/groups",
  "GET /v1/groups/{groupId}",
  "GET /v1/groups/{groupId}/members",
  "GET /v1/webhooks",
  "GET /v1/webhooks/{webhookId}",
  "GET /v1/webhook-deliveries",
  "GET /v1/webhook-deliveries/{deliveryId}/history",
]);

export async function evaluateClientContractReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const contractPath = options.contractPath ?? defaultClientContractPath;
  const openApiPath = options.openApiPath ?? defaultOpenApiPath;
  const findings = [];
  const contract = await readJson(join(projectRoot, contractPath), findings, "client_contract");
  const openApi = await readJson(join(projectRoot, openApiPath), findings, "openapi_contract");

  if (contract !== undefined) {
    checkContractShape(contract, findings);
  }

  if (contract !== undefined && openApi !== undefined) {
    await checkEndpointDeclarations(projectRoot, contract, openApi, findings);
    await checkFixtures(projectRoot, contract, findings);
  }

  return Object.freeze({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    findings: Object.freeze(findings),
  });
}

export async function createClientContractFixture(projectRoot, overrides = {}) {
  const contract = {
    client: "omniwa-tui",
    contractVersion: "0.1.0",
    apiVersion: "v1",
    statusEnum: [
      "implemented_public",
      "route_exists_not_implemented",
      "internal_only",
      "missing",
      "deprecated",
      "unknown",
    ],
    runtime: {
      basePath: "/v1",
      auth: { header: "x-api-key" },
    },
    resources: {
      health: {
        status: "implemented_public",
        recommendedForTui: true,
      },
    },
    endpoints: [
      {
        feature: "health",
        method: "GET",
        path: "/v1/health",
        status: "implemented_public",
        authRequired: true,
      },
    ],
    fixtures: {
      healthSuccess: "docs/api/client-contract/fixtures/health.success.json",
      sseHeartbeat: "docs/api/client-contract/fixtures/events-stream.heartbeat.sse",
    },
    ...overrides,
  };
  const openApi = {
    openapi: "3.1.0",
    paths: openApiPathsForEndpoints(contract.endpoints),
  };

  await writeJson(join(projectRoot, defaultClientContractPath), contract);
  await writeJson(join(projectRoot, defaultOpenApiPath), openApi);
  for (const relativePath of Object.values(contract.fixtures)) {
    if (typeof relativePath !== "string") {
      continue;
    }

    if (relativePath.endsWith(".json")) {
      await writeJson(join(projectRoot, relativePath), {
        data: {},
        meta: {
          requestId: "req_fixture",
          correlationId: "corr_fixture",
          timestamp: "2026-07-02T00:00:00.000Z",
        },
      });
      continue;
    }

    if (relativePath.endsWith(".sse")) {
      await writeText(
        join(projectRoot, relativePath),
        ": omniwa-stream requestId=req_fixture correlationId=corr_fixture timestamp=2026-07-02T00:00:00.000Z\n\n: heartbeat\n",
      );
    }
  }
}

function openApiPathsForEndpoints(endpoints) {
  const paths = {};

  for (const endpoint of endpoints) {
    if (
      endpoint.status !== "implemented_public" &&
      endpoint.status !== "route_exists_not_implemented"
    ) {
      continue;
    }

    const method = endpoint.method.toLowerCase();
    paths[endpoint.path] = {
      ...(paths[endpoint.path] ?? {}),
      [method]: {
        operationId: `${method}${endpoint.path.replaceAll(/[^A-Za-z0-9]/gu, "_")}`,
      },
    };
  }

  return paths;
}

function checkContractShape(contract, findings) {
  if (!isRecord(contract)) {
    findings.push(createFinding("client_contract_must_be_object", "blocker"));
    return;
  }

  if (contract.client !== "omniwa-tui") {
    findings.push(createFinding("client_contract_client_must_be_omniwa_tui", "blocker"));
  }

  if (contract.apiVersion !== "v1") {
    findings.push(createFinding("client_contract_api_version_must_be_v1", "blocker"));
  }

  if (contract.runtime?.auth?.header !== "x-api-key") {
    findings.push(createFinding("client_contract_auth_header_must_be_x_api_key", "blocker"));
  }

  if (!Array.isArray(contract.statusEnum)) {
    findings.push(createFinding("client_contract_status_enum_missing", "blocker"));
  }

  if (!isRecord(contract.resources)) {
    findings.push(createFinding("client_contract_resources_missing", "blocker"));
  }

  if (!Array.isArray(contract.endpoints) || contract.endpoints.length === 0) {
    findings.push(createFinding("client_contract_endpoints_missing", "blocker"));
  }

  if (!isRecord(contract.fixtures)) {
    findings.push(createFinding("client_contract_fixtures_missing", "blocker"));
  }
}

async function checkEndpointDeclarations(projectRoot, contract, openApi, findings) {
  const statusValues = new Set(contract.statusEnum);
  const requiredImplementedEndpoints = new Set(implementedPublicEndpointAllowList);
  const declaredImplementedEndpoints = new Set();

  for (const [resourceName, resource] of Object.entries(contract.resources ?? {})) {
    if (!isRecord(resource)) {
      findings.push(
        createFinding("client_contract_resource_must_be_object", "blocker", resourceName),
      );
      continue;
    }

    if (!statusValues.has(resource.status)) {
      findings.push(
        createFinding("client_contract_resource_status_invalid", "blocker", resourceName),
      );
    }

    if (typeof resource.recommendedForTui !== "boolean") {
      findings.push(
        createFinding("client_contract_resource_recommendation_missing", "blocker", resourceName),
      );
    }
  }

  for (const endpoint of contract.endpoints ?? []) {
    if (!isRecord(endpoint)) {
      findings.push(createFinding("client_contract_endpoint_must_be_object", "blocker"));
      continue;
    }

    const key = endpointKey(endpoint);
    if (key === undefined) {
      findings.push(createFinding("client_contract_endpoint_identity_invalid", "blocker"));
      continue;
    }

    if (!statusValues.has(endpoint.status)) {
      findings.push(createFinding("client_contract_endpoint_status_invalid", "blocker", key));
      continue;
    }

    if (typeof endpoint.authRequired !== "boolean") {
      findings.push(
        createFinding("client_contract_endpoint_auth_required_missing", "blocker", key),
      );
    }

    if (endpoint.status === "implemented_public") {
      declaredImplementedEndpoints.add(key);

      if (!requiredImplementedEndpoints.has(key)) {
        findings.push(
          createFinding("client_contract_implemented_endpoint_not_allowed", "blocker", key),
        );
      }
    }

    if (
      endpoint.status === "implemented_public" ||
      endpoint.status === "route_exists_not_implemented"
    ) {
      if (!openApiOperationExists(openApi, endpoint.method, endpoint.path)) {
        findings.push(
          createFinding("client_contract_endpoint_missing_from_openapi", "blocker", key),
        );
      }
    }

    if (
      endpoint.status === "missing" &&
      openApiOperationExists(openApi, endpoint.method, endpoint.path)
    ) {
      findings.push(
        createFinding("client_contract_missing_endpoint_exists_in_openapi", "blocker", key),
      );
    }
  }

  for (const requiredEndpoint of requiredImplementedEndpoints) {
    if (!declaredImplementedEndpoints.has(requiredEndpoint)) {
      findings.push(
        createFinding(
          "client_contract_required_implemented_endpoint_missing",
          "blocker",
          requiredEndpoint,
        ),
      );
    }
  }

  await checkRequiredFixtureFiles(projectRoot, contract, findings);
}

async function checkFixtures(projectRoot, contract, findings) {
  for (const [fixtureName, relativePath] of Object.entries(contract.fixtures ?? {})) {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      findings.push(createFinding("client_contract_fixture_path_invalid", "blocker", fixtureName));
      continue;
    }

    if (relativePath.endsWith(".json")) {
      const fixture = await readJson(
        join(projectRoot, relativePath),
        findings,
        "client_fixture",
        fixtureName,
      );
      if (fixture !== undefined && !isEnvelope(fixture)) {
        findings.push(
          createFinding("client_contract_fixture_not_envelope", "blocker", fixtureName),
        );
      }
      continue;
    }

    if (relativePath.endsWith(".sse")) {
      const text = await readText(
        join(projectRoot, relativePath),
        findings,
        "client_fixture",
        fixtureName,
      );
      if (
        text !== undefined &&
        (!text.includes(": omniwa-stream") || !text.includes(": heartbeat"))
      ) {
        findings.push(createFinding("client_contract_sse_fixture_invalid", "blocker", fixtureName));
      }
    }
  }
}

async function checkRequiredFixtureFiles(projectRoot, contract, findings) {
  const requiredFixtures = [
    "healthSuccess",
    "authMissingError",
    "instancesEmpty",
    "instancesList",
    "messagesList",
    "messageDetail",
    "chatsList",
    "chatDetail",
    "contactsList",
    "contactDetail",
    "groupsList",
    "groupDetail",
    "groupMembersList",
    "queueSummary",
    "sseHeartbeat",
  ];

  for (const fixtureName of requiredFixtures) {
    const relativePath = contract.fixtures?.[fixtureName];
    if (typeof relativePath !== "string") {
      findings.push(
        createFinding("client_contract_required_fixture_missing", "blocker", fixtureName),
      );
      continue;
    }

    try {
      await access(join(projectRoot, relativePath));
    } catch {
      findings.push(createFinding("client_contract_fixture_file_missing", "blocker", fixtureName));
    }
  }
}

function openApiOperationExists(openApi, method, path) {
  if (!isRecord(openApi.paths?.[path])) {
    return false;
  }

  return isRecord(openApi.paths[path][method.toLowerCase()]);
}

function endpointKey(endpoint) {
  if (typeof endpoint.method !== "string" || typeof endpoint.path !== "string") {
    return undefined;
  }

  return `${endpoint.method.toUpperCase()} ${endpoint.path}`;
}

function isEnvelope(value) {
  if (!isRecord(value) || !isRecord(value.meta)) {
    return false;
  }

  const hasSuccess = Object.prototype.hasOwnProperty.call(value, "data");
  const hasError = isRecord(value.error);

  return hasSuccess !== hasError;
}

async function readJson(path, findings, category, target = path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    findings.push(createFinding(`${category}_unreadable`, "blocker", target));
    return undefined;
  }
}

async function readText(path, findings, category, target = path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    findings.push(createFinding(`${category}_unreadable`, "blocker", target));
    return undefined;
  }
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

function createFinding(code, severity, target) {
  return Object.freeze({
    code,
    severity,
    ...(typeof target === "string" ? { target } : {}),
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  const report = await evaluateClientContractReadiness();

  if (report.status === "passed") {
    console.log("Client contract check passed.");
    return;
  }

  console.error("Client contract check failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
