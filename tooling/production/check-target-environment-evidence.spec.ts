import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTargetEnvironmentAlertSloDryRunInputTemplate,
  createTargetEnvironmentEvidenceBundleTemplate,
  createTargetEnvironmentFixture,
  createTargetEnvironmentRuntimeEvidenceInputTemplate,
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

  it("ignores ambient artifact path env vars when artifact paths are not explicitly provided", async () => {
    const root = await createTempProject();
    const previousSmokePath = process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH;
    const previousLoadPath = process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH;
    const previousAlertSloPath = process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH;
    const previousRuntimePath = process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH;
    const previousBundlePath = process.env.OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH;

    try {
      process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH = "artifacts/target-env/smoke-report.json";
      process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH = "artifacts/target-env/load-report.json";
      process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH =
        "artifacts/target-env/alert-slo-dry-run.json";
      process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH =
        "artifacts/target-env/runtime-evidence.json";
      process.env.OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH =
        "artifacts/target-env/evidence-bundle.json";

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
      restoreEnv("OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH", previousSmokePath);
      restoreEnv("OMNIWA_TARGET_ENV_LOAD_REPORT_PATH", previousLoadPath);
      restoreEnv("OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH", previousAlertSloPath);
      restoreEnv("OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH", previousRuntimePath);
      restoreEnv("OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH", previousBundlePath);
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
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_artifact_path_missing",
          }),
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_command_missing",
          }),
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_input_path_missing",
          }),
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_path_missing",
          }),
          expect.objectContaining({ code: "target_environment_runtime_command_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_command_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_output_path_missing" }),
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

  it("fails when PROVEN target-environment review is not backed by an evidence bundle artifact", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "PROVEN");

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "proven_target_environment_requires_evidence_bundle",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires target-environment proof for the background runtime", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeText(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
        targetEnvironmentReviewWithoutComponent("NOT_PROVEN", "Background Runtime"),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_component_missing",
            target: "Background Runtime",
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
          expect.objectContaining({
            code: "root_target_environment_alert_slo_dry_run_script_missing",
            target: "target-env:alert-slo",
          }),
          expect.objectContaining({
            code: "root_target_environment_runtime_script_missing",
            target: "target-env:runtime",
          }),
          expect.objectContaining({
            code: "root_target_environment_bundle_script_missing",
            target: "target-env:bundle",
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

  it("fails when the target-environment alert/SLO dry-run input template is missing", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await rm(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json"),
        {
          force: true,
        },
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_evidence_missing",
            target: "docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json",
          }),
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_input_template_unreadable",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment alert/SLO dry-run input template claims proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json"),
        validAlertSloDryRunArtifact(),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_input_template_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment alert/SLO dry-run input template contains unsafe details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json"),
        {
          ...createTargetEnvironmentAlertSloDryRunInputTemplate(),
          dashboardUrl: "https://target.example.invalid/dashboard",
        },
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_input_template_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment runtime evidence input template is missing", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await rm(join(root, "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json"), {
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
            target: "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json",
          }),
          expect.objectContaining({
            code: "target_environment_runtime_evidence_input_template_unreadable",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment runtime evidence input template claims proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json"),
        validRuntimeEvidenceArtifact(),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_input_template_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment runtime evidence input template contains unsafe details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json"),
        {
          ...createTargetEnvironmentRuntimeEvidenceInputTemplate(),
          runtimeUrl: "https://target.example.invalid/runtime",
        },
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_input_template_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
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
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_artifact_path_missing",
          }),
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_path_missing",
          }),
          expect.objectContaining({ code: "target_environment_runtime_command_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_artifact_path_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_command_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_output_path_missing" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates optional sanitized smoke, load, alert/SLO, runtime, and evidence bundle artifacts when paths are provided", async () => {
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
      await writeJson(
        join(root, "artifacts/target-env/evidence-bundle.json"),
        validEvidenceBundleArtifact(),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        loadReportPath: "artifacts/target-env/load-report.json",
        alertSloDryRunReportPath: "artifacts/target-env/alert-slo-dry-run.json",
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
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

  it("fails when an optional evidence bundle claims proof beyond the review state", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(
        join(root, "artifacts/target-env/evidence-bundle.json"),
        validEvidenceBundleArtifact("PROVEN"),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        evidenceBundlePath: "artifacts/target-env/evidence-bundle.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_review_status_mismatch",
          }),
          expect.objectContaining({
            code: "target_environment_bundle_review_target_proof_mismatch",
          }),
          expect.objectContaining({
            code: "target_environment_bundle_review_load_proof_mismatch",
          }),
          expect.objectContaining({
            code: "target_environment_bundle_review_slo_proof_mismatch",
          }),
          expect.objectContaining({
            code: "target_environment_bundle_review_component_status_mismatch",
            target: "API Runtime",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when optional evidence bundle component states drift from the review matrix", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeText(
        join(root, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
        targetEnvironmentReviewWithComponentStatus("NOT_PROVEN", "API Runtime", "FAIL"),
      );
      await writeJson(
        join(root, "artifacts/target-env/evidence-bundle.json"),
        validEvidenceBundleArtifact(),
      );

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        evidenceBundlePath: "artifacts/target-env/evidence-bundle.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_review_component_status_mismatch",
            target: "API Runtime",
          }),
        ]),
      );
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

  it("fails safe when optional alert/SLO dry-run artifact schema is invalid", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/alert-slo-dry-run.json"), {
        ...validAlertSloDryRunArtifact(),
        dashboards: undefined,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        alertSloDryRunReportPath: "artifacts/target-env/alert-slo-dry-run.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when optional runtime evidence artifact schema is invalid", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), {
        ...validRuntimeEvidenceArtifact(),
        backupRestore: undefined,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when optional runtime evidence omits provider command bridge proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), {
        ...validRuntimeEvidenceArtifact(),
        providerCommandBridge: undefined,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when optional runtime evidence omits observability signal proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), {
        ...validRuntimeEvidenceArtifact(),
        observabilitySignals: undefined,
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when optional runtime evidence omits a provider command bridge proof ref", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      const artifact = validRuntimeEvidenceArtifact() as {
        providerCommandBridge: Record<string, unknown>;
      };
      delete artifact.providerCommandBridge.roundTripProofRef;
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), artifact);

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when optional runtime evidence omits a queue backlog metric proof ref", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      const artifact = validRuntimeEvidenceArtifact() as {
        observabilitySignals: Record<string, unknown>;
      };
      delete artifact.observabilitySignals.queueBacklogMetricsProofRef;
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), artifact);

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_invalid_schema",
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

  it("fails safe when optional alert/SLO dry-run artifact contains unsafe deployment details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/alert-slo-dry-run.json"), {
        ...validAlertSloDryRunArtifact(),
        dashboardUrl: "https://target.example.invalid/dashboards/api",
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        alertSloDryRunReportPath: "artifacts/target-env/alert-slo-dry-run.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_alert_slo_dry_run_artifact_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when optional runtime evidence artifact contains unsafe deployment details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/runtime-evidence.json"), {
        ...validRuntimeEvidenceArtifact(),
        deploymentUrl: "https://target.example.invalid/runtime",
      });

      const report = await evaluateTargetEnvironmentEvidence({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
        runtimeEvidenceReportPath: "artifacts/target-env/runtime-evidence.json",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_runtime_evidence_artifact_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
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

  it("fails safe when a PROVEN evidence bundle still has pending refs or missing summaries", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "PROVEN");
      const bundle = validEvidenceBundleArtifact("PROVEN") as {
        evidence: Record<string, string>;
        artifacts: Record<string, Record<string, unknown>>;
      };
      bundle.evidence.providerCommandBridgeRef =
        "operator-evidence-provider-command-bridge-pending";
      delete bundle.artifacts.runtimeEvidence.summary;
      await writeJson(join(root, "artifacts/target-env/evidence-bundle.json"), bundle);

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
    "- `pnpm target-env:alert-slo` with `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH` and `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`.",
    "- `pnpm target-env:runtime` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH` and `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
    "- `pnpm target-env:bundle` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH`.",
    "",
    "## Known Constraints",
    "",
    "- Fixture constraints recorded.",
    "",
  ].join("\n");
}

function targetEnvironmentReviewWithoutComponent(
  status: "NOT_PROVEN" | "PARTIAL" | "PROVEN",
  componentToOmit: string,
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
    ...requiredTargetEnvironmentComponents
      .filter((component) => component !== componentToOmit)
      .map((component) => `| ${component} | PENDING | Fixture evidence. |`),
    "",
    "## Validation Commands",
    "",
    "- `pnpm check`",
    "- `pnpm target-env:smoke` with `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH`.",
    "- `pnpm target-env:load` with `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH`.",
    "- `pnpm target-env:alert-slo` with `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH` and `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`.",
    "- `pnpm target-env:runtime` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH` and `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
    "- `pnpm target-env:bundle` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH`.",
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
      startupProofRef: "provider-command-bridge-startup-reviewed",
      workerClientProofRef: "provider-command-bridge-worker-client-reviewed",
      providerRuntimeServerProofRef: "provider-command-bridge-server-reviewed",
      authenticationProofRef: "provider-command-bridge-authentication-reviewed",
      roundTripProofRef: "provider-command-bridge-round-trip-reviewed",
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

function validEvidenceBundleArtifact(status: "NOT_PROVEN" | "PROVEN" = "NOT_PROVEN"): unknown {
  const proven = status === "PROVEN";

  return {
    version: 1,
    status,
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    proofStates: {
      targetEnvironmentProven: proven,
      productionLoadProven: proven,
      sloEvidenceProven: proven,
    },
    evidence: {
      deploymentProfileRef: "deployment-profile-reviewed",
      runtimeVersionsRef: "runtime-versions-reviewed",
      startupSummaryRef: "startup-summary-reviewed",
      healthReadinessRef: "health-readiness-reviewed",
      dependencyConnectivityRef: "dependency-connectivity-reviewed",
      providerCommandBridgeRef: "provider-command-bridge-reviewed",
      backupRestoreDrillRef: "backup-restore-drill-reviewed",
      productionLoadSummaryRef: "production-load-summary-reviewed",
      alertSloDryRunRef: "alert-slo-dry-run-reviewed",
      rollbackOrForwardFixNotesRef: "rollback-forward-fix-reviewed",
    },
    components: requiredTargetEnvironmentComponents.map((component) => ({
      component,
      status: proven ? "PASS" : "PENDING",
      evidenceRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-${proven ? "pass" : "pending"}`,
    })),
    artifacts: {
      smoke: {
        artifactRef: "smoke-report-reviewed",
        status: "passed",
        ...(proven ? { summary: validSmokeArtifact() } : {}),
      },
      load: {
        artifactRef: "load-report-reviewed",
        status: "passed",
        ...(proven ? { summary: validLoadArtifact() } : {}),
      },
      alertSloDryRun: {
        artifactRef: "alert-slo-dry-run-reviewed",
        status: "passed",
        ...(proven ? { summary: validAlertSloDryRunArtifact() } : {}),
      },
      runtimeEvidence: {
        artifactRef: "runtime-evidence-reviewed",
        status: "passed",
        ...(proven ? { summary: validRuntimeEvidenceArtifact() } : {}),
      },
    },
    findings: [],
  };
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
