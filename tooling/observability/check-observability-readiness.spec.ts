import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createObservabilityFixture,
  evaluateObservabilityReadiness,
  observabilityScript,
  requiredObservabilityEvidenceTests,
} from "./check-observability-readiness.mjs";

describe("observability readiness gate check", () => {
  it("passes when observability evidence, tests, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createObservabilityFixture(root);

      const report = await evaluateObservabilityReadiness({
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

  it("fails when the root check does not include the observability gate", async () => {
    const root = await createTempProject();

    try {
      await createObservabilityFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-observability-fixture",
        private: true,
        type: "module",
        scripts: {
          "observability:check": observabilityScript(),
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluateObservabilityReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_observability_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the observability script omits the tooling gate", async () => {
    const root = await createTempProject();

    try {
      await createObservabilityFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-observability-fixture",
        private: true,
        type: "module",
        scripts: {
          "observability:check": `pnpm exec vitest run ${requiredObservabilityEvidenceTests.join(
            " ",
          )}`,
          check: "pnpm observability:check && pnpm release:check",
        },
      });

      const report = await evaluateObservabilityReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_observability_script_missing_tooling_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredObservabilityEvidenceTests[1];

    try {
      await createObservabilityFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-observability-fixture",
        private: true,
        type: "module",
        scripts: {
          "observability:check":
            "node tooling/observability/check-observability-readiness.mjs && vitest run --passWithNoTests packages/observability/src/metric-catalog.spec.ts",
          check: "pnpm observability:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateObservabilityReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_observability_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_observability_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "observability_evidence_test_missing",
            target: missingTest,
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-observability-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
