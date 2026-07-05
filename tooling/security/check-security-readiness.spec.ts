import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createSecurityFixture,
  evaluateSecurityReadiness,
  requiredSecurityEvidenceTests,
  securityScript,
} from "./check-security-readiness.mjs";

describe("security readiness gate check", () => {
  it("passes when security evidence, tests, and root gate are wired", async () => {
    const root = await createTempProject();

    try {
      await createSecurityFixture(root);

      const report = await evaluateSecurityReadiness({
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

  it("fails when the root check does not include the security gate", async () => {
    const root = await createTempProject();

    try {
      await createSecurityFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-security-fixture",
        private: true,
        type: "module",
        scripts: {
          "security:check": securityScript(),
          check: "pnpm lint && pnpm test && pnpm release:check",
        },
      });

      const report = await evaluateSecurityReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "check_script_missing_security_gate",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required tests are missing or the gate allows no-test passes", async () => {
    const root = await createTempProject();
    const missingTest = requiredSecurityEvidenceTests[1];

    try {
      await createSecurityFixture(root);
      await writeJson(join(root, "package.json"), {
        name: "omniwa-security-fixture",
        private: true,
        type: "module",
        scripts: {
          "security:check": "vitest run --passWithNoTests apps/api/src/api-key-auth.spec.ts",
          check: "pnpm security:check && pnpm release:check",
        },
      });
      await rm(join(root, missingTest), { force: true });

      const report = await evaluateSecurityReadiness({
        projectRoot: root,
        checkedAtEpochMilliseconds: 1_800_000_000_000,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "root_security_script_missing_tooling_gate",
          }),
          expect.objectContaining({
            code: "root_security_script_must_not_pass_with_no_tests",
          }),
          expect.objectContaining({
            code: "root_security_script_missing_test",
            target: missingTest,
          }),
          expect.objectContaining({
            code: "security_evidence_test_missing",
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
  return mkdtemp(join(tmpdir(), "omniwa-security-check-"));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
