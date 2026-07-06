import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTargetEnvironmentEvidenceBundle,
  targetEnvironmentEvidenceBundleTemplateForTests,
} from "./create-target-environment-evidence-bundle.mjs";
import {
  createTargetEnvironmentFixture,
  requiredTargetEnvironmentComponents,
  validateTargetEnvironmentEvidenceBundleArtifact,
} from "./check-target-environment-evidence.mjs";

type GeneratedBundle = Readonly<{
  status: string;
  checkedAtIso: string;
  proofStates: Readonly<Record<string, boolean>>;
  evidence: Readonly<Record<string, string>>;
  artifacts: Readonly<{
    smoke: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
    load: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
    alertSloDryRun: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
    runtimeEvidence: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
  }>;
}>;

describe("target environment evidence bundle generator", () => {
  it("creates a sanitized NOT_PROVEN bundle from the checked-in template", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report).toEqual({
        status: "passed",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        findings: [],
        written: true,
      });

      const bundle = await readJson(join(root, "artifacts/target-env/evidence-bundle.json"));
      expect(validateTargetEnvironmentEvidenceBundleArtifact(bundle)).toBe(true);
      expect(bundle).toMatchObject({
        status: "NOT_PROVEN",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        proofStates: {
          targetEnvironmentProven: false,
          productionLoadProven: false,
          sloEvidenceProven: false,
        },
      });
      expect(bundle.components).toContainEqual({
        component: "Background Runtime",
        status: "PENDING",
        evidenceRef: "operator-evidence-background-runtime-pending",
      });
      expect(bundle.evidence.providerCommandBridgeRef).toBe(
        "operator-evidence-provider-command-bridge-pending",
      );
      expect(JSON.stringify(bundle)).not.toContain("http://");
      expect(JSON.stringify(bundle)).not.toContain("https://");
      expect(JSON.stringify(bundle)).not.toContain("local-dev-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores ambient artifact path env vars when artifact paths are not explicitly provided", async () => {
    const root = await createTempProject();
    const previousSmokePath = process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH;
    const previousLoadPath = process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH;
    const previousRuntimePath = process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH;

    try {
      process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH = "artifacts/target-env/smoke-report.json";
      process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH = "artifacts/target-env/load-report.json";
      process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH =
        "artifacts/target-env/runtime-evidence.json";

      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report).toEqual({
        status: "passed",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        findings: [],
        written: true,
      });
    } finally {
      restoreEnv("OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH", previousSmokePath);
      restoreEnv("OMNIWA_TARGET_ENV_LOAD_REPORT_PATH", previousLoadPath);
      restoreEnv("OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH", previousRuntimePath);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("embeds validated smoke, load, alert/SLO, and runtime summaries without raw target details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), validSmokeArtifact());
      await writeJson(join(root, "artifacts/target-env/load-report.json"), validLoadArtifact());
      await writeJson(
        join(root, "artifacts/target-env/alert-slo-dry-run.json"),
        validAlertSloDryRunArtifact(),
      );
      await writeJson(
        join(root, "artifacts/target-env/runtime-evidence.json"),
        validRuntimeEvidenceArtifact(),
      );

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        loadReportPath: "artifacts/target-env/load-report.json",
        alertSloDryRunReportPath: "artifacts/target-env/alert-slo-dry-run.json",
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
        smokeArtifactRef: "operator-smoke-artifact-ref",
        loadArtifactRef: "operator-load-artifact-ref",
        alertSloDryRunArtifactRef: "operator-alert-slo-artifact-ref",
        runtimeEvidenceArtifactRef: "operator-runtime-evidence-artifact-ref",
        providerCommandBridgeEvidenceRef: "operator-provider-command-bridge-proof-ref",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("passed");

      const bundle = await readJson(join(root, "artifacts/target-env/evidence-bundle.json"));
      expect(bundle.artifacts.smoke).toMatchObject({
        artifactRef: "operator-smoke-artifact-ref",
        status: "passed",
      });
      expect(bundle.artifacts.load).toMatchObject({
        artifactRef: "operator-load-artifact-ref",
        status: "passed",
      });
      expect(bundle.artifacts.alertSloDryRun).toMatchObject({
        artifactRef: "operator-alert-slo-artifact-ref",
        status: "passed",
      });
      expect(bundle.artifacts.runtimeEvidence).toMatchObject({
        artifactRef: "operator-runtime-evidence-artifact-ref",
        status: "passed",
      });
      expect(bundle.evidence.providerCommandBridgeRef).toBe(
        "operator-provider-command-bridge-proof-ref",
      );
      expect(bundle.artifacts.smoke.summary).toMatchObject({
        endpoints: [
          {
            method: "GET",
            path: "/v1/health",
            ok: true,
          },
        ],
      });
      expect(bundle.artifacts.load.summary).toMatchObject({
        summary: {
          totalRequests: 60,
          successes: 60,
        },
      });
      expect(bundle.artifacts.alertSloDryRun.summary).toMatchObject({
        dashboards: [
          {
            dashboardId: "api_runtime_overview",
            accessible: true,
          },
        ],
      });
      expect(bundle.artifacts.runtimeEvidence.summary).toMatchObject({
        dependencies: [
          {
            dependency: "PostgreSQL",
            connectivityChecked: true,
          },
        ],
      });
      expect(JSON.stringify(bundle)).not.toContain("x-api-key");
      expect(JSON.stringify(bundle)).not.toContain("@s.whatsapp.net");
      expect(JSON.stringify(bundle)).not.toContain("https://");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe provider-command bridge evidence refs", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const urlReport = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        providerCommandBridgeEvidenceRef: "https://target.example.invalid/provider-bridge-proof",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(urlReport.status).toBe("failed");
      expect(urlReport.written).toBe(false);
      expect(urlReport.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_provider_command_bridge_evidence_ref_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(urlReport)).not.toContain("target.example");

      const pathReport = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        providerCommandBridgeEvidenceRef: "/var/log/provider-bridge-proof.log",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(pathReport.status).toBe("failed");
      expect(pathReport.written).toBe(false);
      expect(pathReport.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_provider_command_bridge_evidence_ref_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(pathReport)).not.toContain("/var/log");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when the output path is missing", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report).toEqual({
        status: "failed",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        findings: [
          {
            code: "target_environment_bundle_output_path_missing",
            severity: "blocker",
            safeDetailCode: "target_environment_bundle_output_path_missing",
          },
        ],
        written: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe smoke artifact content without writing the bundle", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), {
        ...validSmokeArtifact(),
        baseUrl: "https://target.example.invalid",
        apiKey: "local-dev-secret-change-me",
      });

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("failed");
      expect(report.written).toBe(false);
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_smoke_artifact_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
      expect(JSON.stringify(report)).not.toContain("local-dev-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a template that claims target-environment proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json"), {
        ...targetEnvironmentEvidenceBundleTemplateForTests(),
        status: "PROVEN",
        proofStates: {
          targetEnvironmentProven: true,
          productionLoadProven: true,
          sloEvidenceProven: true,
        },
      });

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_template_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function validSmokeArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    endpoints: [
      {
        method: "GET",
        path: "/v1/health",
        ok: true,
        statusCode: 200,
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      },
    ],
    findings: [],
  };
}

function validLoadArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    budgets: {
      requestCount: 60,
      concurrency: 5,
      timeoutMilliseconds: 10_000,
      maxP95LatencyMilliseconds: 2_000,
      minSuccessRatePercent: 100,
    },
    summary: {
      totalRequests: 60,
      successes: 60,
      failures: 0,
      successRatePercent: 100,
      durationMilliseconds: 500,
      p95LatencyMilliseconds: 50,
      maxLatencyMilliseconds: 80,
    },
    endpoints: [
      {
        method: "GET",
        path: "/v1/health",
        requests: 60,
        successes: 60,
        failures: 0,
        statusCodeCounts: {
          "200": 60,
        },
        safeErrorCodeCounts: {},
      },
    ],
    findings: [],
  };
}

function validAlertSloDryRunArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    dashboards: [
      {
        dashboardId: "api_runtime_overview",
        accessible: true,
        panelCount: 5,
      },
    ],
    alertRoutes: [
      {
        alertId: "api_availability_degraded",
        routeChecked: true,
        notificationDryRun: true,
        receiverClass: "primary_oncall",
      },
    ],
    sloWindows: [
      {
        area: "API availability",
        windowChecked: true,
        budgetPolicyChecked: true,
      },
    ],
    findings: [],
  };
}

function validRuntimeEvidenceArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    runtimes: requiredTargetEnvironmentComponents.map((component) => ({
      component,
      started: true,
      readinessChecked: true,
      shutdownChecked: true,
      versionRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-version-reviewed`,
    })),
    dependencies: [
      {
        dependency: "PostgreSQL",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
        migrationStatusChecked: true,
      },
    ],
    providerCommandBridge: {
      workerConfigured: true,
      providerRuntimeServerConfigured: true,
      authenticationBoundaryChecked: true,
      commandRoundTripChecked: true,
      startupProofRef: "provider-command-bridge-startup-reviewed",
      workerClientProofRef: "provider-command-bridge-worker-client-reviewed",
      providerRuntimeServerProofRef: "provider-command-bridge-server-reviewed",
      authenticationProofRef: "provider-command-bridge-authentication-reviewed",
      roundTripProofRef: "provider-command-bridge-round-trip-reviewed",
    },
    queueRuntime: {
      durableQueueProfileChecked: true,
      atomicReservationChecked: true,
      retryRecoveryChecked: true,
      deadLetterChecked: true,
      expiredLeaseRecoveryChecked: true,
      queueProfileProofRef: "queue-profile-reviewed",
      atomicReservationProofRef: "queue-atomic-reservation-reviewed",
      retryRecoveryProofRef: "queue-retry-recovery-reviewed",
      deadLetterProofRef: "queue-dead-letter-reviewed",
      expiredLeaseRecoveryProofRef: "queue-expired-lease-recovery-reviewed",
    },
    observabilitySignals: {
      metricExporterChecked: true,
      structuredLoggingChecked: true,
      queueBacklogMetricsChecked: true,
      eventLogOutboxMetricsChecked: true,
      redactionChecked: true,
      metricsProofRef: "observability-metrics-reviewed",
      loggingProofRef: "observability-logging-reviewed",
      queueBacklogMetricsProofRef: "queue-backlog-metrics-reviewed",
      eventLogOutboxMetricsProofRef: "eventlog-outbox-metrics-reviewed",
      redactionProofRef: "observability-redaction-reviewed",
    },
    backupRestore: {
      drillRef: "backup-restore-drill-reviewed",
      backupCreated: true,
      restoreValidated: true,
      rollbackOrForwardFixReviewed: true,
      rpoSeconds: 300,
      rtoSeconds: 900,
    },
    findings: [],
  };
}

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-target-env-bundle-"));
}

async function readJson(path: string): Promise<GeneratedBundle> {
  return JSON.parse(await readFile(path, "utf8")) as GeneratedBundle;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }

  process.env[key] = value;
}
