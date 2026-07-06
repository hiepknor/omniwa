import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runTargetEnvironmentAlertSloDryRun,
  writeTargetEnvironmentAlertSloDryRunReport,
} from "./run-target-environment-alert-slo-dry-run.mjs";

describe("target environment alert/SLO dry-run runner", () => {
  it("creates a failed safe skeleton when operator input is missing", async () => {
    const report = await runTargetEnvironmentAlertSloDryRun({
      checkedAtIso: "2026-07-06T00:00:00.000Z",
    });

    expect(report).toEqual({
      status: "failed",
      checkedAtIso: "2026-07-06T00:00:00.000Z",
      dashboards: [
        {
          dashboardId: "operator-evidence-dashboard-access-pending",
          accessible: false,
          panelCount: 0,
          safeErrorCode: "target_alert_slo_dry_run_not_supplied",
        },
      ],
      alertRoutes: [
        {
          alertId: "operator-evidence-alert-route-pending",
          routeChecked: false,
          notificationDryRun: false,
          receiverClass: "operator-evidence-receiver-class-pending",
          safeErrorCode: "target_alert_slo_dry_run_not_supplied",
        },
      ],
      sloWindows: [
        {
          area: "operator-evidence-slo-window-pending",
          windowChecked: false,
          budgetPolicyChecked: false,
          safeErrorCode: "target_alert_slo_dry_run_not_supplied",
        },
      ],
      findings: [
        {
          code: "target_alert_slo_dry_run_input_missing",
          severity: "warning",
          safeDetailCode: "target_alert_slo_dry_run_not_supplied",
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("http://");
    expect(JSON.stringify(report)).not.toContain("https://");
  });

  it("normalizes sanitized operator input and computes passed status", async () => {
    const report = await runTargetEnvironmentAlertSloDryRun({
      input: validAlertSloDryRunInput("failed"),
    });

    expect(report.status).toBe("passed");
    expect(report.dashboards).toEqual([
      {
        dashboardId: "operations-dashboard-reviewed",
        accessible: true,
        panelCount: 8,
      },
    ]);
    expect(report.alertRoutes).toEqual([
      {
        alertId: "api-latency-alert-reviewed",
        routeChecked: true,
        notificationDryRun: true,
        receiverClass: "pager-duty-class-reviewed",
      },
    ]);
    expect(report.sloWindows).toEqual([
      {
        area: "api-availability",
        windowChecked: true,
        budgetPolicyChecked: true,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("https://dashboard.example");
  });

  it("computes failed status when an operator check is incomplete", async () => {
    const input = validAlertSloDryRunInput("passed");
    const report = await runTargetEnvironmentAlertSloDryRun({
      input: {
        ...input,
        alertRoutes: [
          {
            ...input.alertRoutes[0],
            notificationDryRun: false,
          },
        ],
      },
    });

    expect(report.status).toBe("failed");
    expect(report.alertRoutes[0]?.notificationDryRun).toBe(false);
  });

  it("reads sanitized operator input from a file and writes a sanitized report", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-alert-slo-"));

    try {
      const inputPath = join(root, "input", "alert-slo-dry-run-input.json");
      const reportPath = join(root, "output", "alert-slo-dry-run.json");
      await writeJson(inputPath, validAlertSloDryRunInput("failed"));

      const report = await runTargetEnvironmentAlertSloDryRun({ inputPath });
      await expect(writeTargetEnvironmentAlertSloDryRunReport(report, reportPath)).resolves.toEqual(
        {
          ok: true,
        },
      );

      const artifact = await readFile(reportPath, "utf8");
      expect(JSON.parse(artifact)).toEqual(report);
      expect(artifact).not.toContain("target-secret-api-key");
      expect(artifact).not.toContain("dashboard.example");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe operator input without echoing raw target details", async () => {
    const report = await runTargetEnvironmentAlertSloDryRun({
      checkedAtIso: "2026-07-06T00:00:00.000Z",
      input: {
        ...validAlertSloDryRunInput(),
        dashboardUrl: "https://dashboard.example/private",
        apiKey: "target-secret-api-key",
      },
    });

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      {
        code: "target_alert_slo_dry_run_input_unsafe_content",
        severity: "blocker",
        safeDetailCode: "target_alert_slo_dry_run_input_unsafe_content",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("dashboard.example");
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
  });

  it("fails safely when operator input is unreadable or invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-alert-slo-"));

    try {
      const inputPath = join(root, "alert-slo-dry-run-input.json");
      await writeFile(inputPath, "{not-json", "utf8");

      const report = await runTargetEnvironmentAlertSloDryRun({
        checkedAtIso: "2026-07-06T00:00:00.000Z",
        inputPath,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual([
        {
          code: "target_alert_slo_dry_run_input_unreadable",
          severity: "blocker",
          safeDetailCode: "target_alert_slo_dry_run_input_unreadable",
        },
      ]);
      expect(JSON.stringify(report)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safely when operator input schema is invalid", async () => {
    const report = await runTargetEnvironmentAlertSloDryRun({
      checkedAtIso: "2026-07-06T00:00:00.000Z",
      input: {
        ...validAlertSloDryRunInput(),
        dashboards: "not-an-array",
      },
    });

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      {
        code: "target_alert_slo_dry_run_input_invalid_schema",
        severity: "blocker",
        safeDetailCode: "target_alert_slo_dry_run_input_invalid_schema",
      },
    ]);
  });

  it("ignores ambient input path env vars unless env is explicitly supplied", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-alert-slo-"));
    const previousInputPath = process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH;

    try {
      const inputPath = join(root, "alert-slo-dry-run-input.json");
      await writeJson(inputPath, validAlertSloDryRunInput("failed"));
      process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH = inputPath;

      const report = await runTargetEnvironmentAlertSloDryRun({
        checkedAtIso: "2026-07-06T00:00:00.000Z",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual([
        {
          code: "target_alert_slo_dry_run_input_missing",
          severity: "warning",
          safeDetailCode: "target_alert_slo_dry_run_not_supplied",
        },
      ]);
    } finally {
      restoreEnv("OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH", previousInputPath);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a safe write failure when the report path cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-alert-slo-"));

    try {
      const blockedFile = join(root, "existing-file");
      await writeFile(blockedFile, "not a directory", "utf8");

      const result = await writeTargetEnvironmentAlertSloDryRunReport(
        validAlertSloDryRunInput(),
        join(blockedFile, "alert-slo-dry-run.json"),
      );

      expect(result).toEqual({
        ok: false,
        safeErrorCode: "target_alert_slo_dry_run_report_write_failed",
      });
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("existing-file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function validAlertSloDryRunInput(status: "passed" | "failed" = "passed") {
  return {
    status,
    checkedAtIso: "2026-07-06T00:00:00.000Z",
    dashboards: [
      {
        dashboardId: "operations-dashboard-reviewed",
        accessible: true,
        panelCount: 8,
      },
    ],
    alertRoutes: [
      {
        alertId: "api-latency-alert-reviewed",
        routeChecked: true,
        notificationDryRun: true,
        receiverClass: "pager-duty-class-reviewed",
      },
    ],
    sloWindows: [
      {
        area: "api-availability",
        windowChecked: true,
        budgetPolicyChecked: true,
      },
    ],
    findings: [],
  };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }

  process.env[name] = value;
}
