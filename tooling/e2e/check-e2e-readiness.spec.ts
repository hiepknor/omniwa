import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createE2eFixture,
  e2eScript,
  evaluateE2eReadiness,
  requiredE2eEvidenceTests,
} from "./check-e2e-readiness.mjs";

describe("E2E readiness gate check", () => {
  it("passes when E2E evidence, tests, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createE2eFixture(root);

      const report = await evaluateE2eReadiness({
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

  it("fails when the root check does not include the E2E gate", async () => {
    const root = await createTempProject();

    try {
      await createE2eFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-e2e-fixture",
        private: true,
        type: "module",
        scripts: {
          "e2e:check": e2eScript(),
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluateE2eReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_e2e_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredE2eEvidenceTests[0];

    try {
      await createE2eFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-e2e-fixture",
        private: true,
        type: "module",
        scripts: {
          "e2e:check":
            "vitest run --passWithNoTests apps/background/src/local-vertical-slice-demo.spec.ts",
          check: "pnpm e2e:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateE2eReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_e2e_script_missing_tooling_gate",
          }),
          expect.objectContaining({
            code: "root_e2e_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_e2e_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "e2e_evidence_test_missing",
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
  return mkdtemp(join(tmpdir(), "omniwa-e2e-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
