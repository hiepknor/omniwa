import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredRegressionTestFiles = Object.freeze([
  "apps/api/src/platform-regression.spec.ts",
  "apps/api/src/http-server.spec.ts",
  "apps/api/src/api-key-auth.spec.ts",
  "apps/api/src/api-rate-limiter.spec.ts",
  "apps/api/src/resource-ownership.spec.ts",
  "apps/api/src/runtime-composition.spec.ts",
  "apps/api/src/realtime-event-stream.spec.ts",
  "packages/interface-api/src/api-interface-adapter.spec.ts",
  "packages/application/src/commands/command-query-model.spec.ts",
  "packages/application/src/workflows/workflow-service.spec.ts",
  "packages/domain/src/services/phase-24-domain-contracts.spec.ts",
  "packages/infrastructure-persistence/src/durable-json-repositories.spec.ts",
  "packages/infrastructure-persistence/src/event-log-store.spec.ts",
  "packages/infrastructure-queue/src/durable-worker-job-queue-provider.spec.ts",
  "packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts",
  "packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts",
  "apps/provider-runtime/src/provider-runtime.spec.ts",
  "apps/provider-runtime/src/provider-runtime-app.spec.ts",
  "apps/provider-runtime/src/provider-runtime-ownership-guard.spec.ts",
  "apps/worker/src/worker-runtime.spec.ts",
  "apps/worker/src/worker-loop.spec.ts",
  "packages/infrastructure-webhook/src/webhook-http-gateway.spec.ts",
  "packages/infrastructure-webhook/src/webhook-signing.spec.ts",
  "packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts",
  "packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts",
  "apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts",
  "apps/webhook-dispatcher/src/webhook-dispatcher-loop.spec.ts",
  "apps/webhook-dispatcher/src/runtime-composition.spec.ts",
  "packages/observability/src/redaction.spec.ts",
  "packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts",
]);

export const requiredRegressionEvidenceFiles = Object.freeze([
  "tooling/regression/check-production-regression.mjs",
  "docs/runbooks/PRODUCTION_REGRESSION_GATES.md",
]);

export const requiredRegressionScriptName = "regression:check";

export async function evaluateProductionRegressionReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "regression_test", requiredRegressionTestFiles, findings);
  await checkFiles(projectRoot, "regression_evidence", requiredRegressionEvidenceFiles, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createProductionRegressionFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-regression-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredRegressionScriptName]: regressionScript(),
      check:
        "pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check && pnpm openapi:check && pnpm openapi:compat && pnpm sdk:check && pnpm sdk:test && pnpm regression:check && pnpm release:check",
    },
  });

  for (const file of [...requiredRegressionTestFiles, ...requiredRegressionEvidenceFiles]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function regressionScript() {
  return [
    "node tooling/regression/check-production-regression.mjs",
    "pnpm exec vitest run",
    ...requiredRegressionTestFiles,
  ].join(" ");
}

async function checkFiles(projectRoot, category, files, findings) {
  for (const file of files) {
    if (!(await fileExists(join(projectRoot, file)))) {
      findings.push(
        createFinding(`${category}_missing`, "blocker", {
          target: file,
          safeDetailCode: `${category}_missing`,
        }),
      );
    }
  }
}

async function checkRootPackage(projectRoot, findings) {
  const packageJson = await readJson(join(projectRoot, "package.json"), findings);

  if (packageJson === undefined) {
    return;
  }

  const scripts = packageJson.scripts;
  if (!isRecord(scripts)) {
    findings.push(createFinding("root_scripts_missing", "blocker"));
    return;
  }

  const regressionCheck = scripts[requiredRegressionScriptName];
  if (typeof regressionCheck !== "string" || regressionCheck.length === 0) {
    findings.push(
      createFinding("root_regression_script_missing", "blocker", {
        target: requiredRegressionScriptName,
      }),
    );
    return;
  }

  if (!regressionCheck.includes("node tooling/regression/check-production-regression.mjs")) {
    findings.push(createFinding("root_regression_script_missing_tooling_gate", "blocker"));
  }

  if (regressionCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_regression_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredRegressionTestFiles) {
    if (!regressionCheck.includes(testFile)) {
      findings.push(
        createFinding("root_regression_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_regression_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm regression:check")) {
    findings.push(createFinding("check_script_missing_regression_gate", "blocker"));
  }
}

async function readJson(path, findings) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    findings.push(
      createFinding("root_package_unreadable", "blocker", {
        target: "package.json",
      }),
    );

    return undefined;
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createFinding(code, severity, options = {}) {
  const finding = {
    code,
    severity,
    safeDetailCode: options.safeDetailCode ?? code,
  };

  if (typeof options.target === "string") {
    finding.target = options.target;
  }

  return Object.freeze(finding);
}

function freezeReport(report) {
  return Object.freeze({
    ...report,
    findings: Object.freeze([...report.findings]),
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeJson(path, data) {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function main() {
  const report = await evaluateProductionRegressionReadiness();

  if (report.status === "passed") {
    console.log(`Production regression gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Production regression gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
