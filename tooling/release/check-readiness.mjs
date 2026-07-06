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
  "packages/infrastructure-persistence/src/event-log-store.ts",
  "packages/infrastructure-persistence/src/event-log-runtime-publisher.ts",
  "packages/infrastructure-queue/src/durable-worker-job-queue-provider.ts",
  "packages/infrastructure-queue/src/in-memory-queue-provider.ts",
  "packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.ts",
  "apps/provider-runtime/src/provider-runtime-ownership-guard.ts",
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
  "tooling/observability/check-observability-readiness.mjs",
  "tooling/observability/check-slo-readiness.mjs",
  "apps/worker/src/worker-loop.ts",
  "apps/webhook-dispatcher/src/webhook-dispatcher-loop.ts",
  "apps/webhook-dispatcher/src/runtime-composition.ts",
  "apps/background/src/local-vertical-slice-demo.ts",
  "tooling/e2e/check-e2e-readiness.mjs",
  "apps/metrics/src/index.ts",
  "apps/health/src/index.ts",
  "docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md",
  "tooling/security/check-security-readiness.mjs",
  "tooling/security/README.md",
  "apps/background/src/backup-restore-drill.ts",
  "tooling/recovery/check-recovery-readiness.mjs",
  "docs/runbooks/BACKUP_RESTORE_RECOVERY_DRILL.md",
  "tooling/regression/check-production-regression.mjs",
  "docs/runbooks/PRODUCTION_REGRESSION_GATES.md",
  "tooling/production/check-target-environment-evidence.mjs",
  "tooling/production/run-target-environment-runtime-evidence.mjs",
  "tooling/production/run-target-environment-smoke.mjs",
  "tooling/production/check-production-cut.mjs",
  "tooling/performance/check-performance-readiness.mjs",
  "tooling/performance/run-target-environment-load.mjs",
  "docs/IMPLEMENTATION_STATUS.md",
  "docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
  "docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md",
  "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md",
  "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json",
  "docs/reviews/PRODUCTION_CUT_REVIEW.md",
  "docs/platform-evolution/PR-16_LOAD_BASELINE_AND_PRODUCTION_CUT_REVIEW.md",
  "docs/platform-evolution/PR-19_PRODUCTION_READY_GATE_REVIEW.md",
]);

export const requiredReleaseEvidenceTests = Object.freeze([
  "packages/interface-api/src/api-interface-adapter.spec.ts",
  "packages/infrastructure-queue/src/durable-worker-job-queue-provider.spec.ts",
  "packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts",
  "packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts",
  "apps/provider-runtime/src/provider-runtime-ownership-guard.spec.ts",
  "packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts",
  "packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts",
  "packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts",
  "packages/infrastructure-observability/src/in-memory-observability-runtime.spec.ts",
  "apps/background/src/recovery-validation.spec.ts",
  "apps/provider-runtime/src/provider-runtime-app.spec.ts",
  "apps/worker/src/worker-loop.spec.ts",
  "apps/webhook-dispatcher/src/webhook-dispatcher-loop.spec.ts",
  "apps/webhook-dispatcher/src/runtime-composition.spec.ts",
  "apps/background/src/local-vertical-slice-demo.spec.ts",
  "tooling/e2e/check-e2e-readiness.spec.ts",
  "tooling/api/check-openapi-compatibility.spec.ts",
  "packages/observability/src/metric-catalog.spec.ts",
  "packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts",
  "apps/metrics/src/index.spec.ts",
  "apps/health/src/index.spec.ts",
  "tooling/observability/check-observability-readiness.spec.ts",
  "tooling/observability/check-slo-readiness.spec.ts",
  "tooling/security/check-security-readiness.spec.ts",
  "apps/background/src/backup-restore-drill.spec.ts",
  "tooling/recovery/check-recovery-readiness.spec.ts",
  "apps/api/src/platform-regression.spec.ts",
  "apps/api/src/realtime-event-stream.spec.ts",
  "packages/infrastructure-persistence/src/event-log-store.spec.ts",
  "tooling/regression/check-production-regression.spec.ts",
  "apps/api/src/load-baseline.spec.ts",
  "tooling/production/check-target-environment-evidence.spec.ts",
  "tooling/production/create-target-environment-evidence-bundle.spec.ts",
  "tooling/production/run-target-environment-runtime-evidence.spec.ts",
  "tooling/production/run-target-environment-smoke.spec.ts",
  "tooling/production/check-production-cut.spec.ts",
  "tooling/performance/run-target-environment-load.spec.ts",
  "tooling/performance/check-performance-readiness.spec.ts",
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
  "observability:check",
  "slo:check",
  "security:check",
  "e2e:check",
  "regression:check",
  "recovery:check",
  "performance:check",
  "target-env:bundle",
  "target-env:check",
  "target-env:load",
  "target-env:runtime",
  "target-env:smoke",
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
  await checkImplementationProgressDocuments(projectRoot, findings);
  await checkProductionCutRunbook(projectRoot, findings);
  await checkTargetEnvironmentEvidenceCollectionRunbook(projectRoot, findings);

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
      "observability:check":
        "node tooling/observability/check-observability-readiness.mjs && pnpm exec vitest run packages/observability/src/metric-catalog.spec.ts packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts apps/metrics/src/index.spec.ts apps/health/src/index.spec.ts tooling/observability/check-observability-readiness.spec.ts",
      "slo:check":
        "node tooling/observability/check-slo-readiness.mjs && pnpm exec vitest run packages/observability/src/metric-catalog.spec.ts tooling/observability/check-slo-readiness.spec.ts",
      "security:check":
        "node tooling/security/check-security-readiness.mjs && pnpm exec vitest run apps/api/src/api-key-auth.spec.ts apps/api/src/api-key-lifecycle.spec.ts apps/api/src/api-rate-limiter.spec.ts apps/api/src/api-security-audit.spec.ts apps/api/src/resource-ownership.spec.ts apps/api/src/platform-regression.spec.ts packages/infrastructure-webhook/src/webhook-signing.spec.ts packages/observability/src/redaction.spec.ts packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts packages/infrastructure-provider-baileys/src/baileys-auth-state-store.spec.ts tooling/security/check-security-readiness.spec.ts",
      "e2e:check":
        "node tooling/e2e/check-e2e-readiness.mjs && pnpm exec vitest run apps/api/src/platform-regression.spec.ts apps/background/src/local-vertical-slice-demo.spec.ts tooling/e2e/check-e2e-readiness.spec.ts",
      "regression:check":
        "node tooling/regression/check-production-regression.mjs && pnpm exec vitest run apps/api/src/platform-regression.spec.ts apps/api/src/http-server.spec.ts apps/api/src/api-key-auth.spec.ts apps/api/src/api-rate-limiter.spec.ts apps/api/src/resource-ownership.spec.ts apps/api/src/runtime-composition.spec.ts apps/api/src/realtime-event-stream.spec.ts packages/interface-api/src/api-interface-adapter.spec.ts packages/application/src/commands/command-query-model.spec.ts packages/application/src/workflows/workflow-service.spec.ts packages/domain/src/services/phase-24-domain-contracts.spec.ts packages/infrastructure-persistence/src/durable-json-repositories.spec.ts packages/infrastructure-persistence/src/event-log-store.spec.ts packages/infrastructure-queue/src/durable-worker-job-queue-provider.spec.ts packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.spec.ts apps/provider-runtime/src/provider-runtime.spec.ts apps/provider-runtime/src/provider-runtime-app.spec.ts apps/provider-runtime/src/provider-runtime-ownership-guard.spec.ts apps/worker/src/worker-runtime.spec.ts apps/worker/src/worker-loop.spec.ts packages/infrastructure-webhook/src/webhook-signing.spec.ts packages/infrastructure-webhook/src/webhook-transport.adapter.spec.ts packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-loop.spec.ts apps/webhook-dispatcher/src/runtime-composition.spec.ts packages/observability/src/redaction.spec.ts packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts packages/infrastructure-object-storage/src/object-storage-media-store.adapter.spec.ts tooling/regression/check-production-regression.spec.ts",
      "recovery:check":
        "node tooling/recovery/check-recovery-readiness.mjs && pnpm exec vitest run apps/background/src/backup-restore-drill.spec.ts apps/background/src/recovery-validation.spec.ts tooling/recovery/check-recovery-readiness.spec.ts",
      "performance:check":
        "node tooling/performance/check-performance-readiness.mjs && pnpm load:check && pnpm exec vitest run tooling/performance/run-target-environment-load.spec.ts tooling/performance/check-performance-readiness.spec.ts",
      "target-env:check":
        "node tooling/production/check-target-environment-evidence.mjs && pnpm exec vitest run tooling/production/check-target-environment-evidence.spec.ts tooling/production/create-target-environment-evidence-bundle.spec.ts tooling/production/run-target-environment-runtime-evidence.spec.ts tooling/production/run-target-environment-smoke.spec.ts tooling/performance/run-target-environment-load.spec.ts",
      "target-env:bundle": "node tooling/production/create-target-environment-evidence-bundle.mjs",
      "target-env:load": "node tooling/performance/run-target-environment-load.mjs",
      "target-env:runtime": "node tooling/production/run-target-environment-runtime-evidence.mjs",
      "target-env:smoke": "node tooling/production/run-target-environment-smoke.mjs",
      "production:check":
        "pnpm target-env:check && pnpm slo:check && node tooling/production/check-production-cut.mjs && pnpm load:check",
      "release:check": "node tooling/release/check-readiness.mjs",
      check:
        "pnpm lint && pnpm typecheck && pnpm test && pnpm arch:check && pnpm openapi:check && pnpm openapi:compat && pnpm sdk:check && pnpm sdk:test && pnpm observability:check && pnpm slo:check && pnpm security:check && pnpm e2e:check && pnpm regression:check && pnpm recovery:check && pnpm performance:check && pnpm target-env:check && pnpm production:check && pnpm release:check",
    },
  });

  for (const file of [
    ...requiredFreezeDocuments,
    ...requiredReleaseEvidenceFiles,
    ...requiredReleaseEvidenceTests,
  ]) {
    await writeText(join(projectRoot, file), releaseEvidenceFixtureContent(file));
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

function releaseEvidenceFixtureContent(file) {
  if (file === "docs/IMPLEMENTATION_STATUS.md") {
    return [
      "# OmniWA Implementation Status",
      "",
      "| Increment | Status | Evidence | Next |",
      "| --- | --- | --- | --- |",
      "| N11 - Production Hardening | Active | Fixture evidence. | N11.7 - Production Validation |",
      "",
      "N11.7 production validation is active.",
      "",
    ].join("\n");
  }

  if (file === "docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md") {
    return [
      "# Next Development Plan",
      "",
      "| Order | Increment | Goal | Status |",
      "| --- | --- | --- | --- |",
      "| N11.7 | Production validation gates | Add proof gates. | Current |",
      "",
      "```text",
      "  -> Production hardening (current: N11.7 production validation gates)",
      "```",
      "",
    ].join("\n");
  }

  if (file === "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md") {
    return [
      "# Load Baseline And Production Cut Runbook",
      "",
      "See `docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md`.",
      "",
      "Run the optional target-environment runtime evidence workflow.",
      "",
      "```text",
      "OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH=artifacts/target-env/runtime-evidence-input.json \\",
      "OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \\",
      "pnpm target-env:runtime",
      "```",
      "",
      "Use `docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json` as the starting skeleton.",
      "",
    ].join("\n");
  }

  if (file === "docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md") {
    return [
      "# Target Environment Evidence Collection Runbook",
      "",
      "Run `pnpm target-env:smoke`, `pnpm target-env:load`, `pnpm target-env:runtime`, and `pnpm target-env:bundle`.",
      "",
      "Use `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH`, `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH`, `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH`, `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`, `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH`, and `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
      "",
      "Start from `docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json` and `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json`.",
      "",
      "Update `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` and `docs/reviews/PRODUCTION_CUT_REVIEW.md` only after sanitized evidence passes validation.",
      "",
    ].join("\n");
  }

  return "fixture\n";
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

  if (typeof checkScript === "string" && !checkScript.includes("pnpm observability:check")) {
    findings.push(createFinding("check_script_missing_observability_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm slo:check")) {
    findings.push(createFinding("check_script_missing_slo_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm security:check")) {
    findings.push(createFinding("check_script_missing_security_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm e2e:check")) {
    findings.push(createFinding("check_script_missing_e2e_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm regression:check")) {
    findings.push(createFinding("check_script_missing_regression_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm recovery:check")) {
    findings.push(createFinding("check_script_missing_recovery_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm performance:check")) {
    findings.push(createFinding("check_script_missing_performance_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm target-env:check")) {
    findings.push(createFinding("check_script_missing_target_environment_gate", "blocker"));
  }

  if (typeof checkScript === "string" && !checkScript.includes("pnpm production:check")) {
    findings.push(createFinding("check_script_missing_production_gate", "blocker"));
  }
}

async function checkImplementationProgressDocuments(projectRoot, findings) {
  const implementationStatus = await readText(
    join(projectRoot, "docs/IMPLEMENTATION_STATUS.md"),
    findings,
    "implementation_status",
    "docs/IMPLEMENTATION_STATUS.md",
  );
  const nextDevelopmentPlan = await readText(
    join(projectRoot, "docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md"),
    findings,
    "next_development_plan",
    "docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md",
  );

  if (implementationStatus === undefined || nextDevelopmentPlan === undefined) {
    return;
  }

  if (!implementationStatus.includes("| N11 - Production Hardening")) {
    findings.push(createFinding("implementation_status_missing_n11_increment", "blocker"));
  }

  if (!implementationStatus.includes("N11.7 production validation is active")) {
    findings.push(createFinding("implementation_status_missing_n117_current_state", "blocker"));
  }

  if (!nextDevelopmentPlan.includes("| N11.7 | Production validation gates")) {
    findings.push(createFinding("next_development_plan_missing_n117_execution_row", "blocker"));
  }

  if (
    !nextDevelopmentPlan.includes(
      "-> Production hardening (current: N11.7 production validation gates)",
    )
  ) {
    findings.push(createFinding("next_development_plan_current_increment_drift", "blocker"));
  }

  if (/current:\s*N11\.(?:[0-6])\b/iu.test(nextDevelopmentPlan)) {
    findings.push(createFinding("next_development_plan_stale_current_increment", "blocker"));
  }
}

async function checkProductionCutRunbook(projectRoot, findings) {
  const runbook = await readText(
    join(projectRoot, "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md"),
    findings,
    "load_baseline_runbook",
    "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
  );

  if (runbook === undefined) {
    return;
  }

  if (!runbook.includes("pnpm target-env:runtime")) {
    findings.push(
      createFinding("load_baseline_runbook_missing_runtime_evidence_command", "blocker"),
    );
  }

  if (!runbook.includes("OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH")) {
    findings.push(
      createFinding("load_baseline_runbook_missing_runtime_evidence_input_path", "blocker"),
    );
  }

  if (!runbook.includes("OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH")) {
    findings.push(
      createFinding("load_baseline_runbook_missing_runtime_evidence_report_path", "blocker"),
    );
  }

  if (!runbook.includes("TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json")) {
    findings.push(
      createFinding("load_baseline_runbook_missing_runtime_evidence_template", "blocker"),
    );
  }

  if (!runbook.includes("docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md")) {
    findings.push(
      createFinding("load_baseline_runbook_missing_evidence_collection_link", "blocker"),
    );
  }
}

async function checkTargetEnvironmentEvidenceCollectionRunbook(projectRoot, findings) {
  const runbook = await readText(
    join(projectRoot, "docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md"),
    findings,
    "target_environment_evidence_collection_runbook",
    "docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md",
  );

  if (runbook === undefined) {
    return;
  }

  const requiredFragments = [
    ["target_environment_collection_runbook_missing_smoke_command", "pnpm target-env:smoke"],
    ["target_environment_collection_runbook_missing_load_command", "pnpm target-env:load"],
    ["target_environment_collection_runbook_missing_runtime_command", "pnpm target-env:runtime"],
    ["target_environment_collection_runbook_missing_bundle_command", "pnpm target-env:bundle"],
    [
      "target_environment_collection_runbook_missing_smoke_report_path",
      "OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_load_report_path",
      "OMNIWA_TARGET_ENV_LOAD_REPORT_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_runtime_input_path",
      "OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_runtime_report_path",
      "OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_bundle_output_path",
      "OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_bundle_input_path",
      "OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH",
    ],
    [
      "target_environment_collection_runbook_missing_runtime_template",
      "TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json",
    ],
    [
      "target_environment_collection_runbook_missing_bundle_template",
      "TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json",
    ],
    [
      "target_environment_collection_runbook_missing_validation_review",
      "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md",
    ],
    [
      "target_environment_collection_runbook_missing_production_cut_review",
      "docs/reviews/PRODUCTION_CUT_REVIEW.md",
    ],
  ];

  for (const [code, fragment] of requiredFragments) {
    if (!runbook.includes(fragment)) {
      findings.push(createFinding(code, "blocker"));
    }
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

async function readText(path, findings, category, target = path) {
  try {
    return await readFile(path, "utf8");
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
