import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredPerformanceEvidenceFiles = Object.freeze([
  "apps/api/src/load-baseline.spec.ts",
  "tooling/production/check-production-cut.mjs",
  "tooling/performance/run-target-environment-load.mjs",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
  "docs/platform-evolution/PR-16_LOAD_BASELINE_AND_PRODUCTION_CUT_REVIEW.md",
]);

export const requiredPerformanceEvidenceTests = Object.freeze([
  "apps/api/src/load-baseline.spec.ts",
  "tooling/production/check-production-cut.spec.ts",
  "tooling/performance/run-target-environment-load.spec.ts",
  "tooling/performance/check-performance-readiness.spec.ts",
]);

export const requiredPerformanceScriptName = "performance:check";
export const targetEnvironmentLoadScriptName = "target-env:load";

export async function evaluatePerformanceReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "performance_evidence", requiredPerformanceEvidenceFiles, findings);
  await checkFiles(
    projectRoot,
    "performance_evidence_test",
    requiredPerformanceEvidenceTests,
    findings,
  );
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createPerformanceFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-performance-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredPerformanceScriptName]: performanceScript(),
      [targetEnvironmentLoadScriptName]: "node tooling/performance/run-target-environment-load.mjs",
      "load:check":
        "pnpm exec vitest run apps/api/src/load-baseline.spec.ts tooling/production/check-production-cut.spec.ts",
      check: "pnpm lint && pnpm test && pnpm performance:check && pnpm release:check",
    },
  });

  for (const file of [...requiredPerformanceEvidenceFiles, ...requiredPerformanceEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function performanceScript() {
  const performanceEvidenceTests = requiredPerformanceEvidenceTests.filter((testFile) =>
    testFile.startsWith("tooling/performance/"),
  );

  return [
    "node tooling/performance/check-performance-readiness.mjs",
    "pnpm load:check",
    `pnpm exec vitest run ${performanceEvidenceTests.join(" ")}`,
  ].join(" && ");
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

  const performanceCheck = scripts[requiredPerformanceScriptName];
  if (typeof performanceCheck !== "string" || performanceCheck.length === 0) {
    findings.push(
      createFinding("root_performance_script_missing", "blocker", {
        target: requiredPerformanceScriptName,
      }),
    );
    return;
  }

  if (!performanceCheck.includes("node tooling/performance/check-performance-readiness.mjs")) {
    findings.push(createFinding("root_performance_script_missing_tooling_gate", "blocker"));
  }

  if (!performanceCheck.includes("pnpm load:check")) {
    findings.push(createFinding("root_performance_script_missing_load_gate", "blocker"));
  }

  const targetEnvironmentLoadScript = scripts[targetEnvironmentLoadScriptName];
  if (
    typeof targetEnvironmentLoadScript !== "string" ||
    !targetEnvironmentLoadScript.includes(
      "node tooling/performance/run-target-environment-load.mjs",
    )
  ) {
    findings.push(
      createFinding("root_target_environment_load_script_missing", "blocker", {
        target: targetEnvironmentLoadScriptName,
      }),
    );
  }

  if (performanceCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_performance_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredPerformanceEvidenceTests) {
    if (!scriptSetIncludesTest(scripts, performanceCheck, testFile)) {
      findings.push(
        createFinding("root_performance_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_performance_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm performance:check")) {
    findings.push(createFinding("check_script_missing_performance_gate", "blocker"));
  }
}

function scriptSetIncludesTest(scripts, performanceCheck, testFile) {
  if (performanceCheck.includes(testFile)) {
    return true;
  }

  if (!performanceCheck.includes("pnpm load:check")) {
    return false;
  }

  const loadCheck = scripts["load:check"];
  return typeof loadCheck === "string" && loadCheck.includes(testFile);
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
  const report = await evaluatePerformanceReadiness();

  if (report.status === "passed") {
    console.log(`Performance readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Performance readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
