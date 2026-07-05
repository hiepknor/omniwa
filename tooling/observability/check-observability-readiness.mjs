import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredObservabilityEvidenceFiles = Object.freeze([
  "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md",
  "packages/observability/src/metric-catalog.ts",
  "packages/observability/src/alerts.ts",
  "packages/infrastructure-observability/src/dependency-health.ts",
  "packages/infrastructure-observability/src/metrics-exporter.ts",
  "packages/infrastructure-observability/src/structured-log-backend.ts",
  "apps/metrics/src/index.ts",
  "apps/health/src/index.ts",
]);

export const requiredObservabilityEvidenceTests = Object.freeze([
  "packages/observability/src/metric-catalog.spec.ts",
  "packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts",
  "apps/metrics/src/index.spec.ts",
  "apps/health/src/index.spec.ts",
  "tooling/observability/check-observability-readiness.spec.ts",
]);

export const requiredObservabilityScriptName = "observability:check";

export async function evaluateObservabilityReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(
    projectRoot,
    "observability_evidence",
    requiredObservabilityEvidenceFiles,
    findings,
  );
  await checkFiles(
    projectRoot,
    "observability_evidence_test",
    requiredObservabilityEvidenceTests,
    findings,
  );
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createObservabilityFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-observability-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredObservabilityScriptName]: observabilityScript(),
      check: "pnpm lint && pnpm test && pnpm observability:check && pnpm release:check",
    },
  });

  for (const file of [
    ...requiredObservabilityEvidenceFiles,
    ...requiredObservabilityEvidenceTests,
  ]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function observabilityScript() {
  return [
    "node tooling/observability/check-observability-readiness.mjs",
    "pnpm exec vitest run",
    ...requiredObservabilityEvidenceTests,
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

  const observabilityCheck = scripts[requiredObservabilityScriptName];
  if (typeof observabilityCheck !== "string" || observabilityCheck.length === 0) {
    findings.push(
      createFinding("root_observability_script_missing", "blocker", {
        target: requiredObservabilityScriptName,
      }),
    );
    return;
  }

  if (
    !observabilityCheck.includes("node tooling/observability/check-observability-readiness.mjs")
  ) {
    findings.push(createFinding("root_observability_script_missing_tooling_gate", "blocker"));
  }

  if (observabilityCheck.includes("--passWithNoTests")) {
    findings.push(
      createFinding("root_observability_script_must_not_pass_with_no_tests", "blocker"),
    );
  }

  for (const testFile of requiredObservabilityEvidenceTests) {
    if (!observabilityCheck.includes(testFile)) {
      findings.push(
        createFinding("root_observability_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_observability_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm observability:check")) {
    findings.push(createFinding("check_script_missing_observability_gate", "blocker"));
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
  const report = await evaluateObservabilityReadiness();

  if (report.status === "passed") {
    console.log(`Observability readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Observability readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
