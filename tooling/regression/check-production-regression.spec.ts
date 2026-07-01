import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createProductionRegressionFixture,
  evaluateProductionRegressionReadiness,
  regressionScript,
  requiredRegressionTestFiles,
} from "./check-production-regression.mjs";

describe("production regression gate check", () => {
  it("passes when the root gate and required regression tests are wired", async () => {
    const root = await createTempProject();

    try {
      await createProductionRegressionFixture(root);

      const report = await evaluateProductionRegressionReadiness({
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

  it("fails when the root check does not include the regression gate", async () => {
    const root = await createTempProject();

    try {
      await createProductionRegressionFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-regression-fixture",
        private: true,
        type: "module",
        scripts: {
          "regression:check": regressionScript(),
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluateProductionRegressionReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_regression_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredRegressionTestFiles[0];

    try {
      await createProductionRegressionFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-regression-fixture",
        private: true,
        type: "module",
        scripts: {
          "regression:check": "vitest run --passWithNoTests apps/api/src/http-server.spec.ts",
          check: "pnpm regression:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateProductionRegressionReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_regression_script_missing_tooling_gate",
          }),
          expect.objectContaining({
            code: "root_regression_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_regression_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "regression_test_missing",
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
  return mkdtemp(join(tmpdir(), "omniwa-regression-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
