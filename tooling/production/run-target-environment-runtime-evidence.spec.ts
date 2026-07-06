import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { requiredTargetEnvironmentComponents } from "./check-target-environment-evidence.mjs";
import {
  runTargetEnvironmentRuntimeEvidence,
  writeTargetEnvironmentRuntimeEvidenceReport,
} from "./run-target-environment-runtime-evidence.mjs";

describe("target environment runtime evidence runner", () => {
  it("creates a failed safe skeleton when operator input is missing", async () => {
    const report = await runTargetEnvironmentRuntimeEvidence({
      checkedAtIso: "2026-07-05T00:00:00.000Z",
    });

    expect(report.status).toBe("failed");
    expect(report.checkedAtIso).toBe("2026-07-05T00:00:00.000Z");
    expect(report.runtimes).toHaveLength(requiredTargetEnvironmentComponents.length);
    expect(report.runtimes).toEqual(
      requiredTargetEnvironmentComponents.map((component) =>
        expect.objectContaining({
          component,
          started: false,
          readinessChecked: false,
          shutdownChecked: false,
          safeErrorCode: "target_runtime_evidence_not_supplied",
        }),
      ),
    );
    expect(report.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dependency: "PostgreSQL",
          connectivityChecked: false,
          credentialBoundaryChecked: false,
          migrationStatusChecked: false,
        }),
        expect.objectContaining({
          dependency: "Redis",
          connectivityChecked: false,
          credentialBoundaryChecked: false,
        }),
      ]),
    );
    expect(report.providerCommandBridge).toEqual({
      workerConfigured: false,
      providerRuntimeServerConfigured: false,
      authenticationBoundaryChecked: false,
      commandRoundTripChecked: false,
      safeErrorCode: "target_runtime_evidence_not_supplied",
    });
    expect(report.backupRestore).toEqual(
      expect.objectContaining({
        backupCreated: false,
        restoreValidated: false,
        rollbackOrForwardFixReviewed: false,
      }),
    );
    expect(JSON.stringify(report)).not.toContain("http://");
    expect(JSON.stringify(report)).not.toContain("https://");
  });

  it("normalizes sanitized operator input and computes passed status", async () => {
    const report = await runTargetEnvironmentRuntimeEvidence({
      input: validRuntimeEvidenceInput("failed"),
    });

    expect(report.status).toBe("passed");
    expect(report.runtimes).toEqual(
      requiredTargetEnvironmentComponents.map((component) =>
        expect.objectContaining({
          component,
          started: true,
          readinessChecked: true,
          shutdownChecked: true,
        }),
      ),
    );
    expect(report.dependencies).toEqual([
      {
        dependency: "PostgreSQL",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
        migrationStatusChecked: true,
      },
      {
        dependency: "Redis",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
      },
    ]);
    expect(report.providerCommandBridge).toEqual({
      workerConfigured: true,
      providerRuntimeServerConfigured: true,
      authenticationBoundaryChecked: true,
      commandRoundTripChecked: true,
    });
    expect(JSON.stringify(report)).not.toContain("target-secret-api-key");
    expect(JSON.stringify(report)).not.toContain("postgresql://");
  });

  it("computes failed status when an operator check is incomplete", async () => {
    const input = validRuntimeEvidenceInput("passed");
    const report = await runTargetEnvironmentRuntimeEvidence({
      input: {
        ...input,
        backupRestore: {
          ...input.backupRestore,
          restoreValidated: false,
        },
      },
    });

    expect(report.status).toBe("failed");
    expect(report.backupRestore.restoreValidated).toBe(false);
  });

  it("reads sanitized operator input from a file and writes a sanitized report", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-runtime-evidence-"));

    try {
      const inputPath = join(root, "input", "runtime-evidence-input.json");
      const reportPath = join(root, "output", "runtime-evidence.json");
      await writeJson(inputPath, validRuntimeEvidenceInput("failed"));

      const report = await runTargetEnvironmentRuntimeEvidence({ inputPath });
      await expect(
        writeTargetEnvironmentRuntimeEvidenceReport(report, reportPath),
      ).resolves.toEqual({
        ok: true,
      });

      const artifact = await readFile(reportPath, "utf8");
      expect(JSON.parse(artifact)).toEqual(report);
      expect(artifact).not.toContain("target-secret-api-key");
      expect(artifact).not.toContain("api.prod.example");
      expect(artifact).not.toContain("postgresql://");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe operator input without echoing raw target details", async () => {
    const report = await runTargetEnvironmentRuntimeEvidence({
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      input: {
        ...validRuntimeEvidenceInput(),
        targetUrl: "https://api.prod.example",
        databaseUrl: "postgresql://user:password@db.example/omniwa",
      },
    });

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      {
        code: "target_runtime_evidence_input_unsafe_content",
        severity: "blocker",
        safeDetailCode: "target_runtime_evidence_input_unsafe_content",
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("api.prod.example");
    expect(JSON.stringify(report)).not.toContain("postgresql://");
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("fails safely when operator input is unreadable or invalid JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-runtime-evidence-"));

    try {
      const inputPath = join(root, "runtime-evidence-input.json");
      await writeFile(inputPath, "{not-json", "utf8");

      const report = await runTargetEnvironmentRuntimeEvidence({
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        inputPath,
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual([
        {
          code: "target_runtime_evidence_input_unreadable",
          severity: "blocker",
          safeDetailCode: "target_runtime_evidence_input_unreadable",
        },
      ]);
      expect(JSON.stringify(report)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safely when operator input schema is invalid", async () => {
    const report = await runTargetEnvironmentRuntimeEvidence({
      checkedAtIso: "2026-07-05T00:00:00.000Z",
      input: {
        ...validRuntimeEvidenceInput(),
        runtimes: [],
      },
    });

    expect(report.status).toBe("failed");
    expect(report.findings).toEqual([
      {
        code: "target_runtime_evidence_input_invalid_schema",
        severity: "blocker",
        safeDetailCode: "target_runtime_evidence_input_invalid_schema",
      },
    ]);
  });

  it("returns a safe write failure when the report path cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "omniwa-target-runtime-evidence-"));

    try {
      const blockedFile = join(root, "existing-file");
      await writeFile(blockedFile, "not a directory", "utf8");

      const result = await writeTargetEnvironmentRuntimeEvidenceReport(
        validRuntimeEvidenceInput(),
        join(blockedFile, "runtime-evidence.json"),
      );

      expect(result).toEqual({
        ok: false,
        safeErrorCode: "target_runtime_evidence_report_write_failed",
      });
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("existing-file");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function validRuntimeEvidenceInput(status: "passed" | "failed" = "passed") {
  return {
    status,
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    runtimes: requiredTargetEnvironmentComponents.map((component) => ({
      component,
      started: true,
      readinessChecked: true,
      shutdownChecked: true,
      versionRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-version-reviewed`,
    })),
    dependencies: [
      {
        dependency: "PostgreSQL",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
        migrationStatusChecked: true,
      },
      {
        dependency: "Redis",
        connectivityChecked: true,
        credentialBoundaryChecked: true,
      },
    ],
    providerCommandBridge: {
      workerConfigured: true,
      providerRuntimeServerConfigured: true,
      authenticationBoundaryChecked: true,
      commandRoundTripChecked: true,
    },
    backupRestore: {
      drillRef: "backup-restore-drill-reviewed",
      backupCreated: true,
      restoreValidated: true,
      rollbackOrForwardFixReviewed: true,
      rpoSeconds: 300,
      rtoSeconds: 900,
    },
    findings: [],
  };
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
