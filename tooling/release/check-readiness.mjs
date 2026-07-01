import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredFreezeDocuments = Object.freeze([
  "docs/FREEZE_PHASE_0.md",
  "docs/architecture/ARCHITECTURE_FREEZE.md",
  "docs/domain/DOMAIN_FREEZE.md",
  "docs/application/APPLICATION_FREEZE.md",
  "docs/api/API_FREEZE.md",
  "docs/persistence/PERSISTENCE_FREEZE.md",
  "docs/infrastructure/INFRASTRUCTURE_FREEZE.md",
  "docs/engineering/IMPLEMENTATION_FREEZE.md",
]);

export const requiredRuntimeApps = Object.freeze([
  "apps/api",
  "apps/worker",
  "apps/scheduler",
  "apps/provider-runtime",
  "apps/webhook-dispatcher",
  "apps/projection-builder",
  "apps/background",
  "apps/metrics",
  "apps/health",
]);

export const requiredWorkspacePackages = Object.freeze([
  "packages/shared",
  "packages/errors",
  "packages/config",
  "packages/observability",
  "packages/domain",
  "packages/application",
  "packages/interface-api",
  "packages/infrastructure-persistence",
  "packages/infrastructure-queue",
  "packages/infrastructure-provider-baileys",
  "packages/infrastructure-object-storage",
  "packages/infrastructure-webhook",
  "packages/infrastructure-secrets",
  "packages/infrastructure-observability",
  "packages/testing",
]);

export const requiredReleaseEvidenceFiles = Object.freeze([
  "packages/interface-api/src/api-interface-adapter.ts",
  "packages/infrastructure-queue/src/in-memory-queue-provider.ts",
  "packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.ts",
  "packages/infrastructure-webhook/src/webhook-dispatcher-runtime.ts",
  "packages/infrastructure-webhook/src/webhook-transport.adapter.ts",
  "packages/infrastructure-observability/src/in-memory-observability-runtime.ts",
  "apps/background/src/recovery-validation.ts",
  "docs/api/openapi/omniwa-v1.compatibility.json",
  "docs/api/API_COMPATIBILITY_POLICY.md",
  "docs/api/API_CHANGELOG.md",
  "tooling/api/check-openapi-compatibility.mjs",
  "packages/observability/src/metric-catalog.ts",
  "packages/observability/src/alerts.ts",
  "packages/infrastructure-observability/src/dependency-health.ts",
  "packages/infrastructure-observability/src/metrics-exporter.ts",
  "packages/infrastructure-observability/src/structured-log-backend.ts",
  "apps/metrics/src/index.ts",
  "apps/health/src/index.ts",
  "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md",
  "apps/background/src/backup-restore-drill.ts",
  "docs/runbooks/BACKUP_RESTORE_RECOVERY_DRILL.md",
  "tooling/regression/check-production-regression.mjs",
  "docs/runbooks/PRODUCTION_REGRESSION_GATES.md",
  "tooling/production/check-production-cut.mjs",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
  "docs/reviews/PRODUCTION_CUT_REVIEW.md",
  "docs/platform-evolution/PR-16_LOAD_BASELINE_AND_PRODUCTION_CUT_REVIEW.md",
  "docs/platform-evolution/PR-19_PRODUCTION_READY_GATE_REVIEW.md",
]);

export const requiredReleaseEvidenceTests = Object.freeze([
  "packages/interface-api/src/api-interface-adapter.spec.ts",
  "packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts",
  "packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts",
  "packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts",
  "packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts",
  "packages/infrastructure-observability/src/in-memory-observability-runtime.spec.ts",
  "apps/background/src/recovery-validation.spec.ts",
  "tooling/api/check-openapi-compatibility.spec.ts",
  "packages/observability/src/metric-catalog.spec.ts",
  "packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts",
  "apps/metrics/src/index.spec.ts",
  "apps/health/src/index.spec.ts",
  "apps/background/src/backup-restore-drill.spec.ts",
  "apps/api/src/platform-regression.spec.ts",
  "tooling/regression/check-production-regression.spec.ts",
  "apps/api/src/load-baseline.spec.ts",
  "tooling/production/check-production-cut.spec.ts",
]);

const requiredRootScripts = Object.freeze([
  "build",
  "lint",
  "typecheck",
  "test",
  "arch:check",
  "load:check",
  "openapi:check",
  "openapi:compat",
  "sdk:check",
  "sdk:test",
  "regression:check",
  "production:check",
  "release:check",
  "check",
]);

export async function evaluateReleaseReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const findings = [];

  await checkFiles(projectRoot, "freeze_document", requiredFreezeDocuments, findings);
  await checkFiles(projectRoot, "release_evidence", requiredReleaseEvidenceFiles, findings);
  await checkFiles(projectRoot, "release_evidence_test", requiredReleaseEvidenceTests, findings);
  await checkRootPackage(projectRoot, findings);
  await checkWorkspaceManifests(projectRoot, findings);

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createReadinessFixture(projectRoot) {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    engines: {
      node: ">=22.0.0",
      pnpm: ">=11.0.0",
    },
    scripts: {
      build: "tsc -b tsconfig.references.json",
      lint: "eslint .",
      typecheck: "tsc -b tsconfig.references.json --pretty false",
      test: "vitest run --passWithNoTests",
      "arch:check": "node tooling/architecture/check-boundaries.mjs",
      "load:check":
        "pnpm exec vitest run apps/api/src/load-baseline.spec.ts tooling/production/check-production-cut.spec.ts",
      "openapi:check": "node tooling/api/check-openapi.mjs",
      "openapi:compat": "node tooling/api/check-openapi-compatibility.mjs",
      "sdk:check": "node tooling/sdk/check-rust-sdk.mjs",
      "sdk:test": "cargo test -p omniwa-sdk",
      "regression:check":
        "node tooling/regression/check-production-regression.mjs && pnpm exec vitest run apps/api/src/platform-regression.spec.ts apps/api/src/http-server.spec.ts apps/api/src/api-key-auth.spec.ts apps/api/src/api-rate-limiter.spec.ts apps/api/src/resource-ownership.spec.ts apps/api/src/runtime-composition.spec.ts packages/interface-api/src/api-interface-adapter.spec.ts packages/application/src/commands/command-query-model.spec.ts packages/application/src/workflows/workflow-service.spec.ts packages/domain/src/services/phase-24-domain-contracts.spec.ts packages/infrastructure-persistence/src/durable-json-repositories.spec.ts packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts apps/provider-runtime/src/provider-runtime.spec.ts apps/worker/src/worker-runtime.spec.ts packages/infrastructure-webhook/src/webhook-signing.spec.ts packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts packages/observability/src/redaction.spec.ts packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts tooling/regression/check-production-regression.spec.ts",
      "production:check": "node tooling/production/check-production-cut.mjs && pnpm load:check",
      "release:check": "node tooling/release/check-readiness.mjs",
      check:
        "pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check && pnpm openapi:check && pnpm openapi:compat && pnpm sdk:check && pnpm sdk:test && pnpm regression:check && pnpm production:check && pnpm release:check",
    },
  });

  for (const file of [
    ...requiredFreezeDocuments,
    ...requiredReleaseEvidenceFiles,
    ...requiredReleaseEvidenceTests,
  ]) {
    await writeText(join(projectRoot, file), "fixture\n");
  }

  for (const app of requiredRuntimeApps) {
    await writeJson(join(projectRoot, app, "package.json"), workspaceManifest(app, false));
  }

  for (const workspacePackage of requiredWorkspacePackages) {
    await writeJson(
      join(projectRoot, workspacePackage, "package.json"),
      workspaceManifest(workspacePackage, true),
    );
  }
}

async function checkFiles(projectRoot, category, files, findings) {
  for (const file of files) {
    if (!(await fileExists(join(projectRoot, file)))) {
      findings.push(
        createFinding(`${category}_missing`, "blocker", {
          target: file,
          safeDetailCode: `${category}_missing`,
        }),
      );
    }
  }
}

async function checkRootPackage(projectRoot, findings) {
  const packageJson = await readJson(
    join(projectRoot, "package.json"),
    findings,
    "root_package",
    "package.json",
  );

  if (packageJson === undefined) {
    return;
  }

  if (packageJson.private !== true) {
    findings.push(createFinding("root_package_must_be_private", "blocker"));
  }

  if (packageJson.type !== "module") {
    findings.push(createFinding("root_package_must_be_esm", "blocker"));
  }

  if (
    typeof packageJson.packageManager !== "string" ||
    !packageJson.packageManager.startsWith("pnpm@")
  ) {
    findings.push(createFinding("root_package_manager_must_be_pnpm", "blocker"));
  }

  const scripts = packageJson.scripts;
  if (!isRecord(scripts)) {
    findings.push(createFinding("root_scripts_missing", "blocker"));
    return;
  }

  for (const scriptName of requiredRootScripts) {
    if (typeof scripts[scriptName] !== "string" || scripts[scriptName].length === 0) {
      findings.push(
        createFinding("root_script_missing", "blocker", {
          target: scriptName,
          safeDetailCode: "root_script_missing",
        }),
      );
    }
  }

  const checkScript = scripts.check;
  if (typeof checkScript === "string" && !checkScript.includes("pnpm release:check")) {
    findings.push(createFinding("check_script_missing_release_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm openapi:compat")) {
    findings.push(createFinding("check_script_missing_openapi_compat_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm sdk:test")) {
    findings.push(createFinding("check_script_missing_sdk_test_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm regression:check")) {
    findings.push(createFinding("check_script_missing_regression_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm production:check")) {
    findings.push(createFinding("check_script_missing_production_gate", "blocker"));
  }
}

async function checkWorkspaceManifests(projectRoot, findings) {
  for (const app of requiredRuntimeApps) {
    const manifest = await readJson(
      join(projectRoot, app, "package.json"),
      findings,
      "app_package",
      app,
    );

    if (manifest !== undefined) {
      checkWorkspaceManifest(app, manifest, findings, { packageExportsRequired: false });
    }
  }

  for (const workspacePackage of requiredWorkspacePackages) {
    const manifest = await readJson(
      join(projectRoot, workspacePackage, "package.json"),
      findings,
      "workspace_package",
      workspacePackage,
    );

    if (manifest !== undefined) {
      checkWorkspaceManifest(workspacePackage, manifest, findings, {
        packageExportsRequired: true,
      });
    }
  }
}

function checkWorkspaceManifest(workspacePath, manifest, findings, options) {
  if (manifest.private !== true) {
    findings.push(
      createFinding("workspace_package_must_be_private", "blocker", {
        target: workspacePath,
        safeDetailCode: "workspace_package_must_be_private",
      }),
    );
  }

  if (manifest.type !== "module") {
    findings.push(
      createFinding("workspace_package_must_be_esm", "blocker", {
        target: workspacePath,
        safeDetailCode: "workspace_package_must_be_esm",
      }),
    );
  }

  if (!isRecord(manifest.scripts)) {
    findings.push(
      createFinding("workspace_scripts_missing", "blocker", {
        target: workspacePath,
        safeDetailCode: "workspace_scripts_missing",
      }),
    );
    return;
  }

  for (const scriptName of ["build", "test"]) {
    if (typeof manifest.scripts[scriptName] !== "string") {
      findings.push(
        createFinding("workspace_script_missing", "blocker", {
          target: `${workspacePath}:${scriptName}`,
          safeDetailCode: "workspace_script_missing",
        }),
      );
    }
  }

  if (options.packageExportsRequired && !isRecord(manifest.exports)) {
    findings.push(
      createFinding("workspace_package_exports_missing", "blocker", {
        target: workspacePath,
        safeDetailCode: "workspace_package_exports_missing",
      }),
    );
  }
}

async function readJson(path, findings, category, target = path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    findings.push(
      createFinding(`${category}_unreadable`, "blocker", {
        target,
        safeDetailCode: `${category}_unreadable`,
      }),
    );

    return undefined;
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function createFinding(code, severity, options = {}) {
  const finding = {
    code,
    severity,
    safeDetailCode: options.safeDetailCode ?? code,
  };

  if (typeof options.target === "string") {
    finding.target = options.target;
  }

  return Object.freeze(finding);
}

function freezeReport(report) {
  return Object.freeze({
    ...report,
    findings: Object.freeze([...report.findings]),
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspaceManifest(workspacePath, packageExportsRequired) {
  const manifest = {
    name: `@omniwa/${workspacePath.split("/").at(-1)}`,
    private: true,
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "vitest run --passWithNoTests",
    },
  };

  if (packageExportsRequired) {
    manifest.exports = {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    };
  }

  return manifest;
}

async function writeJson(path, data) {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function main() {
  const report = await evaluateReleaseReadiness();

  if (report.status === "passed") {
    console.log(`Release readiness check passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Release readiness check failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
