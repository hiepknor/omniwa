import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findUnsafeArtifactContent,
  validateTargetEnvironmentAlertSloDryRunArtifact,
} from "./check-target-environment-evidence.mjs";

const defaultAlertSloSafeErrorCode = "target_alert_slo_dry_run_not_supplied";

export async function runTargetEnvironmentAlertSloDryRun(options = {}) {
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const env = options.env ?? {};
  const inputPath = normalizeOptionalString(
    options.inputPath ?? env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH,
  );
  const inputResult =
    options.input === undefined
      ? await readInputFromPath(inputPath)
      : Object.freeze({ input: options.input, findings: [] });

  if (inputResult.input === undefined) {
    return createDefaultAlertSloDryRunReport({
      checkedAtIso,
      findings:
        inputResult.findings.length === 0
          ? [
              createFinding(
                "target_alert_slo_dry_run_input_missing",
                "warning",
                defaultAlertSloSafeErrorCode,
              ),
            ]
          : inputResult.findings,
    });
  }

  if (findUnsafeArtifactContent(inputResult.input) !== undefined) {
    return createDefaultAlertSloDryRunReport({
      checkedAtIso,
      findings: [
        createFinding(
          "target_alert_slo_dry_run_input_unsafe_content",
          "blocker",
          "target_alert_slo_dry_run_input_unsafe_content",
        ),
      ],
    });
  }

  if (!validateTargetEnvironmentAlertSloDryRunArtifact(inputResult.input)) {
    return createDefaultAlertSloDryRunReport({
      checkedAtIso,
      findings: [
        createFinding(
          "target_alert_slo_dry_run_input_invalid_schema",
          "blocker",
          "target_alert_slo_dry_run_input_invalid_schema",
        ),
      ],
    });
  }

  return freezeAlertSloDryRunReport({
    ...inputResult.input,
    status: alertSloDryRunStatus(inputResult.input),
    findings: inputResult.input.findings,
  });
}

async function readInputFromPath(inputPath) {
  if (inputPath === undefined) {
    return Object.freeze({ input: undefined, findings: [] });
  }

  try {
    return Object.freeze({
      input: JSON.parse(await readFile(inputPath, "utf8")),
      findings: [],
    });
  } catch {
    return Object.freeze({
      input: undefined,
      findings: [
        createFinding(
          "target_alert_slo_dry_run_input_unreadable",
          "blocker",
          "target_alert_slo_dry_run_input_unreadable",
        ),
      ],
    });
  }
}

function createDefaultAlertSloDryRunReport({ checkedAtIso, findings }) {
  return freezeAlertSloDryRunReport({
    status: "failed",
    checkedAtIso,
    dashboards: [
      {
        dashboardId: "operator-evidence-dashboard-access-pending",
        accessible: false,
        panelCount: 0,
        safeErrorCode: defaultAlertSloSafeErrorCode,
      },
    ],
    alertRoutes: [
      {
        alertId: "operator-evidence-alert-route-pending",
        routeChecked: false,
        notificationDryRun: false,
        receiverClass: "operator-evidence-receiver-class-pending",
        safeErrorCode: defaultAlertSloSafeErrorCode,
      },
    ],
    sloWindows: [
      {
        area: "operator-evidence-slo-window-pending",
        windowChecked: false,
        budgetPolicyChecked: false,
        safeErrorCode: defaultAlertSloSafeErrorCode,
      },
    ],
    findings,
  });
}

function alertSloDryRunStatus(report) {
  return alertSloDryRunChecksPass(report) ? "passed" : "failed";
}

function alertSloDryRunChecksPass(report) {
  return (
    report.dashboards.length > 0 &&
    report.dashboards.every((dashboard) => dashboard.accessible && dashboard.panelCount > 0) &&
    report.alertRoutes.length > 0 &&
    report.alertRoutes.every(
      (alertRoute) => alertRoute.routeChecked && alertRoute.notificationDryRun,
    ) &&
    report.sloWindows.length > 0 &&
    report.sloWindows.every(
      (sloWindow) => sloWindow.windowChecked && sloWindow.budgetPolicyChecked,
    ) &&
    report.findings.every((finding) => finding.severity !== "blocker")
  );
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function createFinding(code, severity, safeDetailCode = code) {
  return Object.freeze({
    code,
    severity,
    safeDetailCode,
  });
}

function freezeAlertSloDryRunReport(report) {
  return Object.freeze({
    status: report.status,
    checkedAtIso: report.checkedAtIso,
    dashboards: Object.freeze(
      report.dashboards.map((dashboard) => Object.freeze({ ...dashboard })),
    ),
    alertRoutes: Object.freeze(
      report.alertRoutes.map((alertRoute) => Object.freeze({ ...alertRoute })),
    ),
    sloWindows: Object.freeze(
      report.sloWindows.map((sloWindow) => Object.freeze({ ...sloWindow })),
    ),
    findings: Object.freeze(report.findings.map((finding) => Object.freeze({ ...finding }))),
  });
}

export async function writeTargetEnvironmentAlertSloDryRunReport(report, reportPath) {
  const normalizedPath = normalizeOptionalString(reportPath);

  if (normalizedPath === undefined) {
    return Object.freeze({ ok: true });
  }

  try {
    await mkdir(dirname(normalizedPath), { recursive: true });
    await writeFile(normalizedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({
      ok: false,
      safeErrorCode: "target_alert_slo_dry_run_report_write_failed",
    });
  }
}

async function main() {
  const report = await runTargetEnvironmentAlertSloDryRun({ env: process.env });
  const writeResult = await writeTargetEnvironmentAlertSloDryRunReport(
    report,
    process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH,
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
