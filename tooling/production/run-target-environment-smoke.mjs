import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const targetEnvironmentSmokeEndpoints = Object.freeze([
  Object.freeze({ method: "GET", path: "/v1/health" }),
  Object.freeze({ method: "GET", path: "/v1/health/readiness" }),
  Object.freeze({ method: "GET", path: "/v1/instances" }),
]);

export async function runTargetEnvironmentSmoke(options = {}) {
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpoints = options.endpoints ?? targetEnvironmentSmokeEndpoints;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
  const findings = [];

  const baseUrl = readRequiredOption(options.baseUrl, "target_base_url_missing", findings);
  const apiKey = readRequiredOption(options.apiKey, "target_api_key_missing", findings);

  if (typeof fetcher !== "function") {
    findings.push(createFinding("target_fetch_unavailable", "blocker"));
  }

  let parsedBaseUrl;

  if (baseUrl !== undefined) {
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      findings.push(createFinding("target_base_url_invalid", "blocker"));
    }
  }

  if (findings.length > 0 || parsedBaseUrl === undefined || apiKey === undefined) {
    return freezeReport({
      status: "failed",
      checkedAtIso,
      endpoints: [],
      findings,
    });
  }

  const endpointResults = [];

  for (const endpoint of endpoints) {
    endpointResults.push(
      await smokeEndpoint({
        endpoint,
        baseUrl: parsedBaseUrl,
        apiKey,
        fetcher,
        timeoutMilliseconds,
        checkedAtIso,
      }),
    );
  }

  return freezeReport({
    status: endpointResults.every((result) => result.ok) ? "passed" : "failed",
    checkedAtIso,
    endpoints: endpointResults,
    findings,
  });
}

async function smokeEndpoint(input) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMilliseconds);
  const requestId = requestIdForEndpoint(input.endpoint);
  const correlationId = "target-env-smoke";

  try {
    const response = await input.fetcher(new URL(input.endpoint.path, input.baseUrl), {
      method: input.endpoint.method,
      headers: {
        "x-api-key": input.apiKey,
        "x-request-id": requestId,
        "x-correlation-id": correlationId,
      },
      signal: controller.signal,
    });
    const statusCode = typeof response.status === "number" ? response.status : 0;

    if (response.ok) {
      const envelopeValidation = await validateSuccessEnvelope(response, {
        requestId,
        correlationId,
      });

      if (!envelopeValidation.ok) {
        return Object.freeze({
          method: input.endpoint.method,
          path: input.endpoint.path,
          ok: false,
          statusCode,
          checkedAtIso: input.checkedAtIso,
          safeErrorCode: envelopeValidation.safeErrorCode,
        });
      }
    }

    return Object.freeze({
      method: input.endpoint.method,
      path: input.endpoint.path,
      ok: Boolean(response.ok),
      statusCode,
      checkedAtIso: input.checkedAtIso,
    });
  } catch {
    return Object.freeze({
      method: input.endpoint.method,
      path: input.endpoint.path,
      ok: false,
      statusCode: 0,
      checkedAtIso: input.checkedAtIso,
      safeErrorCode: "target_endpoint_unavailable",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateSuccessEnvelope(response, expectedMeta) {
  if (typeof response.json !== "function") {
    return Object.freeze({ ok: false, safeErrorCode: "target_response_envelope_unreadable" });
  }

  let body;

  try {
    body = await response.json();
  } catch {
    return Object.freeze({ ok: false, safeErrorCode: "target_response_envelope_unreadable" });
  }

  if (!isRecord(body) || !("data" in body) || !isRecord(body.meta)) {
    return Object.freeze({ ok: false, safeErrorCode: "target_response_envelope_invalid" });
  }

  if (
    body.meta.requestId !== expectedMeta.requestId ||
    body.meta.correlationId !== expectedMeta.correlationId ||
    !isNonEmptyString(body.meta.timestamp)
  ) {
    return Object.freeze({ ok: false, safeErrorCode: "target_response_meta_mismatch" });
  }

  return Object.freeze({ ok: true });
}

function requestIdForEndpoint(endpoint) {
  const normalizedPath = endpoint.path
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();

  return `target-env-smoke-${endpoint.method.toLowerCase()}-${normalizedPath}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readRequiredOption(value, code, findings) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (normalized.length === 0) {
    findings.push(createFinding(code, "blocker"));
    return undefined;
  }

  return normalized;
}

function createFinding(code, severity) {
  return Object.freeze({
    code,
    severity,
    safeDetailCode: code,
  });
}

function freezeReport(report) {
  return Object.freeze({
    ...report,
    endpoints: Object.freeze([...report.endpoints]),
    findings: Object.freeze([...report.findings]),
  });
}

async function main() {
  const report = await runTargetEnvironmentSmoke({
    baseUrl: process.env.OMNIWA_TARGET_ENV_BASE_URL,
    apiKey: process.env.OMNIWA_TARGET_ENV_API_KEY,
    timeoutMilliseconds: readPositiveIntegerEnv(process.env.OMNIWA_TARGET_ENV_TIMEOUT_MS, 10_000),
  });
  const writeResult = await writeTargetEnvironmentSmokeReport(
    report,
    process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH,
  );

  console.log(JSON.stringify(report, null, 2));

  if (!writeResult.ok) {
    console.error(JSON.stringify(writeResult, null, 2));
  }

  if (report.status !== "passed" || !writeResult.ok) {
    process.exitCode = 1;
  }
}

export async function writeTargetEnvironmentSmokeReport(report, reportPath) {
  const normalizedPath = typeof reportPath === "string" ? reportPath.trim() : "";

  if (normalizedPath.length === 0) {
    return Object.freeze({ ok: true });
  }

  try {
    await mkdir(dirname(normalizedPath), { recursive: true });
    await writeFile(normalizedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({
      ok: false,
      safeErrorCode: "target_smoke_report_write_failed",
    });
  }
}

function readPositiveIntegerEnv(value, fallback) {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  return /^\d+$/u.test(normalized) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
