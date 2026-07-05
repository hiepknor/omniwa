import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const targetEnvironmentLoadEndpoints = Object.freeze([
  Object.freeze({ method: "GET", path: "/v1/health" }),
  Object.freeze({ method: "GET", path: "/v1/health/readiness" }),
  Object.freeze({ method: "GET", path: "/v1/instances" }),
]);

const defaultRequestCount = 60;
const defaultConcurrency = 5;
const defaultTimeoutMilliseconds = 10_000;
const defaultMaxP95LatencyMilliseconds = 2_000;
const defaultMinSuccessRatePercent = 100;

export async function runTargetEnvironmentLoad(options = {}) {
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpoints = options.endpoints ?? targetEnvironmentLoadEndpoints;
  const requestCount = readPositiveIntegerOption(options.requestCount, defaultRequestCount);
  const concurrency = Math.min(
    requestCount,
    readPositiveIntegerOption(options.concurrency, defaultConcurrency),
  );
  const timeoutMilliseconds = readPositiveIntegerOption(
    options.timeoutMilliseconds,
    defaultTimeoutMilliseconds,
  );
  const maxP95LatencyMilliseconds = readPositiveIntegerOption(
    options.maxP95LatencyMilliseconds,
    defaultMaxP95LatencyMilliseconds,
  );
  const minSuccessRatePercent = readPercentOption(
    options.minSuccessRatePercent,
    defaultMinSuccessRatePercent,
  );
  const nowMilliseconds = options.nowMilliseconds ?? (() => Date.now());
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

  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    findings.push(createFinding("target_load_endpoint_set_empty", "blocker"));
  }

  const budgets = freezeBudgets({
    requestCount,
    concurrency,
    timeoutMilliseconds,
    maxP95LatencyMilliseconds,
    minSuccessRatePercent,
  });

  if (
    findings.length > 0 ||
    parsedBaseUrl === undefined ||
    apiKey === undefined ||
    !Array.isArray(endpoints) ||
    endpoints.length === 0
  ) {
    return freezeReport({
      status: "failed",
      checkedAtIso,
      budgets,
      summary: emptySummary(),
      endpoints: [],
      findings,
    });
  }

  const startedAt = nowMilliseconds();
  const requestResults = await runRequests({
    baseUrl: parsedBaseUrl,
    apiKey,
    checkedAtIso,
    concurrency,
    endpoints,
    fetcher,
    nowMilliseconds,
    requestCount,
    timeoutMilliseconds,
  });
  const durationMilliseconds = Math.max(0, nowMilliseconds() - startedAt);
  const summary = summarizeRequests(requestResults, durationMilliseconds);
  const endpointSummaries = summarizeEndpoints(requestResults);

  if (summary.successRatePercent < minSuccessRatePercent) {
    findings.push(createFinding("target_load_success_rate_below_budget", "blocker"));
  }

  if (summary.p95LatencyMilliseconds > maxP95LatencyMilliseconds) {
    findings.push(createFinding("target_load_p95_above_budget", "blocker"));
  }

  return freezeReport({
    status: findings.length === 0 ? "passed" : "failed",
    checkedAtIso,
    budgets,
    summary,
    endpoints: endpointSummaries,
    findings,
  });
}

async function runRequests(input) {
  const results = [];
  let nextRequestIndex = 0;

  async function worker() {
    while (nextRequestIndex < input.requestCount) {
      const requestIndex = nextRequestIndex;
      nextRequestIndex += 1;
      const endpoint = input.endpoints[requestIndex % input.endpoints.length];

      results.push(await loadEndpoint({ ...input, endpoint, requestIndex }));
    }
  }

  await Promise.all(Array.from({ length: input.concurrency }, () => worker()));

  return results;
}

async function loadEndpoint(input) {
  const controller = new globalThis.AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMilliseconds);
  const startedAt = input.nowMilliseconds();

  try {
    const response = await input.fetcher(new URL(input.endpoint.path, input.baseUrl), {
      method: input.endpoint.method,
      headers: {
        "x-api-key": input.apiKey,
        "x-request-id": requestIdForEndpoint(input.endpoint, input.requestIndex),
        "x-correlation-id": "target-env-load",
      },
      signal: controller.signal,
    });

    return freezeRequestResult({
      method: input.endpoint.method,
      path: input.endpoint.path,
      ok: Boolean(response.ok),
      statusCode: typeof response.status === "number" ? response.status : 0,
      latencyMilliseconds: Math.max(0, input.nowMilliseconds() - startedAt),
      checkedAtIso: input.checkedAtIso,
    });
  } catch {
    return freezeRequestResult({
      method: input.endpoint.method,
      path: input.endpoint.path,
      ok: false,
      statusCode: 0,
      latencyMilliseconds: Math.max(0, input.nowMilliseconds() - startedAt),
      checkedAtIso: input.checkedAtIso,
      safeErrorCode: "target_load_endpoint_unavailable",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeRequests(results, durationMilliseconds) {
  const successes = results.filter((result) => result.ok).length;
  const failures = results.length - successes;
  const latencies = results.map((result) => result.latencyMilliseconds);

  return Object.freeze({
    totalRequests: results.length,
    successes,
    failures,
    successRatePercent: percentage(successes, results.length),
    durationMilliseconds,
    p95LatencyMilliseconds: percentile(latencies, 95),
    maxLatencyMilliseconds: latencies.length === 0 ? 0 : Math.max(...latencies),
  });
}

function summarizeEndpoints(results) {
  const groups = new Map();

  for (const result of results) {
    const key = `${result.method} ${result.path}`;
    const existing = groups.get(key) ?? {
      method: result.method,
      path: result.path,
      requests: 0,
      successes: 0,
      failures: 0,
      statusCodeCounts: new Map(),
      safeErrorCodeCounts: new Map(),
    };

    existing.requests += 1;

    if (result.ok) {
      existing.successes += 1;
    } else {
      existing.failures += 1;
    }

    incrementCount(existing.statusCodeCounts, String(result.statusCode));

    if (result.safeErrorCode !== undefined) {
      incrementCount(existing.safeErrorCodeCounts, result.safeErrorCode);
    }

    groups.set(key, existing);
  }

  return Object.freeze(
    [...groups.values()].map((group) =>
      Object.freeze({
        method: group.method,
        path: group.path,
        requests: group.requests,
        successes: group.successes,
        failures: group.failures,
        statusCodeCounts: freezeCountMap(group.statusCodeCounts),
        safeErrorCodeCounts: freezeCountMap(group.safeErrorCodeCounts),
      }),
    ),
  );
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function freezeCountMap(map) {
  return Object.freeze(
    Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right))),
  );
}

function percentile(values, targetPercentile) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((targetPercentile / 100) * sorted.length) - 1),
  );

  return sorted[index];
}

function percentage(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }

  return Number(((numerator / denominator) * 100).toFixed(2));
}

function requestIdForEndpoint(endpoint, requestIndex) {
  const normalizedPath = endpoint.path
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();

  return `target-env-load-${endpoint.method.toLowerCase()}-${normalizedPath}-${String(
    requestIndex + 1,
  ).padStart(6, "0")}`;
}

function readRequiredOption(value, code, findings) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (normalized.length === 0) {
    findings.push(createFinding(code, "blocker"));
    return undefined;
  }

  return normalized;
}

function readPositiveIntegerOption(value, fallback) {
  const normalized = typeof value === "number" ? String(value) : value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  return /^\d+$/u.test(normalized) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function readPercentOption(value, fallback) {
  const parsed = readPositiveIntegerOption(value, fallback);

  return parsed > 100 ? fallback : parsed;
}

function createFinding(code, severity) {
  return Object.freeze({
    code,
    severity,
    safeDetailCode: code,
  });
}

function emptySummary() {
  return Object.freeze({
    totalRequests: 0,
    successes: 0,
    failures: 0,
    successRatePercent: 0,
    durationMilliseconds: 0,
    p95LatencyMilliseconds: 0,
    maxLatencyMilliseconds: 0,
  });
}

function freezeBudgets(budgets) {
  return Object.freeze({ ...budgets });
}

function freezeRequestResult(result) {
  return Object.freeze({ ...result });
}

function freezeReport(report) {
  return Object.freeze({
    ...report,
    budgets: freezeBudgets(report.budgets),
    summary: Object.freeze({ ...report.summary }),
    endpoints: Object.freeze([...report.endpoints]),
    findings: Object.freeze([...report.findings]),
  });
}

export async function writeTargetEnvironmentLoadReport(report, reportPath) {
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
      safeErrorCode: "target_load_report_write_failed",
    });
  }
}

async function main() {
  const report = await runTargetEnvironmentLoad({
    baseUrl: process.env.OMNIWA_TARGET_ENV_BASE_URL,
    apiKey: process.env.OMNIWA_TARGET_ENV_API_KEY,
    requestCount: process.env.OMNIWA_TARGET_ENV_LOAD_REQUESTS,
    concurrency: process.env.OMNIWA_TARGET_ENV_LOAD_CONCURRENCY,
    timeoutMilliseconds: process.env.OMNIWA_TARGET_ENV_TIMEOUT_MS,
    maxP95LatencyMilliseconds: process.env.OMNIWA_TARGET_ENV_LOAD_MAX_P95_MS,
    minSuccessRatePercent: process.env.OMNIWA_TARGET_ENV_LOAD_MIN_SUCCESS_RATE_PERCENT,
  });
  const writeResult = await writeTargetEnvironmentLoadReport(
    report,
    process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH,
  );

  console.log(JSON.stringify(report, null, 2));

  if (!writeResult.ok) {
    console.error(JSON.stringify(writeResult, null, 2));
  }

  if (report.status !== "passed" || !writeResult.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
