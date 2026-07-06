import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createProductionCutFixture,
  evaluateProductionCutReadiness,
  requiredProductionEvidenceTests,
} from "./check-production-cut.mjs";

describe("production cut gate check", () => {
  it("passes when production cut evidence, load tests, and root scripts are wired", async () => {
    const root = await createTempProject();

    try {
      await createProductionCutFixture(root);

      const report = await evaluateProductionCutReadiness({
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

  it("fails when production cut decision evidence is incomplete", async () => {
    const root = await createTempProject();

    try {
      await createProductionCutFixture(root);
      await writeText(
        join(root, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
        "# Production Cut Review\n\nFinal readiness decision: TBD\n",
      );

      const report = await evaluateProductionCutReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "production_cut_decision_missing_or_invalid" }),
          expect.objectContaining({ code: "production_ready_state_missing" }),
          expect.objectContaining({ code: "enterprise_ready_state_missing" }),
          expect.objectContaining({ code: "target_environment_proof_state_missing" }),
          expect.objectContaining({ code: "production_load_proof_state_missing" }),
          expect.objectContaining({ code: "slo_evidence_proof_state_missing" }),
          expect.objectContaining({ code: "load_baseline_summary_missing" }),
          expect.objectContaining({ code: "target_environment_smoke_summary_missing" }),
          expect.objectContaining({ code: "target_environment_load_summary_missing" }),
          expect.objectContaining({ code: "target_environment_bundle_summary_missing" }),
          expect.objectContaining({ code: "target_environment_runtime_summary_missing" }),
          expect.objectContaining({ code: "gate_2_review_missing" }),
          expect.objectContaining({ code: "known_constraints_missing" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when root scripts omit the load or production gates", async () => {
    const root = await createTempProject();
    const missingTest = requiredProductionEvidenceTests[0];

    try {
      await createProductionCutFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-production-cut-fixture",
        private: true,
        type: "module",
        scripts: {
          "load:check":
            "vitest run --passWithNoTests tooling/production/check-production-cut.spec.ts",
          "production:check": "pnpm test",
          "target-env:check": "node tooling/production/check-target-environment-evidence.mjs",
          "target-env:load": "node tooling/performance/run-target-environment-load.mjs",
          check: "pnpm regression:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateProductionCutReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_production_script_missing",
            target: "target-env:bundle",
          }),
          expect.objectContaining({
            code: "root_production_script_missing",
            target: "target-env:smoke",
          }),
          expect.objectContaining({
            code: "root_production_script_missing",
            target: "target-env:runtime",
          }),
          expect.objectContaining({ code: "production_script_missing_cut_checker" }),
          expect.objectContaining({ code: "production_script_missing_load_gate" }),
          expect.objectContaining({ code: "load_script_must_not_pass_with_no_tests" }),
          expect.objectContaining({ code: "load_script_missing_test", target: missingTest }),
          expect.objectContaining({
            code: "production_evidence_test_missing",
            target: missingTest,
          }),
          expect.objectContaining({ code: "check_script_missing_production_gate" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the production ready state conflicts with the readiness decision", async () => {
    const root = await createTempProject();

    try {
      await createProductionCutFixture(root);
      await writeText(
        join(root, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
        [
          "# Production Cut Review",
          "",
          "Final readiness decision: PRODUCTION_READY",
          "",
          "Production Ready: NO",
          "",
          "Enterprise Ready: NO",
          "",
          "## Load baseline",
          "",
          "Recorded.",
          "",
          "## Target environment smoke",
          "",
          "pnpm target-env:smoke tooling present.",
          "",
          "## Target environment load",
          "",
          "pnpm target-env:load tooling present.",
          "",
          "## Target environment runtime evidence",
          "",
          "pnpm target-env:runtime tooling present.",
          "",
          "## Target environment bundle",
          "",
          "pnpm target-env:bundle tooling present.",
          "",
          "## Gate 2 Review",
          "",
          "Recorded.",
          "",
          "## Known Constraints",
          "",
          "Recorded.",
          "",
        ].join("\n"),
      );

      const report = await evaluateProductionCutReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "production_ready_state_inconsistent" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when production ready is claimed without target-environment evidence", async () => {
    const root = await createTempProject();

    try {
      await createProductionCutFixture(root);
      await writeText(
        join(root, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
        [
          "# Production Cut Review",
          "",
          "Final readiness decision: PRODUCTION_READY",
          "",
          "Production Ready: YES",
          "",
          "Enterprise Ready: NO",
          "",
          "Target Environment Proven: NO",
          "",
          "Production Load Proven: NO",
          "",
          "SLO Evidence Proven: NO",
          "",
          "## Load baseline",
          "",
          "Recorded.",
          "",
          "## Target environment smoke",
          "",
          "pnpm target-env:smoke tooling present.",
          "",
          "## Target environment load",
          "",
          "pnpm target-env:load tooling present.",
          "",
          "## Target environment runtime evidence",
          "",
          "pnpm target-env:runtime tooling present.",
          "",
          "## Target environment bundle",
          "",
          "pnpm target-env:bundle tooling present.",
          "",
          "## Gate 2 Review",
          "",
          "Recorded.",
          "",
          "## Known Constraints",
          "",
          "Recorded.",
          "",
        ].join("\n"),
      );

      const report = await evaluateProductionCutReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "production_ready_target_environment_not_proven" }),
          expect.objectContaining({ code: "production_ready_load_not_proven" }),
          expect.objectContaining({ code: "production_ready_slo_evidence_not_proven" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-production-cut-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
