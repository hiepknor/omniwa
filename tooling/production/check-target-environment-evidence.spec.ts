import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTargetEnvironmentEvidenceBundleTemplate,
  createTargetEnvironmentFixture,
  evaluateTargetEnvironmentEvidence,
  requiredTargetEnvironmentComponents,
  requiredTargetEnvironmentEvidenceTests,
} from "./check-target-environment-evidence.mjs";

describe("target environment evidence gate", () => {
  it("passes when target-environment evidence is explicit but not yet proven", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report).toEqual({
        status: "passed",
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        findings: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when target-environment evidence is incomplete", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeText(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
        "# Target Environment Validation\n\nTarget Environment Validation Status: TBD\n",
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "target_environment_status_missing_or_invalid" }),
          expect.objectContaining({ code: "target_environment_proof_state_missing" }),
          expect.objectContaining({ code: "production_load_proof_state_missing" }),
          expect.objectContaining({ code: "slo_evidence_proof_state_missing" }),
          expect.objectContaining({ code: "target_environment_component_missing" }),
          expect.objectContaining({ code: "target_environment_validation_commands_missing" }),
          expect.objectContaining({ code: "target_environment_smoke_command_missing" }),
          expect.objectContaining({ code: "target_environment_smoke_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_load_command_missing" }),
          expect.objectContaining({ code: "target_environment_load_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_known_constraints_missing" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when PROVEN is claimed before every component passes", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "PROVEN");
      await writeText(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
        targetEnvironmentReviewWithComponentStatus("PROVEN", "Worker Runtime", "PENDING"),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "proven_component_must_pass",
            target: "Worker Runtime",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when root scripts do not run the target-environment gate", async () => {
    const root = await createTempProject();
    const missingTest = requiredTargetEnvironmentEvidenceTests[0];

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "package.json"), {
        name: "omniwa-target-environment-fixture",
        private: true,
        type: "module",
        scripts: {
          "target-env:check": "vitest run --passWithNoTests",
          "production:check": "node tooling/production/check-production-cut.mjs",
          check: "pnpm lint && pnpm production:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_evidence_test_missing",
            target: missingTest,
          }),
          expect.objectContaining({ code: "root_target_environment_script_missing_tooling_gate" }),
          expect.objectContaining({
            code: "root_target_environment_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_target_environment_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "root_target_environment_smoke_script_missing",
            target: "target-env:smoke",
          }),
          expect.objectContaining({
            code: "root_target_environment_load_script_missing",
            target: "target-env:load",
          }),
          expect.objectContaining({ code: "production_script_missing_target_environment_gate" }),
          expect.objectContaining({ code: "check_script_missing_target_environment_gate" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment evidence bundle template is missing", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await rm(join(root, "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json"), {
        force: true,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_evidence_missing",
            target: "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json",
          }),
          expect.objectContaining({
            code: "target_environment_bundle_template_unreadable",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment evidence bundle template claims proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json"), {
        ...createTargetEnvironmentEvidenceBundleTemplate(),
        status: "PROVEN",
        proofStates: {
          targetEnvironmentProven: true,
          productionLoadProven: true,
          sloEvidenceProven: true,
        },
        components: requiredTargetEnvironmentComponents.map((component) => ({
          component,
          status: "PASS",
          evidenceRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-proven`,
        })),
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
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

  it("fails when operator smoke/load artifact instructions are missing from the review", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeText(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
        [
          "# Target Environment Validation",
          "",
          "Target Environment Validation Status: NOT_PROVEN",
          "",
          "Target Environment Proven: NO",
          "",
          "Production Load Proven: NO",
          "",
          "SLO Evidence Proven: NO",
          "",
          "## Runtime Evidence Matrix",
          "",
          "| Component | Status | Evidence |",
          "| --- | --- | --- |",
          ...requiredTargetEnvironmentComponents.map(
            (component) => `| ${component} | PENDING | Fixture evidence. |`,
          ),
          "",
          "## Validation Commands",
          "",
          "- `pnpm check`",
          "",
          "## Known Constraints",
          "",
          "- Fixture constraints recorded.",
          "",
        ].join("\n"),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "target_environment_smoke_command_missing" }),
          expect.objectContaining({ code: "target_environment_smoke_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_load_command_missing" }),
          expect.objectContaining({ code: "target_environment_load_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_artifact_path_missing" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates optional sanitized smoke, load, and evidence bundle artifacts when paths are provided", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), validSmokeArtifact());
      await writeJson(join(root, "artifacts/target-env/load-report.json"), validLoadArtifact());
      await writeJson(
        join(root, "artifacts/target-env/evidence-bundle.json"),
        validEvidenceBundleArtifact(),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        loadReportPath: "artifacts/target-env/load-report.json",
        evidenceBundlePath: "artifacts/target-env/evidence-bundle.json",
      });

      expect(report).toEqual({
        status: "passed",
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        findings: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when an optional artifact path is provided but unreadable", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        smokeReportPath: "artifacts/target-env/missing-smoke-report.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_smoke_artifact_unreadable",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("missing-smoke-report");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when an optional artifact is invalid JSON", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeText(join(root, "artifacts/target-env/smoke-report.json"), "{not-json");

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        smokeReportPath: "artifacts/target-env/smoke-report.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_smoke_artifact_invalid_json",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when optional artifact schema is invalid", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/load-report.json"), {
        ...validLoadArtifact(),
        summary: undefined,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        loadReportPath: "artifacts/target-env/load-report.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_load_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when optional artifacts contain unsafe deployment details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), {
        ...validSmokeArtifact(),
        baseUrl: "https://target.example.invalid",
        apiKey: "local-dev-secret-change-me",
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        smokeReportPath: "artifacts/target-env/smoke-report.json",
      });

      expect(report.status).toBe("failed");
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

  it("fails safe when optional evidence bundle schema is invalid", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/evidence-bundle.json"), {
        ...validEvidenceBundleArtifact(),
        components: [],
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        evidenceBundlePath: "artifacts/target-env/evidence-bundle.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when optional evidence bundle contains unsafe content", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/evidence-bundle.json"), {
        ...validEvidenceBundleArtifact(),
        apiKey: "local-dev-secret-change-me",
        startupSummaryUrl: "https://target.example.invalid/startup",
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        evidenceBundlePath: "artifacts/target-env/evidence-bundle.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_artifact_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
      expect(JSON.stringify(report)).not.toContain("local-dev-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function targetEnvironmentReviewWithComponentStatus(
  status: "NOT_PROVEN" | "PARTIAL" | "PROVEN",
  componentToChange: string,
  componentStatus: string,
): string {
  const proofValue = status === "PROVEN" ? "YES" : "NO";

  return [
    "# Target Environment Validation",
    "",
    `Target Environment Validation Status: ${status}`,
    "",
    `Target Environment Proven: ${proofValue}`,
    "",
    `Production Load Proven: ${proofValue}`,
    "",
    `SLO Evidence Proven: ${proofValue}`,
    "",
    "## Runtime Evidence Matrix",
    "",
    "| Component | Status | Evidence |",
    "| --- | --- | --- |",
    ...requiredTargetEnvironmentComponents.map((component) => {
      const rowStatus = component === componentToChange ? componentStatus : "PASS";

      return `| ${component} | ${rowStatus} | Fixture evidence. |`;
    }),
    "",
    "## Validation Commands",
    "",
    "- `pnpm check`",
    "- `pnpm target-env:smoke` with `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH`.",
    "- `pnpm target-env:load` with `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
    "",
    "## Known Constraints",
    "",
    "- Fixture constraints recorded.",
    "",
  ].join("\n");
}

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-target-env-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

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

function validEvidenceBundleArtifact(): unknown {
  return {
    version: 1,
    status: "NOT_PROVEN",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    proofStates: {
      targetEnvironmentProven: false,
      productionLoadProven: false,
      sloEvidenceProven: false,
    },
    evidence: {
      deploymentProfileRef: "deployment-profile-reviewed",
      runtimeVersionsRef: "runtime-versions-reviewed",
      startupSummaryRef: "startup-summary-reviewed",
      healthReadinessRef: "health-readiness-reviewed",
      dependencyConnectivityRef: "dependency-connectivity-reviewed",
      backupRestoreDrillRef: "backup-restore-drill-reviewed",
      productionLoadSummaryRef: "production-load-summary-reviewed",
      alertSloDryRunRef: "alert-slo-dry-run-reviewed",
      rollbackOrForwardFixNotesRef: "rollback-forward-fix-reviewed",
    },
    components: requiredTargetEnvironmentComponents.map((component) => ({
      component,
      status: "PENDING",
      evidenceRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-pending`,
    })),
    artifacts: {
      smoke: {
        artifactRef: "smoke-report-reviewed",
        status: "passed",
      },
      load: {
        artifactRef: "load-report-reviewed",
        status: "passed",
      },
    },
    findings: [],
  };
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
