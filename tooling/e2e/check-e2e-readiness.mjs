import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredE2eEvidenceFiles = Object.freeze([
  "apps/api/src/platform-regression.spec.ts",
  "apps/background/src/local-vertical-slice-demo.ts",
  "docs/platform-evolution/PR-15_END_TO_END_AND_SECURITY_REGRESSION_GATES.md",
  "docs/runbooks/PRODUCTION_REGRESSION_GATES.md",
]);

export const requiredE2eEvidenceTests = Object.freeze([
  "apps/api/src/platform-regression.spec.ts",
  "apps/background/src/local-vertical-slice-demo.spec.ts",
  "tooling/e2e/check-e2e-readiness.spec.ts",
]);

export const requiredE2eScriptName = "e2e:check";

export async function evaluateE2eReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "e2e_evidence", requiredE2eEvidenceFiles, findings);
  await checkFiles(projectRoot, "e2e_evidence_test", requiredE2eEvidenceTests, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createE2eFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-e2e-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredE2eScriptName]: e2eScript(),
      check: "pnpm lint && pnpm test && pnpm e2e:check && pnpm release:check",
    },
  });

  for (const file of [...requiredE2eEvidenceFiles, ...requiredE2eEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function e2eScript() {
  return [
    "node tooling/e2e/check-e2e-readiness.mjs",
    "pnpm exec vitest run",
    ...requiredE2eEvidenceTests,
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

  const e2eCheck = scripts[requiredE2eScriptName];
  if (typeof e2eCheck !== "string" || e2eCheck.length === 0) {
    findings.push(
      createFinding("root_e2e_script_missing", "blocker", {
        target: requiredE2eScriptName,
      }),
    );
    return;
  }

  if (!e2eCheck.includes("node tooling/e2e/check-e2e-readiness.mjs")) {
    findings.push(createFinding("root_e2e_script_missing_tooling_gate", "blocker"));
  }

  if (e2eCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_e2e_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredE2eEvidenceTests) {
    if (!e2eCheck.includes(testFile)) {
      findings.push(
        createFinding("root_e2e_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_e2e_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm e2e:check")) {
    findings.push(createFinding("check_script_missing_e2e_gate", "blocker"));
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
  const report = await evaluateE2eReadiness();

  if (report.status === "passed") {
    console.log(`E2E readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("E2E readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
