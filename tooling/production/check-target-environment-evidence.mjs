import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export const targetEnvironmentEvidenceStatuses = Object.freeze(["NOT_PROVEN", "PARTIAL", "PROVEN"]);

export const requiredTargetEnvironmentEvidenceFiles = Object.freeze([
  "tooling/production/check-target-environment-evidence.mjs",
  "tooling/production/create-target-environment-evidence-bundle.mjs",
  "tooling/production/run-target-environment-runtime-evidence.mjs",
  "tooling/production/run-target-environment-smoke.mjs",
  "tooling/performance/run-target-environment-load.mjs",
  "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md",
  "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json",
  "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
]);

export const requiredTargetEnvironmentEvidenceTests = Object.freeze([
  "tooling/production/check-target-environment-evidence.spec.ts",
  "tooling/production/create-target-environment-evidence-bundle.spec.ts",
  "tooling/production/run-target-environment-runtime-evidence.spec.ts",
  "tooling/production/run-target-environment-smoke.spec.ts",
  "tooling/performance/run-target-environment-load.spec.ts",
]);

export const requiredTargetEnvironmentComponents = Object.freeze([
  "API Runtime",
  "Worker Runtime",
  "Provider Runtime",
  "Background Runtime",
  "Webhook Dispatcher",
  "PostgreSQL",
  "Redis",
  "EventLog",
  "Secret Provider",
  "Observability",
  "Backup/Restore",
]);

export const requiredTargetEnvironmentScriptName = "target-env:check";
export const targetEnvironmentBundleScriptName = "target-env:bundle";
export const targetEnvironmentRuntimeScriptName = "target-env:runtime";
export const targetEnvironmentSmokeScriptName = "target-env:smoke";
export const targetEnvironmentLoadScriptName = "target-env:load";

const allowedTargetEnvironmentEndpointPaths = Object.freeze([
  "/v1/health",
  "/v1/health/readiness",
  "/v1/instances",
]);

const unsafeArtifactKeyPattern =
  /(^|[_-])(api[_-]?key|authorization|bearer|token|secret|password|base[_-]?url|url|jid|phone|text|payload|qr|auth[_-]?state|session[_-]?material|response[_-]?body|body|raw)([_-]|$)/iu;
const unsafeArtifactNormalizedKeyFragments = Object.freeze([
  "apikey",
  "authorization",
  "bearer",
  "token",
  "secret",
  "password",
  "baseurl",
  "url",
  "jid",
  "phone",
  "text",
  "payload",
  "qr",
  "authstate",
  "sessionmaterial",
  "responsebody",
  "body",
  "raw",
  "connectionstring",
  "databaseurl",
  "redisurl",
]);
const unsafeArtifactStringPatterns = Object.freeze([
  /\bhttps?:\/\//iu,
  /\bpostgres(?:ql)?:\/\//iu,
  /\bredis(?:s)?:\/\//iu,
  /@s\.whatsapp\.net\b/iu,
  /@g\.us\b/iu,
  /\bbearer\s+[a-z0-9._-]+/iu,
  /\bx-api-key\b/iu,
]);

export async function evaluateTargetEnvironmentEvidence(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
  const env = options.env ?? {};
  const findings = [];

  await checkFiles(
    projectRoot,
    "target_environment_evidence",
    requiredTargetEnvironmentEvidenceFiles,
    findings,
  );
  await checkFiles(
    projectRoot,
    "target_environment_evidence_test",
    requiredTargetEnvironmentEvidenceTests,
    findings,
  );
  const reviewSnapshot = await checkTargetEnvironmentReview(projectRoot, findings);
  await checkTargetEnvironmentBundleTemplate(projectRoot, findings);
  await checkTargetEnvironmentRuntimeEvidenceInputTemplate(projectRoot, findings);
  await checkRootPackage(projectRoot, findings);
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "smoke",
    options.smokeReportPath ?? env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "load",
    options.loadReportPath ?? env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "alert_slo_dry_run",
    options.alertSloDryRunReportPath ?? env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "runtime_evidence",
    options.runtimeEvidenceReportPath ?? env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "bundle",
    options.evidenceBundlePath ?? env.OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH,
    findings,
    reviewSnapshot,
  );

  return freezeReport({
    status: findings.some((finding) => finding.severity === "blocker") ? "failed" : "passed",
    checkedAtEpochMilliseconds,
    findings,
  });
}

export async function createTargetEnvironmentFixture(projectRoot, status = "NOT_PROVEN") {
  await writeJson(join(projectRoot, "package.json"), {
    name: "omniwa-target-environment-fixture",
    private: true,
    type: "module",
    packageManager: "pnpm@11.5.2",
    scripts: {
      [requiredTargetEnvironmentScriptName]: targetEnvironmentScript(),
      [targetEnvironmentBundleScriptName]:
        "node tooling/production/create-target-environment-evidence-bundle.mjs",
      [targetEnvironmentRuntimeScriptName]:
        "node tooling/production/run-target-environment-runtime-evidence.mjs",
      [targetEnvironmentSmokeScriptName]:
        "node tooling/production/run-target-environment-smoke.mjs",
      [targetEnvironmentLoadScriptName]: "node tooling/performance/run-target-environment-load.mjs",
      "production:check":
        "pnpm target-env:check && node tooling/production/check-production-cut.mjs",
      check: "pnpm lint && pnpm target-env:check && pnpm production:check",
    },
  });

  for (const file of [
    ...requiredTargetEnvironmentEvidenceFiles,
    ...requiredTargetEnvironmentEvidenceTests,
  ]) {
    if (file === "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json") {
      await writeJson(join(projectRoot, file), createTargetEnvironmentEvidenceBundleTemplate());
    } else if (file === "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json") {
      await writeJson(
        join(projectRoot, file),
        createTargetEnvironmentRuntimeEvidenceInputTemplate(),
      );
    } else {
      await writeText(join(projectRoot, file), "fixture\n");
    }
  }

  await writeText(
    join(projectRoot, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
    fixtureReview(status),
  );
}

export function targetEnvironmentScript() {
  return [
    "node tooling/production/check-target-environment-evidence.mjs",
    "pnpm exec vitest run",
    ...requiredTargetEnvironmentEvidenceTests,
  ].join(" ");
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

async function checkTargetEnvironmentReview(projectRoot, findings) {
  let content;

  try {
    content = await readFile(
      join(projectRoot, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
      "utf8",
    );
  } catch {
    return undefined;
  }

  const status = content.match(/Target Environment Validation Status:\s*([A-Z_]+)/u)?.[1];
  if (status === undefined || !targetEnvironmentEvidenceStatuses.includes(status)) {
    findings.push(createFinding("target_environment_status_missing_or_invalid", "blocker"));
  }

  const targetEnvironmentProven = readYesNo(
    content,
    "Target Environment Proven",
    "target_environment_proof_state_missing",
    findings,
  );
  const productionLoadProven = readYesNo(
    content,
    "Production Load Proven",
    "production_load_proof_state_missing",
    findings,
  );
  const sloEvidenceProven = readYesNo(
    content,
    "SLO Evidence Proven",
    "slo_evidence_proof_state_missing",
    findings,
  );

  const componentStatuses = new Map();

  for (const component of requiredTargetEnvironmentComponents) {
    const componentStatus = readComponentStatus(content, component);
    if (componentStatus === undefined) {
      findings.push(
        createFinding("target_environment_component_missing", "blocker", {
          target: component,
          safeDetailCode: "target_environment_component_missing",
        }),
      );
    } else {
      componentStatuses.set(component, componentStatus);
    }
  }

  if (!content.includes("## Validation Commands")) {
    findings.push(createFinding("target_environment_validation_commands_missing", "blocker"));
  }

  if (!content.includes("pnpm target-env:smoke")) {
    findings.push(createFinding("target_environment_smoke_command_missing", "blocker"));
  }

  if (!content.includes("OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH")) {
    findings.push(createFinding("target_environment_smoke_artifact_path_missing", "blocker"));
  }

  if (!content.includes("pnpm target-env:load")) {
    findings.push(createFinding("target_environment_load_command_missing", "blocker"));
  }

  if (!content.includes("OMNIWA_TARGET_ENV_LOAD_REPORT_PATH")) {
    findings.push(createFinding("target_environment_load_artifact_path_missing", "blocker"));
  }

  if (!content.includes("OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH")) {
    findings.push(
      createFinding("target_environment_alert_slo_dry_run_artifact_path_missing", "blocker"),
    );
  }

  if (!content.includes("OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH")) {
    findings.push(
      createFinding("target_environment_runtime_evidence_artifact_path_missing", "blocker"),
    );
  }

  if (!content.includes("pnpm target-env:runtime")) {
    findings.push(createFinding("target_environment_runtime_command_missing", "blocker"));
  }

  if (!content.includes("OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH")) {
    findings.push(createFinding("target_environment_bundle_artifact_path_missing", "blocker"));
  }

  if (!content.includes("pnpm target-env:bundle")) {
    findings.push(createFinding("target_environment_bundle_command_missing", "blocker"));
  }

  if (!content.includes("OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH")) {
    findings.push(createFinding("target_environment_bundle_output_path_missing", "blocker"));
  }

  if (!content.includes("## Known Constraints")) {
    findings.push(createFinding("target_environment_known_constraints_missing", "blocker"));
  }

  if (status === "PROVEN") {
    if (targetEnvironmentProven !== "YES") {
      findings.push(createFinding("proven_target_environment_requires_yes", "blocker"));
    }

    if (productionLoadProven !== "YES") {
      findings.push(createFinding("proven_production_load_requires_yes", "blocker"));
    }

    if (sloEvidenceProven !== "YES") {
      findings.push(createFinding("proven_slo_evidence_requires_yes", "blocker"));
    }

    for (const component of requiredTargetEnvironmentComponents) {
      if (!hasComponentRow(content, component, "PASS")) {
        findings.push(
          createFinding("proven_component_must_pass", "blocker", {
            target: component,
            safeDetailCode: "proven_component_must_pass",
          }),
        );
      }
    }
  }

  return freezeReviewSnapshot({
    status,
    targetEnvironmentProven,
    productionLoadProven,
    sloEvidenceProven,
    componentStatuses,
  });
}

async function checkTargetEnvironmentBundleTemplate(projectRoot, findings) {
  let template;

  try {
    template = JSON.parse(
      await readFile(
        join(projectRoot, "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json"),
        "utf8",
      ),
    );
  } catch {
    findings.push(createFinding("target_environment_bundle_template_unreadable", "blocker"));
    return;
  }

  if (!isTargetEnvironmentEvidenceBundleTemplate(template)) {
    findings.push(createFinding("target_environment_bundle_template_invalid_schema", "blocker"));
  }

  if (findUnsafeArtifactContent(template) !== undefined) {
    findings.push(createFinding("target_environment_bundle_template_unsafe_content", "blocker"));
  }
}

async function checkTargetEnvironmentRuntimeEvidenceInputTemplate(projectRoot, findings) {
  let template;

  try {
    template = JSON.parse(
      await readFile(
        join(projectRoot, "docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json"),
        "utf8",
      ),
    );
  } catch {
    findings.push(
      createFinding("target_environment_runtime_evidence_input_template_unreadable", "blocker"),
    );
    return;
  }

  if (!isTargetEnvironmentRuntimeEvidenceInputTemplate(template)) {
    findings.push(
      createFinding("target_environment_runtime_evidence_input_template_invalid_schema", "blocker"),
    );
  }

  if (findUnsafeArtifactContent(template) !== undefined) {
    findings.push(
      createFinding("target_environment_runtime_evidence_input_template_unsafe_content", "blocker"),
    );
  }
}

async function checkRootPackage(projectRoot, findings) {
  const packageJson = await readJson(join(projectRoot, "package.json"), findings);

  if (packageJson === undefined) {
    return;
  }

  const scripts = packageJson.scripts;
  if (!isRecord(scripts)) {
    findings.push(createFinding("root_scripts_missing", "blocker"));
    return;
  }

  const targetEnvironmentCheck = scripts[requiredTargetEnvironmentScriptName];
  if (typeof targetEnvironmentCheck !== "string" || targetEnvironmentCheck.length === 0) {
    findings.push(
      createFinding("root_target_environment_script_missing", "blocker", {
        target: requiredTargetEnvironmentScriptName,
      }),
    );
    return;
  }

  if (
    !targetEnvironmentCheck.includes(
      "node tooling/production/check-target-environment-evidence.mjs",
    )
  ) {
    findings.push(createFinding("root_target_environment_script_missing_tooling_gate", "blocker"));
  }

  if (targetEnvironmentCheck.includes("--passWithNoTests")) {
    findings.push(
      createFinding("root_target_environment_script_must_not_pass_with_no_tests", "blocker"),
    );
  }

  for (const testFile of requiredTargetEnvironmentEvidenceTests) {
    if (!targetEnvironmentCheck.includes(testFile)) {
      findings.push(
        createFinding("root_target_environment_script_missing_test", "blocker", {
          target: testFile,
          safeDetailCode: "root_target_environment_script_missing_test",
        }),
      );
    }
  }

  const targetEnvironmentSmoke = scripts[targetEnvironmentSmokeScriptName];
  if (
    typeof targetEnvironmentSmoke !== "string" ||
    !targetEnvironmentSmoke.includes("node tooling/production/run-target-environment-smoke.mjs")
  ) {
    findings.push(
      createFinding("root_target_environment_smoke_script_missing", "blocker", {
        target: targetEnvironmentSmokeScriptName,
        safeDetailCode: "root_target_environment_smoke_script_missing",
      }),
    );
  }

  const targetEnvironmentLoad = scripts[targetEnvironmentLoadScriptName];
  if (
    typeof targetEnvironmentLoad !== "string" ||
    !targetEnvironmentLoad.includes("node tooling/performance/run-target-environment-load.mjs")
  ) {
    findings.push(
      createFinding("root_target_environment_load_script_missing", "blocker", {
        target: targetEnvironmentLoadScriptName,
        safeDetailCode: "root_target_environment_load_script_missing",
      }),
    );
  }

  const targetEnvironmentBundle = scripts[targetEnvironmentBundleScriptName];
  if (
    typeof targetEnvironmentBundle !== "string" ||
    !targetEnvironmentBundle.includes(
      "node tooling/production/create-target-environment-evidence-bundle.mjs",
    )
  ) {
    findings.push(
      createFinding("root_target_environment_bundle_script_missing", "blocker", {
        target: targetEnvironmentBundleScriptName,
        safeDetailCode: "root_target_environment_bundle_script_missing",
      }),
    );
  }

  const targetEnvironmentRuntime = scripts[targetEnvironmentRuntimeScriptName];
  if (
    typeof targetEnvironmentRuntime !== "string" ||
    !targetEnvironmentRuntime.includes(
      "node tooling/production/run-target-environment-runtime-evidence.mjs",
    )
  ) {
    findings.push(
      createFinding("root_target_environment_runtime_script_missing", "blocker", {
        target: targetEnvironmentRuntimeScriptName,
        safeDetailCode: "root_target_environment_runtime_script_missing",
      }),
    );
  }

  const productionCheck = scripts["production:check"];
  if (typeof productionCheck !== "string" || !productionCheck.includes("pnpm target-env:check")) {
    findings.push(createFinding("production_script_missing_target_environment_gate", "blocker"));
  }

  const checkScript = scripts.check;
  if (typeof checkScript !== "string" || !checkScript.includes("pnpm target-env:check")) {
    findings.push(createFinding("check_script_missing_target_environment_gate", "blocker"));
  }
}

async function checkOptionalTargetEnvironmentArtifact(
  projectRoot,
  artifactKind,
  artifactPath,
  findings,
  reviewSnapshot,
) {
  const normalizedPath = typeof artifactPath === "string" ? artifactPath.trim() : "";

  if (normalizedPath.length === 0) {
    return;
  }

  let content;

  try {
    content = await readFile(resolveArtifactPath(projectRoot, normalizedPath), "utf8");
  } catch {
    findings.push(
      createFinding(`target_environment_${artifactKind}_artifact_unreadable`, "blocker"),
    );
    return;
  }

  let artifact;

  try {
    artifact = JSON.parse(content);
  } catch {
    findings.push(
      createFinding(`target_environment_${artifactKind}_artifact_invalid_json`, "blocker"),
    );
    return;
  }

  const schemaValid =
    artifactKind === "smoke"
      ? validateTargetEnvironmentSmokeArtifact(artifact)
      : artifactKind === "load"
        ? validateTargetEnvironmentLoadArtifact(artifact)
        : artifactKind === "alert_slo_dry_run"
          ? validateTargetEnvironmentAlertSloDryRunArtifact(artifact)
          : artifactKind === "runtime_evidence"
            ? validateTargetEnvironmentRuntimeEvidenceArtifact(artifact)
            : validateTargetEnvironmentEvidenceBundleArtifact(artifact);

  if (!schemaValid) {
    findings.push(
      createFinding(`target_environment_${artifactKind}_artifact_invalid_schema`, "blocker"),
    );
  }

  if (findUnsafeArtifactContent(artifact) !== undefined) {
    findings.push(
      createFinding(`target_environment_${artifactKind}_artifact_unsafe_content`, "blocker"),
    );
  }

  if (artifactKind === "bundle" && schemaValid) {
    checkEvidenceBundleMatchesReview(artifact, reviewSnapshot, findings);
  }
}

function resolveArtifactPath(projectRoot, artifactPath) {
  return isAbsolute(artifactPath) ? artifactPath : join(projectRoot, artifactPath);
}

export function validateTargetEnvironmentSmokeArtifact(artifact) {
  return (
    isRecord(artifact) &&
    isArtifactStatus(artifact.status) &&
    isNonEmptyString(artifact.checkedAtIso) &&
    Array.isArray(artifact.endpoints) &&
    artifact.endpoints.every(isSmokeEndpointArtifact) &&
    Array.isArray(artifact.findings) &&
    artifact.findings.every(isFindingArtifact)
  );
}

export function validateTargetEnvironmentLoadArtifact(artifact) {
  return (
    isRecord(artifact) &&
    isArtifactStatus(artifact.status) &&
    isNonEmptyString(artifact.checkedAtIso) &&
    isLoadBudgetsArtifact(artifact.budgets) &&
    isLoadSummaryArtifact(artifact.summary) &&
    Array.isArray(artifact.endpoints) &&
    artifact.endpoints.every(isLoadEndpointArtifact) &&
    Array.isArray(artifact.findings) &&
    artifact.findings.every(isFindingArtifact)
  );
}

export function validateTargetEnvironmentAlertSloDryRunArtifact(artifact) {
  return (
    isRecord(artifact) &&
    isArtifactStatus(artifact.status) &&
    isNonEmptyString(artifact.checkedAtIso) &&
    Array.isArray(artifact.dashboards) &&
    artifact.dashboards.every(isDashboardDryRunArtifact) &&
    Array.isArray(artifact.alertRoutes) &&
    artifact.alertRoutes.every(isAlertRouteDryRunArtifact) &&
    Array.isArray(artifact.sloWindows) &&
    artifact.sloWindows.every(isSloWindowDryRunArtifact) &&
    Array.isArray(artifact.findings) &&
    artifact.findings.every(isFindingArtifact)
  );
}

export function validateTargetEnvironmentRuntimeEvidenceArtifact(artifact) {
  return (
    isRecord(artifact) &&
    isArtifactStatus(artifact.status) &&
    isNonEmptyString(artifact.checkedAtIso) &&
    Array.isArray(artifact.runtimes) &&
    hasExactlyRequiredComponents(artifact.runtimes) &&
    artifact.runtimes.every(isRuntimeEvidenceArtifact) &&
    Array.isArray(artifact.dependencies) &&
    artifact.dependencies.every(isDependencyEvidenceArtifact) &&
    isProviderCommandBridgeEvidenceArtifact(artifact.providerCommandBridge) &&
    isBackupRestoreEvidenceArtifact(artifact.backupRestore) &&
    Array.isArray(artifact.findings) &&
    artifact.findings.every(isFindingArtifact)
  );
}

export function validateTargetEnvironmentEvidenceBundleArtifact(artifact) {
  return (
    isRecord(artifact) &&
    artifact.version === 1 &&
    targetEnvironmentEvidenceStatuses.includes(artifact.status) &&
    isNonEmptyString(artifact.checkedAtIso) &&
    isTargetEnvironmentProofStates(artifact.proofStates) &&
    isTargetEnvironmentEvidenceRefs(artifact.evidence) &&
    Array.isArray(artifact.components) &&
    hasExactlyRequiredComponents(artifact.components) &&
    artifact.components.every(isTargetEnvironmentComponentArtifact) &&
    isTargetEnvironmentBundleArtifacts(artifact.artifacts) &&
    Array.isArray(artifact.findings) &&
    artifact.findings.every(isFindingArtifact) &&
    isValidProvenBundleClaim(artifact)
  );
}

export function createTargetEnvironmentEvidenceBundleTemplate() {
  return Object.freeze({
    version: 1,
    status: "NOT_PROVEN",
    checkedAtIso: "1970-01-01T00:00:00.000Z",
    proofStates: Object.freeze({
      targetEnvironmentProven: false,
      productionLoadProven: false,
      sloEvidenceProven: false,
    }),
    evidence: Object.freeze({
      deploymentProfileRef: "operator-evidence-deployment-profile-pending",
      runtimeVersionsRef: "operator-evidence-runtime-versions-pending",
      startupSummaryRef: "operator-evidence-startup-summary-pending",
      healthReadinessRef: "operator-evidence-health-readiness-pending",
      dependencyConnectivityRef: "operator-evidence-dependency-connectivity-pending",
      providerCommandBridgeRef: "operator-evidence-provider-command-bridge-pending",
      backupRestoreDrillRef: "operator-evidence-backup-restore-drill-pending",
      productionLoadSummaryRef: "operator-evidence-production-load-summary-pending",
      alertSloDryRunRef: "operator-evidence-alert-slo-dry-run-pending",
      rollbackOrForwardFixNotesRef: "operator-evidence-rollback-forward-fix-notes-pending",
    }),
    components: Object.freeze(
      requiredTargetEnvironmentComponents.map((component) =>
        Object.freeze({
          component,
          status: "PENDING",
          evidenceRef: `operator-evidence-${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-pending`,
        }),
      ),
    ),
    artifacts: Object.freeze({
      smoke: Object.freeze({
        artifactRef: "operator-evidence-smoke-report-pending",
      }),
      load: Object.freeze({
        artifactRef: "operator-evidence-load-report-pending",
      }),
      alertSloDryRun: Object.freeze({
        artifactRef: "operator-evidence-alert-slo-dry-run-pending",
      }),
      runtimeEvidence: Object.freeze({
        artifactRef: "operator-evidence-runtime-evidence-pending",
      }),
    }),
    findings: Object.freeze([
      Object.freeze({
        code: "target_environment_evidence_not_collected",
        severity: "warning",
        safeDetailCode: "operator_evidence_required",
      }),
    ]),
  });
}

export function createTargetEnvironmentRuntimeEvidenceInputTemplate() {
  return Object.freeze({
    status: "failed",
    checkedAtIso: "1970-01-01T00:00:00.000Z",
    runtimes: Object.freeze(
      requiredTargetEnvironmentComponents.map((component) =>
        Object.freeze({
          component,
          started: false,
          readinessChecked: false,
          shutdownChecked: false,
          versionRef: `operator-evidence-${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-version-pending`,
          safeErrorCode: "operator_runtime_evidence_required",
        }),
      ),
    ),
    dependencies: Object.freeze([
      Object.freeze({
        dependency: "PostgreSQL",
        connectivityChecked: false,
        credentialBoundaryChecked: false,
        migrationStatusChecked: false,
        safeErrorCode: "operator_runtime_evidence_required",
      }),
      Object.freeze({
        dependency: "Redis",
        connectivityChecked: false,
        credentialBoundaryChecked: false,
        safeErrorCode: "operator_runtime_evidence_required",
      }),
    ]),
    providerCommandBridge: Object.freeze({
      workerConfigured: false,
      providerRuntimeServerConfigured: false,
      authenticationBoundaryChecked: false,
      commandRoundTripChecked: false,
      startupProofRef: "operator-evidence-provider-command-bridge-startup-pending",
      workerClientProofRef: "operator-evidence-provider-command-bridge-worker-client-pending",
      providerRuntimeServerProofRef: "operator-evidence-provider-command-bridge-server-pending",
      authenticationProofRef: "operator-evidence-provider-command-bridge-authentication-pending",
      roundTripProofRef: "operator-evidence-provider-command-bridge-round-trip-pending",
      safeErrorCode: "operator_runtime_evidence_required",
    }),
    backupRestore: Object.freeze({
      drillRef: "operator-evidence-backup-restore-drill-pending",
      backupCreated: false,
      restoreValidated: false,
      rollbackOrForwardFixReviewed: false,
      safeErrorCode: "operator_runtime_evidence_required",
    }),
    findings: Object.freeze([
      Object.freeze({
        code: "target_runtime_evidence_input_not_collected",
        severity: "warning",
        safeDetailCode: "operator_runtime_evidence_required",
      }),
    ]),
  });
}

function isSmokeEndpointArtifact(value) {
  return (
    isRecord(value) &&
    value.method === "GET" &&
    isAllowedEndpointPath(value.path) &&
    typeof value.ok === "boolean" &&
    isHttpStatusCode(value.statusCode) &&
    isNonEmptyString(value.checkedAtIso) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isLoadEndpointArtifact(value) {
  return (
    isRecord(value) &&
    value.method === "GET" &&
    isAllowedEndpointPath(value.path) &&
    isNonNegativeInteger(value.requests) &&
    isNonNegativeInteger(value.successes) &&
    isNonNegativeInteger(value.failures) &&
    isCountRecord(value.statusCodeCounts) &&
    isCountRecord(value.safeErrorCodeCounts)
  );
}

function isLoadBudgetsArtifact(value) {
  return (
    isRecord(value) &&
    isPositiveInteger(value.requestCount) &&
    isPositiveInteger(value.concurrency) &&
    isPositiveInteger(value.timeoutMilliseconds) &&
    isPositiveInteger(value.maxP95LatencyMilliseconds) &&
    isPercent(value.minSuccessRatePercent)
  );
}

function isLoadSummaryArtifact(value) {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.totalRequests) &&
    isNonNegativeInteger(value.successes) &&
    isNonNegativeInteger(value.failures) &&
    isPercent(value.successRatePercent) &&
    isNonNegativeNumber(value.durationMilliseconds) &&
    isNonNegativeNumber(value.p95LatencyMilliseconds) &&
    isNonNegativeNumber(value.maxLatencyMilliseconds)
  );
}

function isDashboardDryRunArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.dashboardId) &&
    typeof value.accessible === "boolean" &&
    isNonNegativeInteger(value.panelCount) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isAlertRouteDryRunArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.alertId) &&
    typeof value.routeChecked === "boolean" &&
    typeof value.notificationDryRun === "boolean" &&
    (value.receiverClass === undefined || isNonEmptyString(value.receiverClass)) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isSloWindowDryRunArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.area) &&
    typeof value.windowChecked === "boolean" &&
    typeof value.budgetPolicyChecked === "boolean" &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isRuntimeEvidenceArtifact(value) {
  return (
    isRecord(value) &&
    requiredTargetEnvironmentComponents.includes(value.component) &&
    typeof value.started === "boolean" &&
    typeof value.readinessChecked === "boolean" &&
    typeof value.shutdownChecked === "boolean" &&
    isNonEmptyString(value.versionRef) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isDependencyEvidenceArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.dependency) &&
    typeof value.connectivityChecked === "boolean" &&
    typeof value.credentialBoundaryChecked === "boolean" &&
    (value.migrationStatusChecked === undefined ||
      typeof value.migrationStatusChecked === "boolean") &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isProviderCommandBridgeEvidenceArtifact(value) {
  return (
    isRecord(value) &&
    typeof value.workerConfigured === "boolean" &&
    typeof value.providerRuntimeServerConfigured === "boolean" &&
    typeof value.authenticationBoundaryChecked === "boolean" &&
    typeof value.commandRoundTripChecked === "boolean" &&
    isNonEmptyString(value.startupProofRef) &&
    isNonEmptyString(value.workerClientProofRef) &&
    isNonEmptyString(value.providerRuntimeServerProofRef) &&
    isNonEmptyString(value.authenticationProofRef) &&
    isNonEmptyString(value.roundTripProofRef) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isBackupRestoreEvidenceArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.drillRef) &&
    typeof value.backupCreated === "boolean" &&
    typeof value.restoreValidated === "boolean" &&
    typeof value.rollbackOrForwardFixReviewed === "boolean" &&
    (value.rpoSeconds === undefined || isNonNegativeInteger(value.rpoSeconds)) &&
    (value.rtoSeconds === undefined || isNonNegativeInteger(value.rtoSeconds)) &&
    (value.safeErrorCode === undefined || isNonEmptyString(value.safeErrorCode))
  );
}

function isTargetEnvironmentProofStates(value) {
  return (
    isRecord(value) &&
    typeof value.targetEnvironmentProven === "boolean" &&
    typeof value.productionLoadProven === "boolean" &&
    typeof value.sloEvidenceProven === "boolean"
  );
}

function isTargetEnvironmentEvidenceRefs(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.deploymentProfileRef) &&
    isNonEmptyString(value.runtimeVersionsRef) &&
    isNonEmptyString(value.startupSummaryRef) &&
    isNonEmptyString(value.healthReadinessRef) &&
    isNonEmptyString(value.dependencyConnectivityRef) &&
    isNonEmptyString(value.providerCommandBridgeRef) &&
    isNonEmptyString(value.backupRestoreDrillRef) &&
    isNonEmptyString(value.productionLoadSummaryRef) &&
    isNonEmptyString(value.alertSloDryRunRef) &&
    isNonEmptyString(value.rollbackOrForwardFixNotesRef)
  );
}

function hasExactlyRequiredComponents(components) {
  const names = new Set(
    components
      .filter((component) => isRecord(component) && typeof component.component === "string")
      .map((component) => component.component),
  );

  return (
    names.size === requiredTargetEnvironmentComponents.length &&
    requiredTargetEnvironmentComponents.every((component) => names.has(component))
  );
}

function isTargetEnvironmentComponentArtifact(value) {
  return (
    isRecord(value) &&
    requiredTargetEnvironmentComponents.includes(value.component) &&
    isTargetEnvironmentComponentStatus(value.status) &&
    isNonEmptyString(value.evidenceRef)
  );
}

function isTargetEnvironmentBundleArtifacts(value) {
  return (
    isRecord(value) &&
    isOptionalBundleArtifactRef(value.smoke, validateTargetEnvironmentSmokeArtifact) &&
    isOptionalBundleArtifactRef(value.load, validateTargetEnvironmentLoadArtifact) &&
    isOptionalBundleArtifactRef(
      value.alertSloDryRun,
      validateTargetEnvironmentAlertSloDryRunArtifact,
    ) &&
    isOptionalBundleArtifactRef(
      value.runtimeEvidence,
      validateTargetEnvironmentRuntimeEvidenceArtifact,
    )
  );
}

function isOptionalBundleArtifactRef(value, validator) {
  return (
    value === undefined ||
    (isRecord(value) &&
      isNonEmptyString(value.artifactRef) &&
      (value.status === undefined || isArtifactStatus(value.status)) &&
      (value.summary === undefined || validator(value.summary)))
  );
}

function isTargetEnvironmentComponentStatus(value) {
  return value === "PENDING" || value === "PASS" || value === "FAIL";
}

function isValidProvenBundleClaim(artifact) {
  if (artifact.status !== "PROVEN") {
    return true;
  }

  return (
    artifact.proofStates.targetEnvironmentProven === true &&
    artifact.proofStates.productionLoadProven === true &&
    artifact.proofStates.sloEvidenceProven === true &&
    artifact.components.every(
      (component) => component.status === "PASS" && isCompleteEvidenceRef(component.evidenceRef),
    ) &&
    Object.values(artifact.evidence).every(isCompleteEvidenceRef) &&
    isPassedBundleArtifact(artifact.artifacts.smoke) &&
    isPassedBundleArtifact(artifact.artifacts.load) &&
    isPassedBundleArtifact(artifact.artifacts.alertSloDryRun) &&
    isPassedBundleArtifact(artifact.artifacts.runtimeEvidence)
  );
}

function isPassedBundleArtifact(value) {
  return (
    isRecord(value) &&
    value.status === "passed" &&
    value.summary !== undefined &&
    isCompleteEvidenceRef(value.artifactRef)
  );
}

function isCompleteEvidenceRef(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("pending");
}

function checkEvidenceBundleMatchesReview(artifact, reviewSnapshot, findings) {
  if (reviewSnapshot === undefined || !isRecord(artifact)) {
    return;
  }

  if (artifact.status !== reviewSnapshot.status) {
    findings.push(createFinding("target_environment_bundle_review_status_mismatch", "blocker"));
  }

  if (
    artifact.proofStates.targetEnvironmentProven !==
    yesNoToBoolean(reviewSnapshot.targetEnvironmentProven)
  ) {
    findings.push(
      createFinding("target_environment_bundle_review_target_proof_mismatch", "blocker"),
    );
  }

  if (
    artifact.proofStates.productionLoadProven !==
    yesNoToBoolean(reviewSnapshot.productionLoadProven)
  ) {
    findings.push(createFinding("target_environment_bundle_review_load_proof_mismatch", "blocker"));
  }

  if (artifact.proofStates.sloEvidenceProven !== yesNoToBoolean(reviewSnapshot.sloEvidenceProven)) {
    findings.push(createFinding("target_environment_bundle_review_slo_proof_mismatch", "blocker"));
  }

  for (const component of artifact.components) {
    const reviewComponentStatus = reviewSnapshot.componentStatuses.get(component.component);

    if (reviewComponentStatus !== component.status) {
      findings.push(
        createFinding("target_environment_bundle_review_component_status_mismatch", "blocker", {
          target: component.component,
          safeDetailCode: "target_environment_bundle_review_component_status_mismatch",
        }),
      );
    }
  }
}

function yesNoToBoolean(value) {
  return value === "YES";
}

function freezeReviewSnapshot(snapshot) {
  return Object.freeze({
    status: snapshot.status,
    targetEnvironmentProven: snapshot.targetEnvironmentProven,
    productionLoadProven: snapshot.productionLoadProven,
    sloEvidenceProven: snapshot.sloEvidenceProven,
    componentStatuses: new Map(snapshot.componentStatuses),
  });
}

function isTargetEnvironmentEvidenceBundleTemplate(artifact) {
  return (
    validateTargetEnvironmentEvidenceBundleArtifact(artifact) &&
    artifact.status === "NOT_PROVEN" &&
    artifact.proofStates.targetEnvironmentProven === false &&
    artifact.proofStates.productionLoadProven === false &&
    artifact.proofStates.sloEvidenceProven === false &&
    artifact.components.every((component) => component.status === "PENDING")
  );
}

function isTargetEnvironmentRuntimeEvidenceInputTemplate(artifact) {
  return (
    validateTargetEnvironmentRuntimeEvidenceArtifact(artifact) &&
    artifact.status === "failed" &&
    artifact.runtimes.every(
      (runtime) =>
        runtime.started === false &&
        runtime.readinessChecked === false &&
        runtime.shutdownChecked === false &&
        runtime.safeErrorCode === "operator_runtime_evidence_required",
    ) &&
    artifact.dependencies.every(
      (dependency) =>
        dependency.connectivityChecked === false &&
        dependency.credentialBoundaryChecked === false &&
        dependency.migrationStatusChecked !== true &&
        dependency.safeErrorCode === "operator_runtime_evidence_required",
    ) &&
    artifact.providerCommandBridge.workerConfigured === false &&
    artifact.providerCommandBridge.providerRuntimeServerConfigured === false &&
    artifact.providerCommandBridge.authenticationBoundaryChecked === false &&
    artifact.providerCommandBridge.commandRoundTripChecked === false &&
    artifact.providerCommandBridge.startupProofRef.endsWith("-pending") &&
    artifact.providerCommandBridge.workerClientProofRef.endsWith("-pending") &&
    artifact.providerCommandBridge.providerRuntimeServerProofRef.endsWith("-pending") &&
    artifact.providerCommandBridge.authenticationProofRef.endsWith("-pending") &&
    artifact.providerCommandBridge.roundTripProofRef.endsWith("-pending") &&
    artifact.providerCommandBridge.safeErrorCode === "operator_runtime_evidence_required" &&
    artifact.backupRestore.backupCreated === false &&
    artifact.backupRestore.restoreValidated === false &&
    artifact.backupRestore.rollbackOrForwardFixReviewed === false &&
    artifact.backupRestore.safeErrorCode === "operator_runtime_evidence_required" &&
    artifact.findings.some(
      (finding) =>
        finding.code === "target_runtime_evidence_input_not_collected" &&
        finding.severity === "warning" &&
        finding.safeDetailCode === "operator_runtime_evidence_required",
    )
  );
}

function isFindingArtifact(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.code) &&
    (value.severity === "blocker" || value.severity === "warning") &&
    isNonEmptyString(value.safeDetailCode)
  );
}

function isCountRecord(value) {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, count]) => isNonEmptyString(key) && isNonNegativeInteger(count),
    )
  );
}

function isArtifactStatus(value) {
  return value === "passed" || value === "failed";
}

function isAllowedEndpointPath(value) {
  return typeof value === "string" && allowedTargetEnvironmentEndpointPaths.includes(value);
}

function isHttpStatusCode(value) {
  return Number.isInteger(value) && value >= 0 && value <= 599;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPercent(value) {
  return isNonNegativeNumber(value) && value <= 100;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function findUnsafeArtifactContent(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const unsafe = findUnsafeArtifactContent(item);

      if (unsafe !== undefined) {
        return unsafe;
      }
    }

    return undefined;
  }

  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (isUnsafeArtifactKey(key)) {
        return key;
      }

      const unsafe = findUnsafeArtifactContent(nestedValue);

      if (unsafe !== undefined) {
        return unsafe;
      }
    }

    return undefined;
  }

  if (typeof value === "string") {
    return unsafeArtifactStringPatterns.some((pattern) => pattern.test(value)) ? value : undefined;
  }

  return undefined;
}

function isUnsafeArtifactKey(key) {
  if (unsafeArtifactKeyPattern.test(key)) {
    return true;
  }

  const normalizedKey = key.replaceAll(/[^a-z0-9]+/giu, "").toLowerCase();

  return unsafeArtifactNormalizedKeyFragments.some((fragment) => normalizedKey.includes(fragment));
}

function readYesNo(content, label, missingCode, findings) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = content.match(new RegExp(`${escapedLabel}:\\s*(YES|NO)`, "u"))?.[1];

  if (value === undefined) {
    findings.push(createFinding(missingCode, "blocker"));
  }

  return value;
}

function hasComponentRow(content, component, requiredStatus) {
  const escapedComponent = component.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const statusPattern = requiredStatus === undefined ? "[A-Z_]+" : requiredStatus;
  const pattern = new RegExp(`\\|\\s*${escapedComponent}\\s*\\|\\s*${statusPattern}\\s*\\|`, "u");

  return pattern.test(content);
}

function readComponentStatus(content, component) {
  const escapedComponent = component.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = content.match(
    new RegExp(`\\|\\s*${escapedComponent}\\s*\\|\\s*([A-Z_]+)\\s*\\|`, "u"),
  )?.[1];

  return isTargetEnvironmentComponentStatus(value) ? value : undefined;
}

async function readJson(path, findings) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    findings.push(
      createFinding("root_package_unreadable", "blocker", {
        target: "package.json",
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

async function writeJson(path, data) {
  await writeText(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeText(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function fixtureReview(status) {
  const proofValue = status === "PROVEN" ? "YES" : "NO";
  const rowStatus = status === "PROVEN" ? "PASS" : "PENDING";

  return [
    "# Target Environment Validation",
    "",
    `Target Environment Validation Status: ${status}`,
    "",
    `Target Environment Proven: ${proofValue}`,
    "",
    `Production Load Proven: ${proofValue}`,
    "",
    `SLO Evidence Proven: ${proofValue}`,
    "",
    "## Runtime Evidence Matrix",
    "",
    "| Component | Status | Evidence |",
    "| --- | --- | --- |",
    ...requiredTargetEnvironmentComponents.map(
      (component) => `| ${component} | ${rowStatus} | Fixture evidence. |`,
    ),
    "",
    "## Validation Commands",
    "",
    "- `pnpm check`",
    "- `pnpm target-env:smoke` with `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH`.",
    "- `pnpm target-env:load` with `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`.",
    "- `pnpm target-env:runtime` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH` and `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`.",
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
    "- `pnpm target-env:bundle` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH`.",
    "",
    "## Known Constraints",
    "",
    "- Fixture constraints recorded.",
    "",
  ].join("\n");
}

async function main() {
  const report = await evaluateTargetEnvironmentEvidence({ env: process.env });

  if (report.status === "passed") {
    console.log(`Target environment evidence gate passed with ${report.findings.length} findings.`);
    return;
  }

  console.error("Target environment evidence gate failed:");
  for (const finding of report.findings) {
    const target = finding.target === undefined ? "" : ` (${finding.target})`;
    console.error(`- ${finding.severity}: ${finding.code}${target}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
