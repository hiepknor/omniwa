import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createRecoveryFixture,
  evaluateRecoveryReadiness,
  recoveryScript,
  requiredRecoveryEvidenceTests,
} from "./check-recovery-readiness.mjs";

describe("recovery readiness gate check", () => {
  it("passes when recovery evidence, tests, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createRecoveryFixture(root);

      const report = await evaluateRecoveryReadiness({
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

  it("fails when the root check does not include the recovery gate", async () => {
    const root = await createTempProject();

    try {
      await createRecoveryFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-recovery-fixture",
        private: true,
        type: "module",
        scripts: {
          "recovery:check": recoveryScript(),
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluateRecoveryReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_recovery_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredRecoveryEvidenceTests[0];

    try {
      await createRecoveryFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-recovery-fixture",
        private: true,
        type: "module",
        scripts: {
          "recovery:check":
            "vitest run --passWithNoTests apps/background/src/recovery-validation.spec.ts",
          check: "pnpm recovery:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateRecoveryReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_recovery_script_missing_tooling_gate",
          }),
          expect.objectContaining({
            code: "root_recovery_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_recovery_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "recovery_evidence_test_missing",
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
  return mkdtemp(join(tmpdir(), "omniwa-recovery-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
