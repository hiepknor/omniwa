import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createSloFixture,
  evaluateSloReadiness,
  requiredSloAlertIds,
  requiredSloAreas,
  requiredSloEvidenceTests,
} from "./check-slo-readiness.mjs";

describe("SLO readiness gate", () => {
  it("passes when SLO evidence, alert runbooks, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createSloFixture(root);

      const report = await evaluateSloReadiness({
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

  it("fails when an approved SLO area is missing", async () => {
    const root = await createTempProject();
    const missingArea = requiredSloAreas[0];

    try {
      await createSloFixture(root);
      await writeText(
        join(root, "docs/infrastructure/OBSERVABILITY.md"),
        [
          "# Observability",
          "",
          "## SLI / SLO / Error Budget",
          "",
          "| Area | SLI | MVP SLO | Error Budget Position |",
          "| --- | --- | --- | --- |",
          ...requiredSloAreas
            .filter((area) => area !== missingArea)
            .map((area) => `| ${area} | Fixture SLI | Fixture SLO | Fixture budget |`),
          "",
        ].join("\n"),
      );

      const report = await evaluateSloReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "slo_area_missing",
            target: missingArea,
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when an approved alert id is missing from the runbook", async () => {
    const root = await createTempProject();
    const missingAlert = requiredSloAlertIds[0];

    try {
      await createSloFixture(root);
      await writeText(
        join(root, "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md"),
        [
          "# Observability And Dependency Readiness",
          "",
          "## Alerts",
          "",
          ...requiredSloAlertIds
            .filter((alertId) => alertId !== missingAlert)
            .map((alertId) => `- \`${alertId}\``),
          "",
        ].join("\n"),
      );

      const report = await evaluateSloReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "slo_alert_runbook_missing",
            target: missingAlert,
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when PRODUCTION_READY is claimed without SLO proof", async () => {
    const root = await createTempProject();

    try {
      await createSloFixture(root);
      await writeText(
        join(root, "docs/reviews/PRODUCTION_CUT_REVIEW.md"),
        [
          "# Production Cut Review",
          "",
          "Final readiness decision: PRODUCTION_READY",
          "",
          "SLO Evidence Proven: NO",
          "",
        ].join("\n"),
      );

      const report = await evaluateSloReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "production_ready_slo_evidence_not_proven",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when root scripts omit the SLO gate or allow no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredSloEvidenceTests[1];

    try {
      await createSloFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-slo-fixture",
        private: true,
        type: "module",
        scripts: {
          "slo:check":
            "node tooling/observability/check-slo-readiness.mjs && vitest run --passWithNoTests packages/observability/src/metric-catalog.spec.ts",
          "production:check": "node tooling/production/check-production-cut.mjs",
          check: "pnpm lint && pnpm observability:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateSloReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "root_slo_script_must_not_pass_with_no_tests" }),
          expect.objectContaining({
            code: "root_slo_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "slo_evidence_test_missing",
            target: missingTest,
          }),
          expect.objectContaining({ code: "production_script_missing_slo_gate" }),
          expect.objectContaining({ code: "check_script_missing_slo_gate" }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the SLO script omits the tooling gate", async () => {
    const root = await createTempProject();

    try {
      await createSloFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-slo-fixture",
        private: true,
        type: "module",
        scripts: {
          "slo:check": `pnpm exec vitest run ${requiredSloEvidenceTests.join(" ")}`,
          "production:check": "pnpm slo:check && node tooling/production/check-production-cut.mjs",
          check: "pnpm slo:check && pnpm production:check",
        },
      });

      const report = await evaluateSloReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_slo_script_missing_tooling_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-slo-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
