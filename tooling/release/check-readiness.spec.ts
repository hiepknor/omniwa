import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createReadinessFixture,
  evaluateReleaseReadiness,
  requiredFreezeDocuments,
} from "./check-readiness.mjs";

describe("release readiness check", () => {
  it("passes when freeze docs, release evidence, scripts, and manifests are present", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);

      const report = await evaluateReleaseReadiness({
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

  it("fails when release evidence and root release gate are missing", async () => {
    const root = await createTempProject();

    try {
      await writeJson(join(root, "package.json"), {
        name: "omniwa-fixture",
        private: true,
        type: "module",
        packageManager: "pnpm@11.5.2",
        scripts: {
          build: "tsc -b tsconfig.references.json",
          lint: "eslint .",
          typecheck: "tsc -b tsconfig.references.json --pretty false",
          test: "vitest run --passWithNoTests",
          "arch:check": "node tooling/architecture/check-boundaries.mjs",
          "release:check": "node tooling/release/check-readiness.mjs",
          check: "pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check",
        },
      });
      await writeText(join(root, requiredFreezeDocuments[0]), "frozen\n");

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining([
          "freeze_document_missing",
          "release_evidence_missing",
          "release_evidence_test_missing",
          "check_script_missing_release_gate",
          "check_script_missing_openapi_compat_gate",
          "check_script_missing_sdk_test_gate",
          "check_script_missing_observability_gate",
          "check_script_missing_slo_gate",
          "check_script_missing_security_gate",
          "check_script_missing_e2e_gate",
          "check_script_missing_regression_gate",
          "check_script_missing_recovery_gate",
          "check_script_missing_performance_gate",
          "check_script_missing_target_environment_gate",
          "check_script_missing_production_gate",
          "app_package_unreadable",
          "workspace_package_unreadable",
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when implementation progress documents drift from the current N11 increment", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);
      await writeText(
        join(root, "docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md"),
        [
          "# Next Development Plan",
          "",
          "| N11.7 | Production validation gates | Current |",
          "",
          "```text",
          "  -> Production hardening (current: N11.4 secret and API-key hardening)",
          "```",
          "",
        ].join("\n"),
      );

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "next_development_plan_current_increment_drift",
          }),
          expect.objectContaining({
            code: "next_development_plan_stale_current_increment",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the runtime target-environment operator command is missing", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);
      const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      delete packageJson.scripts["target-env:runtime"];
      await writeJson(join(root, "package.json"), packageJson);

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_script_missing",
            target: "target-env:runtime",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the production cut runbook omits runtime evidence workflow", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);
      await writeText(
        join(root, "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md"),
        [
          "# Load Baseline And Production Cut Runbook",
          "",
          "Run the target-environment smoke and load workflows.",
          "",
        ].join("\n"),
      );

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "load_baseline_runbook_missing_runtime_evidence_command",
          }),
          expect.objectContaining({
            code: "load_baseline_runbook_missing_runtime_evidence_input_path",
          }),
          expect.objectContaining({
            code: "load_baseline_runbook_missing_runtime_evidence_report_path",
          }),
          expect.objectContaining({
            code: "load_baseline_runbook_missing_runtime_evidence_template",
          }),
          expect.objectContaining({
            code: "load_baseline_runbook_missing_provider_bridge_proof_guidance",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target-environment evidence collection runbook omits required workflow steps", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);
      await writeText(
        join(root, "docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md"),
        [
          "# Target Environment Evidence Collection Runbook",
          "",
          "Collect target-environment evidence.",
          "",
        ].join("\n"),
      );

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_smoke_command",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_load_command",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_runtime_command",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_bundle_command",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_runtime_template",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_validation_review",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_production_cut_review",
          }),
          expect.objectContaining({
            code: "target_environment_collection_runbook_missing_provider_bridge_proof_guidance",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails package manifests that are not private ESM workspace units", async () => {
    const root = await createTempProject();

    try {
      await createReadinessFixture(root);
      await writeJson(join(root, "packages/domain/package.json"), {
        name: "@omniwa/domain",
        private: false,
        type: "commonjs",
        scripts: {
          build: "tsc -p tsconfig.json",
        },
      });

      const report = await evaluateReleaseReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "workspace_package_must_be_private",
            target: "packages/domain",
          }),
          expect.objectContaining({
            code: "workspace_package_must_be_esm",
            target: "packages/domain",
          }),
          expect.objectContaining({
            code: "workspace_script_missing",
            target: "packages/domain:test",
          }),
          expect.objectContaining({
            code: "workspace_package_exports_missing",
            target: "packages/domain",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-release-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
