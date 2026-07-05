import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createPerformanceFixture,
  evaluatePerformanceReadiness,
  performanceScript,
  requiredPerformanceEvidenceTests,
} from "./check-performance-readiness.mjs";

describe("performance readiness gate check", () => {
  it("passes when performance evidence, tests, load gate, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createPerformanceFixture(root);

      const report = await evaluatePerformanceReadiness({
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

  it("fails when the root check does not include the performance gate", async () => {
    const root = await createTempProject();

    try {
      await createPerformanceFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-performance-fixture",
        private: true,
        type: "module",
        scripts: {
          "performance:check": performanceScript(),
          "load:check":
            "pnpm exec vitest run apps/api/src/load-baseline.spec.ts tooling/production/check-production-cut.spec.ts",
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluatePerformanceReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_performance_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the performance gate does not call load:check", async () => {
    const root = await createTempProject();

    try {
      await createPerformanceFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-performance-fixture",
        private: true,
        type: "module",
        scripts: {
          "performance:check":
            "node tooling/performance/check-performance-readiness.mjs && pnpm exec vitest run tooling/performance/check-performance-readiness.spec.ts",
          "load:check":
            "pnpm exec vitest run apps/api/src/load-baseline.spec.ts tooling/production/check-production-cut.spec.ts",
          check: "pnpm performance:check && pnpm release:check",
        },
      });

      const report = await evaluatePerformanceReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_performance_script_missing_load_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredPerformanceEvidenceTests[1];

    try {
      await createPerformanceFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-performance-fixture",
        private: true,
        type: "module",
        scripts: {
          "performance:check":
            "node tooling/performance/check-performance-readiness.mjs && vitest run --passWithNoTests apps/api/src/load-baseline.spec.ts",
          "load:check": "pnpm exec vitest run apps/api/src/load-baseline.spec.ts",
          check: "pnpm performance:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluatePerformanceReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_performance_script_missing_load_gate",
          }),
          expect.objectContaining({
            code: "root_performance_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_performance_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "performance_evidence_test_missing",
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
  return mkdtemp(join(tmpdir(), "omniwa-performance-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
