import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createTargetEnvironmentEvidenceBundle,
  targetEnvironmentEvidenceBundleTemplateForTests,
} from "./create-target-environment-evidence-bundle.mjs";
import {
  createTargetEnvironmentFixture,
  validateTargetEnvironmentEvidenceBundleArtifact,
} from "./check-target-environment-evidence.mjs";

type GeneratedBundle = Readonly<{
  status: string;
  checkedAtIso: string;
  proofStates: Readonly<Record<string, boolean>>;
  artifacts: Readonly<{
    smoke: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
    load: Readonly<{
      artifactRef: string;
      status?: string;
      summary?: Readonly<Record<string, unknown>>;
    }>;
  }>;
}>;

describe("target environment evidence bundle generator", () => {
  it("creates a sanitized NOT_PROVEN bundle from the checked-in template", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report).toEqual({
        status: "passed",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        findings: [],
        written: true,
      });

      const bundle = await readJson(join(root, "artifacts/target-env/evidence-bundle.json"));
      expect(validateTargetEnvironmentEvidenceBundleArtifact(bundle)).toBe(true);
      expect(bundle).toMatchObject({
        status: "NOT_PROVEN",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        proofStates: {
          targetEnvironmentProven: false,
          productionLoadProven: false,
          sloEvidenceProven: false,
        },
      });
      expect(bundle.components).toContainEqual({
        component: "Background Runtime",
        status: "PENDING",
        evidenceRef: "operator-evidence-background-runtime-pending",
      });
      expect(JSON.stringify(bundle)).not.toContain("http://");
      expect(JSON.stringify(bundle)).not.toContain("https://");
      expect(JSON.stringify(bundle)).not.toContain("local-dev-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("embeds validated smoke and load summaries without raw target details", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), validSmokeArtifact());
      await writeJson(join(root, "artifacts/target-env/load-report.json"), validLoadArtifact());

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        loadReportPath: "artifacts/target-env/load-report.json",
        smokeArtifactRef: "operator-smoke-artifact-ref",
        loadArtifactRef: "operator-load-artifact-ref",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("passed");

      const bundle = await readJson(join(root, "artifacts/target-env/evidence-bundle.json"));
      expect(bundle.artifacts.smoke).toMatchObject({
        artifactRef: "operator-smoke-artifact-ref",
        status: "passed",
      });
      expect(bundle.artifacts.load).toMatchObject({
        artifactRef: "operator-load-artifact-ref",
        status: "passed",
      });
      expect(bundle.artifacts.smoke.summary).toMatchObject({
        endpoints: [
          {
            method: "GET",
            path: "/v1/health",
            ok: true,
          },
        ],
      });
      expect(bundle.artifacts.load.summary).toMatchObject({
        summary: {
          totalRequests: 60,
          successes: 60,
        },
      });
      expect(JSON.stringify(bundle)).not.toContain("x-api-key");
      expect(JSON.stringify(bundle)).not.toContain("@s.whatsapp.net");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails safe when the output path is missing", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report).toEqual({
        status: "failed",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
        findings: [
          {
            code: "target_environment_bundle_output_path_missing",
            severity: "blocker",
            safeDetailCode: "target_environment_bundle_output_path_missing",
          },
        ],
        written: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe smoke artifact content without writing the bundle", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "artifacts/target-env/smoke-report.json"), {
        ...validSmokeArtifact(),
        baseUrl: "https://target.example.invalid",
        apiKey: "local-dev-secret-change-me",
      });

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        smokeReportPath: "artifacts/target-env/smoke-report.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("failed");
      expect(report.written).toBe(false);
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_smoke_artifact_unsafe_content",
          }),
        ]),
      );
      expect(JSON.stringify(report)).not.toContain("target.example");
      expect(JSON.stringify(report)).not.toContain("local-dev-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a template that claims target-environment proof", async () => {
    const root = await createTempProject();

    try {
      await createTargetEnvironmentFixture(root, "NOT_PROVEN");
      await writeJson(join(root, "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json"), {
        ...targetEnvironmentEvidenceBundleTemplateForTests(),
        status: "PROVEN",
        proofStates: {
          targetEnvironmentProven: true,
          productionLoadProven: true,
          sloEvidenceProven: true,
        },
      });

      const report = await createTargetEnvironmentEvidenceBundle({
        projectRoot: root,
        outputPath: "artifacts/target-env/evidence-bundle.json",
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      });

      expect(report.status).toBe("failed");
      expect(report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "target_environment_bundle_template_invalid_schema",
          }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function validSmokeArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    endpoints: [
      {
        method: "GET",
        path: "/v1/health",
        ok: true,
        statusCode: 200,
        checkedAtIso: "2026-07-05T00:00:00.000Z",
      },
    ],
    findings: [],
  };
}

function validLoadArtifact(): unknown {
  return {
    status: "passed",
    checkedAtIso: "2026-07-05T00:00:00.000Z",
    budgets: {
      requestCount: 60,
      concurrency: 5,
      timeoutMilliseconds: 10_000,
      maxP95LatencyMilliseconds: 2_000,
      minSuccessRatePercent: 100,
    },
    summary: {
      totalRequests: 60,
      successes: 60,
      failures: 0,
      successRatePercent: 100,
      durationMilliseconds: 500,
      p95LatencyMilliseconds: 50,
      maxLatencyMilliseconds: 80,
    },
    endpoints: [
      {
        method: "GET",
        path: "/v1/health",
        requests: 60,
        successes: 60,
        failures: 0,
        statusCodeCounts: {
          "200": 60,
        },
        safeErrorCodeCounts: {},
      },
    ],
    findings: [],
  };
}

async function createTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "omniwa-target-env-bundle-"));
}

async function readJson(path: string): Promise<GeneratedBundle> {
  return JSON.parse(await readFile(path, "utf8")) as GeneratedBundle;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}
