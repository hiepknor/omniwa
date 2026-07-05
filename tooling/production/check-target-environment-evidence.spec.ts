import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
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
        ]),
      );
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

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
