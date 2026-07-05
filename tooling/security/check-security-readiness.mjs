import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredSecurityEvidenceFiles = Object.freeze([
  "tooling/security/README.md",
  "docs/runbooks/PRODUCTION_REGRESSION_GATES.md",
  "docs/platform-evolution/PR-15_END_TO_END_AND_SECURITY_REGRESSION_GATES.md",
  "apps/api/src/api-key-auth.ts",
  "apps/api/src/api-key-lifecycle.ts",
  "apps/api/src/api-rate-limiter.ts",
  "apps/api/src/api-security-audit.ts",
  "apps/api/src/resource-ownership.ts",
  "packages/infrastructure-webhook/src/webhook-signing.ts",
  "packages/observability/src/redaction.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.ts",
  "packages/infrastructure-provider-baileys/src/baileys-auth-state-store.ts",
]);

export const requiredSecurityEvidenceTests = Object.freeze([
  "apps/api/src/api-key-auth.spec.ts",
  "apps/api/src/api-key-lifecycle.spec.ts",
  "apps/api/src/api-rate-limiter.spec.ts",
  "apps/api/src/api-security-audit.spec.ts",
  "apps/api/src/resource-ownership.spec.ts",
  "apps/api/src/platform-regression.spec.ts",
  "packages/infrastructure-webhook/src/webhook-signing.spec.ts",
  "packages/observability/src/redaction.spec.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts",
  "packages/infrastructure-provider-baileys/src/baileys-auth-state-store.spec.ts",
  "tooling/security/check-security-readiness.spec.ts",
]);

export const requiredSecurityScriptName = "security:check";

export async function evaluateSecurityReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "security_evidence", requiredSecurityEvidenceFiles, findings);
  await checkFiles(projectRoot, "security_evidence_test", requiredSecurityEvidenceTests, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createSecurityFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-security-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredSecurityScriptName]: securityScript(),
      check: "pnpm lint && pnpm test && pnpm security:check && pnpm release:check",
    },
  });

  for (const file of [...requiredSecurityEvidenceFiles, ...requiredSecurityEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }
}

export function securityScript() {
  return [
    "node tooling/security/check-security-readiness.mjs",
    "pnpm exec vitest run",
    ...requiredSecurityEvidenceTests,
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

  const securityCheck = scripts[requiredSecurityScriptName];
  if (typeof securityCheck !== "string" || securityCheck.length === 0) {
    findings.push(
      createFinding("root_security_script_missing", "blocker", {
        target: requiredSecurityScriptName,
      }),
    );
    return;
  }

  if (!securityCheck.includes("node tooling/security/check-security-readiness.mjs")) {
    findings.push(createFinding("root_security_script_missing_tooling_gate", "blocker"));
  }

  if (securityCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_security_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredSecurityEvidenceTests) {
    if (!securityCheck.includes(testFile)) {
      findings.push(
        createFinding("root_security_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_security_script_missing_test",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm security:check")) {
    findings.push(createFinding("check_script_missing_security_gate", "blocker"));
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
  const report = await evaluateSecurityReadiness();

  if (report.status === "passed") {
    console.log(`Security readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Security readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
