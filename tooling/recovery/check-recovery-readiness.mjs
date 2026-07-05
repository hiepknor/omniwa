import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredRecoveryEvidenceFiles = Object.freeze([
  "apps/background/src/backup-restore-drill.ts",
  "apps/background/src/recovery-validation.ts",
  "docs/runbooks/BACKUP_RESTORE_RECOVERY_DRILL.md",
  "docs/platform-evolution/PR-14_BACKUP_RESTORE_RECOVERY_DRILL.md",
]);

export const requiredRecoveryEvidenceTests = Object.freeze([
  "apps/background/src/backup-restore-drill.spec.ts",
  "apps/background/src/recovery-validation.spec.ts",
  "tooling/recovery/check-recovery-readiness.spec.ts",
]);

export const requiredRecoveryScriptName = "recovery:check";

export async function evaluateRecoveryReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "recovery_evidence", requiredRecoveryEvidenceFiles, findings);
  await checkFiles(projectRoot, "recovery_evidence_test", requiredRecoveryEvidenceTests, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createRecoveryFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-recovery-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredRecoveryScriptName]: recoveryScript(),
      check: "pnpm lint && pnpm test && pnpm recovery:check && pnpm release:check",
    },
  });

  for (const file of [...requiredRecoveryEvidenceFiles, ...requiredRecoveryEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function recoveryScript() {
  return [
    "node tooling/recovery/check-recovery-readiness.mjs",
    "pnpm exec vitest run",
    ...requiredRecoveryEvidenceTests,
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

  const recoveryCheck = scripts[requiredRecoveryScriptName];
  if (typeof recoveryCheck !== "string" || recoveryCheck.length === 0) {
    findings.push(
      createFinding("root_recovery_script_missing", "blocker", {
        target: requiredRecoveryScriptName,
      }),
    );
    return;
  }

  if (!recoveryCheck.includes("node tooling/recovery/check-recovery-readiness.mjs")) {
    findings.push(createFinding("root_recovery_script_missing_tooling_gate", "blocker"));
  }

  if (recoveryCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_recovery_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredRecoveryEvidenceTests) {
    if (!recoveryCheck.includes(testFile)) {
      findings.push(
        createFinding("root_recovery_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_recovery_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm recovery:check")) {
    findings.push(createFinding("check_script_missing_recovery_gate", "blocker"));
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
  const report = await evaluateRecoveryReadiness();

  if (report.status === "passed") {
    console.log(`Recovery readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Recovery readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
