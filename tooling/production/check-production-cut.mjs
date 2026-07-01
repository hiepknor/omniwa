import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const productionCutDecisions = Object.freeze([
  "NOT_READY",
  "CONDITIONALLY_READY",
  "PRODUCTION_READY",
]);

export const requiredProductionEvidenceFiles = Object.freeze([
  "tooling/production/check-production-cut.mjs",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
  "docs/reviews/PRODUCTION_CUT_REVIEW.md",
  "docs/platform-evolution/PR-16_LOAD_BASELINE_AND_PRODUCTION_CUT_REVIEW.md",
]);

export const requiredProductionEvidenceTests = Object.freeze([
  "apps/api/src/load-baseline.spec.ts",
  "tooling/production/check-production-cut.spec.ts",
]);

export const requiredProductionScripts = Object.freeze(["load:check", "production:check"]);

export async function evaluateProductionCutReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "production_evidence", requiredProductionEvidenceFiles, findings);
  await checkFiles(
    projectRoot,
    "production_evidence_test",
    requiredProductionEvidenceTests,
    findings,
  );
  await checkProductionCutReview(projectRoot, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createProductionCutFixture(projectRoot, decision = "CONDITIONALLY_READY") {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-production-cut-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      "load:check":
        "pnpm exec vitest run apps/api/src/load-baseline.spec.ts tooling/production/check-production-cut.spec.ts",
      "production:check": "node tooling/production/check-production-cut.mjs && pnpm load:check",
      check:
        "pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check && pnpm openapi:check && pnpm openapi:compat && pnpm sdk:check && pnpm sdk:test && pnpm regression:check && pnpm production:check && pnpm release:check",
    },
  });

  for (const file of [...requiredProductionEvidenceFiles, ...requiredProductionEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }

  await writeText(
    join(projectRoot, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
    `# Production Cut Review\n\nFinal readiness decision: ${decision}\n\nProduction Ready: NO\n\n## Load baseline\n\nRecorded.\n\n## Known Constraints\n\nRecorded.\n`,
  );
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

async function checkProductionCutReview(projectRoot, findings) {
  let content;

  try {
    content = await readFile(join(projectRoot, "docs/reviews/PRODUCTION_CUT_REVIEW.md"), "utf8");
  } catch {
    return;
  }

  const decision = content.match(/Final readiness decision:\s*([A-Z_]+)/u)?.[1];
  if (decision === undefined || !productionCutDecisions.includes(decision)) {
    findings.push(createFinding("production_cut_decision_missing_or_invalid", "blocker"));
  }

  if (!content.includes("Production Ready: NO") && !content.includes("Production Ready: YES")) {
    findings.push(createFinding("production_ready_state_missing", "blocker"));
  }

  if (!content.includes("Load baseline")) {
    findings.push(createFinding("load_baseline_summary_missing", "blocker"));
  }

  if (!/Known Constraints/iu.test(content)) {
    findings.push(createFinding("known_constraints_missing", "blocker"));
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

  for (const scriptName of requiredProductionScripts) {
    if (typeof scripts[scriptName] !== "string" || scripts[scriptName].length === 0) {
      findings.push(
        createFinding("root_production_script_missing", "blocker", {
          target: scriptName,
          safeDetailCode: "root_production_script_missing",
        }),
      );
    }
  }

  const productionCheck = scripts["production:check"];
  if (
    typeof productionCheck === "string" &&
    !productionCheck.includes("node tooling/production/check-production-cut.mjs")
  ) {
    findings.push(createFinding("production_script_missing_cut_checker", "blocker"));
  }

  if (typeof productionCheck === "string" && !productionCheck.includes("pnpm load:check")) {
    findings.push(createFinding("production_script_missing_load_gate", "blocker"));
  }

  const loadCheck = scripts["load:check"];
  if (typeof loadCheck === "string" && loadCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("load_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredProductionEvidenceTests) {
    if (typeof loadCheck === "string" && !loadCheck.includes(testFile)) {
      findings.push(
        createFinding("load_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "load_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm production:check")) {
    findings.push(createFinding("check_script_missing_production_gate", "blocker"));
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
  const report = await evaluateProductionCutReadiness();

  if (report.status === "passed") {
    console.log(`Production cut gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Production cut gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
