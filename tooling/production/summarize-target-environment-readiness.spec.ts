import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTargetEnvironmentEvidenceBundleTemplate,
  createTargetEnvironmentFixture,
  requiredTargetEnvironmentComponents,
} from "./check-target-environment-evidence.mjs";
import { summarizeTargetEnvironmentReadiness } from "./summarize-target-environment-readiness.mjs";

describe("target environment readiness summary", () => {
  it("summarizes the current not-ready state without exposing target secrets", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const summary = await summarizeTargetEnvironmentReadiness({
        projectRoot: root,
        checkedAtIso: "2026-07-06T00:00:00.000Z",
        env: {
          OMNIWA_TARGET_ENV_API_KEY: "target-credential-api-key",
          OMNIWA_TARGET_ENV_BASE_URL: "https://api.prod.example",
        },
      });

      expect(summary.status).toBe("not_ready");
      expect(summary.review).toMatchObject({
        status: "NOT_PROVEN",
        proofStates: {
          targetEnvironmentProven: "NO",
          productionLoadProven: "NO",
          sloEvidenceProven: "NO",
        },
      });
      expect(summary.review.components).toMatchObject({
        total: requiredTargetEnvironmentComponents.length,
        pending: requiredTargetEnvironmentComponents.length,
        pass: 0,
      });
      expect(summary.artifacts).toEqual(
        expect.arrayContaining([
          {
            kind: "smoke",
            envVar: "OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH",
            supplied: false,
          },
          {
            kind: "evidence_bundle",
            envVar: "OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH",
            supplied: false,
          },
        ]),
      );
      expect(summary.gate).toMatchObject({
        status: "passed",
        blockerCount: 0,
      });
      expect(summary.nextActions).toEqual(
        expect.arrayContaining([
          "collect_target_environment_evidence_before_proven_claim",
          "supply_smoke_artifact_when_available",
          "supply_evidence_bundle_artifact_when_available",
        ]),
      );
      expect(JSON.stringify(summary)).not.toContain("target-credential-api-key");
      expect(JSON.stringify(summary)).not.toContain("https://api.prod.example");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks a proven review when no sanitized evidence bundle is supplied", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "PROVEN");

      const summary = await summarizeTargetEnvironmentReadiness({
        projectRoot: root,
        checkedAtIso: "2026-07-06T00:00:00.000Z",
      });

      expect(summary.status).toBe("blocked");
      expect(summary.review.status).toBe("PROVEN");
      expect(summary.review.components.pass).toBe(requiredTargetEnvironmentComponents.length);
      expect(summary.gate.blockerCodes).toContain(
        "proven_target_environment_requires_evidence_bundle",
      );
      expect(summary.nextActions).toEqual(
        expect.arrayContaining([
          "resolve_target_env_check_blockers",
          "supply_evidence_bundle_artifact_when_available",
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports ready_for_production_cut_review when proven review and bundle agree", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "PROVEN");
      const bundlePath = join(root, "artifacts", "target-env", "bundle.json");
      await writeJson(bundlePath, provenEvidenceBundle());

      const summary = await summarizeTargetEnvironmentReadiness({
        projectRoot: root,
        checkedAtIso: "2026-07-06T00:00:00.000Z",
        evidenceBundlePath: bundlePath,
      });

      expect(summary.status).toBe("ready_for_production_cut_review");
      expect(summary.gate).toMatchObject({
        status: "passed",
        blockerCount: 0,
      });
      expect(summary.nextActions).toEqual([]);
      expect(JSON.stringify(summary)).not.toContain(bundlePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject() {
  return mkdtemp(join(tmpdir(), "omniwa-target-readiness-summary-"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function provenEvidenceBundle() {
  const template = createTargetEnvironmentEvidenceBundleTemplate();

  return {
    ...template,
    status: "PROVEN",
    checkedAtIso: "2026-07-06T00:00:00.000Z",
    proofStates: {
      targetEnvironmentProven: true,
      productionLoadProven: true,
      sloEvidenceProven: true,
    },
    evidence: Object.fromEntries(
      Object.keys(template.evidence).map((key) => [key, `operator-evidence-${key}-reviewed`]),
    ),
    components: requiredTargetEnvironmentComponents.map((component) => ({
      component,
      status: "PASS",
      evidenceRef: `operator-evidence-${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-reviewed`,
    })),
    artifacts: {
      smoke: {
        artifactRef: "target-env-smoke-report-reviewed",
        status: "passed",
        summary: smokeSummary(),
      },
      load: {
        artifactRef: "target-env-load-report-reviewed",
        status: "passed",
        summary: loadSummary(),
      },
      alertSloDryRun: {
        artifactRef: "target-env-alert-slo-report-reviewed",
        status: "passed",
        summary: alertSloSummary(),
      },
      runtimeEvidence: {
        artifactRef: "target-env-runtime-evidence-reviewed",
        status: "passed",
        summary: runtimeEvidenceSummary(),
      },
    },
    findings: [],
  };
}

function smokeSummary() {
  return {
    status: "passed",
    checkedAtIso: "2026-07-06T00:00:00.000Z",
    endpoints: [
      {
        method: "GET",
        path: "/v1/health",
        ok: true,
        statusCode: 200,
        checkedAtIso: "2026-07-06T00:00:00.000Z",
      },
    ],
    findings: [],
  };
}

function loadSummary() {
  return {
    status: "passed",
    checkedAtIso: "2026-07-06T00:00:00.000Z",
    budgets: {
      requestCount: 120,
      concurrency: 10,
      timeoutMilliseconds: 2000,
      maxP95LatencyMilliseconds: 500,
      minSuccessRatePercent: 99,
    },
    summary: {
      totalRequests: 120,
      successes: 120,
      failures: 0,
      successRatePercent: 100,
      durationMilliseconds: 1200,
      p95LatencyMilliseconds: 120,
      maxLatencyMilliseconds: 180,
    },
    endpoints: [
      {
        method: "GET",
        path: "/v1/instances",
        requests: 120,
        successes: 120,
        failures: 0,
        statusCodeCounts: {
          "200": 120,
        },
        safeErrorCodeCounts: {},
      },
    ],
    findings: [],
  };
}

function alertSloSummary() {
  return {
    status: "passed",
    checkedAtIso: "2026-07-06T00:00:00.000Z",
    dashboards: [
      {
        dashboardId: "dashboard-reviewed",
        accessible: true,
        panelCount: 8,
      },
    ],
    alertRoutes: [
      {
        alertId: "alert-route-reviewed",
        routeChecked: true,
        notificationDryRun: true,
        receiverClass: "internal-ops",
      },
    ],
    sloWindows: [
      {
        area: "api-runtime",
        windowChecked: true,
        budgetPolicyChecked: true,
      },
    ],
    findings: [],
  };
}

function runtimeEvidenceSummary() {
  return {
    status: "passed",
    checkedAtIso: "2026-07-06T00:00:00.000Z",
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
      {
        dependency: "Redis",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
      },
    ],
    providerCommandBridge: {
      workerConfigured: true,
      providerRuntimeServerConfigured: true,
      authenticationBoundaryChecked: true,
      commandRoundTripChecked: true,
      startupProofRef: "bridge-startup-reviewed",
      workerClientProofRef: "bridge-worker-client-reviewed",
      providerRuntimeServerProofRef: "bridge-provider-runtime-server-reviewed",
      authenticationProofRef: "bridge-authentication-reviewed",
      roundTripProofRef: "bridge-round-trip-reviewed",
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
    credentialBoundary: {
      providerSelectionChecked: true,
      platformCredentialSourceChecked: true,
      deliverySigningCredentialChecked: true,
      baileysStateEncryptionChecked: true,
      rotationProcedureChecked: true,
      credentialProviderProofRef: "credential-boundary-selection-reviewed",
      platformCredentialProofRef: "platform-credential-source-reviewed",
      deliverySigningProofRef: "delivery-signing-credential-reviewed",
      baileysStateEncryptionProofRef: "baileys-state-encryption-reviewed",
      rotationProcedureProofRef: "credential-rotation-procedure-reviewed",
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
    },
    findings: [],
  };
}
