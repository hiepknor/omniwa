import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredSloEvidenceFiles = Object.freeze([
  "docs/infrastructure/OBSERVABILITY.md",
  "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md",
  "docs/reviews/PRODUCTION_CUT_REVIEW.md",
  "packages/observability/src/metric-catalog.ts",
  "packages/observability/src/alerts.ts",
  "packages/observability/src/dashboard-alert-routing.ts",
]);

export const requiredSloEvidenceTests = Object.freeze([
  "packages/observability/src/metric-catalog.spec.ts",
  "packages/observability/src/dashboard-alert-routing.spec.ts",
  "tooling/observability/check-slo-readiness.spec.ts",
]);

export const requiredSloAreas = Object.freeze([
  "API availability",
  "API latency",
  "Text message enqueue",
  "Media enqueue",
  "Webhook eventual delivery",
  "Queue visibility",
  "Reconnect",
  "Recovery",
  "Backup",
]);

export const requiredSloAlertIds = Object.freeze([
  "api_availability_degraded",
  "api_latency_degraded",
  "queue_backlog",
  "webhook_success_degraded",
  "provider_connection_degraded",
  "worker_utilization_saturated",
  "event_stream_errors",
  "dependency_not_ready",
]);

export const requiredSloScriptName = "slo:check";

export async function evaluateSloReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "slo_evidence", requiredSloEvidenceFiles, findings);
  await checkFiles(projectRoot, "slo_evidence_test", requiredSloEvidenceTests, findings);
  await checkSloDocumentation(projectRoot, findings);
  await checkRootPackage(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createSloFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-slo-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredSloScriptName]: sloScript(),
      "production:check":
        "pnpm target-env:check && pnpm slo:check && node tooling/production/check-production-cut.mjs",
      check: "pnpm lint && pnpm observability:check && pnpm slo:check && pnpm production:check",
    },
  });

  for (const file of [...requiredSloEvidenceFiles, ...requiredSloEvidenceTests]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }

  await writeText(join(projectRoot, "docs/infrastructure/OBSERVABILITY.md"), sloObservability());
  await writeText(
    join(projectRoot, "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md"),
    sloRunbook(),
  );
  await writeText(join(projectRoot, "docs/reviews/PRODUCTION_CUT_REVIEW.md"), sloCutReview());
}

export function sloScript() {
  return [
    "node tooling/observability/check-slo-readiness.mjs",
    "pnpm exec vitest run",
    ...requiredSloEvidenceTests,
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

async function checkSloDocumentation(projectRoot, findings) {
  const observability = await readText(
    join(projectRoot, "docs/infrastructure/OBSERVABILITY.md"),
    findings,
    "slo_observability_doc_unreadable",
  );
  const runbook = await readText(
    join(projectRoot, "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md"),
    findings,
    "slo_runbook_unreadable",
  );
  const cutReview = await readText(
    join(projectRoot, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
    findings,
    "slo_cut_review_unreadable",
  );

  if (observability !== undefined) {
    checkObservabilitySloSection(observability, findings);
  }

  if (runbook !== undefined) {
    checkSloRunbook(runbook, findings);
  }

  if (cutReview !== undefined) {
    checkSloCutReview(cutReview, findings);
  }
}

function checkObservabilitySloSection(content, findings) {
  if (!content.includes("## SLI / SLO / Error Budget")) {
    findings.push(createFinding("slo_section_missing", "blocker"));
  }

  for (const area of requiredSloAreas) {
    if (!hasMarkdownTableRow(content, area)) {
      findings.push(
        createFinding("slo_area_missing", "blocker", {
          target: area,
          safeDetailCode: "slo_area_missing",
        }),
      );
    }
  }
}

function checkSloRunbook(content, findings) {
  if (!content.includes("## Alerts")) {
    findings.push(createFinding("slo_alert_runbook_section_missing", "blocker"));
  }

  for (const alertId of requiredSloAlertIds) {
    if (!content.includes(`\`${alertId}\``)) {
      findings.push(
        createFinding("slo_alert_runbook_missing", "blocker", {
          target: alertId,
          safeDetailCode: "slo_alert_runbook_missing",
        }),
      );
    }
  }
}

function checkSloCutReview(content, findings) {
  const finalDecision = content.match(/Final readiness decision:\s*([A-Z_]+)/u)?.[1];
  const sloEvidenceProven = content.match(/SLO Evidence Proven:\s*(YES|NO)/u)?.[1];

  if (sloEvidenceProven === undefined) {
    findings.push(createFinding("slo_evidence_proof_state_missing", "blocker"));
  }

  if (finalDecision === "PRODUCTION_READY" && sloEvidenceProven !== "YES") {
    findings.push(createFinding("production_ready_slo_evidence_not_proven", "blocker"));
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

  const sloCheck = scripts[requiredSloScriptName];
  if (typeof sloCheck !== "string" || sloCheck.length === 0) {
    findings.push(
      createFinding("root_slo_script_missing", "blocker", {
        target: requiredSloScriptName,
      }),
    );
    return;
  }

  if (!sloCheck.includes("node tooling/observability/check-slo-readiness.mjs")) {
    findings.push(createFinding("root_slo_script_missing_tooling_gate", "blocker"));
  }

  if (sloCheck.includes("--passWithNoTests")) {
    findings.push(createFinding("root_slo_script_must_not_pass_with_no_tests", "blocker"));
  }

  for (const testFile of requiredSloEvidenceTests) {
    if (!sloCheck.includes(testFile)) {
      findings.push(
        createFinding("root_slo_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_slo_script_missing_test",
        }),
      );
    }
  }

  const productionCheck = scripts["production:check"];
  if (typeof productionCheck !== "string" || !productionCheck.includes("pnpm slo:check")) {
    findings.push(createFinding("production_script_missing_slo_gate", "blocker"));
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm slo:check")) {
    findings.push(createFinding("check_script_missing_slo_gate", "blocker"));
  }
}

function hasMarkdownTableRow(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\|\\s*${escaped}\\s*\\|`, "u").test(content);
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

async function readText(path, findings, code) {
  try {
    return await readFile(path, "utf8");
  } catch {
    findings.push(createFinding(code, "blocker"));
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

function sloObservability() {
  return [
    "# Observability",
    "",
    "## SLI / SLO / Error Budget",
    "",
    "| Area | SLI | MVP SLO | Error Budget Position |",
    "| --- | --- | --- | --- |",
    ...requiredSloAreas.map((area) => `| ${area} | Fixture SLI | Fixture SLO | Fixture budget |`),
    "",
  ].join("\n");
}

function sloRunbook() {
  return [
    "# Observability And Dependency Readiness",
    "",
    "## Alerts",
    "",
    ...requiredSloAlertIds.flatMap((alertId) => [
      "Alert id:",
      "",
      `- \`${alertId}\``,
      "",
      "Operator response:",
      "",
      "1. Fixture response.",
      "",
    ]),
  ].join("\n");
}

function sloCutReview() {
  return [
    "# Production Cut Review",
    "",
    "Final readiness decision: CONDITIONALLY_READY",
    "",
    "SLO Evidence Proven: NO",
    "",
  ].join("\n");
}

async function main() {
  const report = await evaluateSloReadiness();

  if (report.status === "passed") {
    console.log(`SLO readiness gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("SLO readiness gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
