import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export const targetEnvironmentEvidenceStatuses = Object.freeze(["NOT_PROVEN", "PARTIAL", "PROVEN"]);

export const requiredTargetEnvironmentEvidenceFiles = Object.freeze([
  "tooling/production/check-target-environment-evidence.mjs",
  "tooling/production/run-target-environment-smoke.mjs",
  "tooling/performance/run-target-environment-load.mjs",
  "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md",
  "docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md",
]);

export const requiredTargetEnvironmentEvidenceTests = Object.freeze([
  "tooling/production/check-target-environment-evidence.spec.ts",
  "tooling/production/run-target-environment-smoke.spec.ts",
  "tooling/performance/run-target-environment-load.spec.ts",
]);

export const requiredTargetEnvironmentComponents = Object.freeze([
  "API Runtime",
  "Worker Runtime",
  "Provider Runtime",
  "Webhook Dispatcher",
  "PostgreSQL",
  "Redis",
  "EventLog",
  "Secret Provider",
  "Observability",
  "Backup/Restore",
]);

export const requiredTargetEnvironmentScriptName = "target-env:check";
export const targetEnvironmentSmokeScriptName = "target-env:smoke";
export const targetEnvironmentLoadScriptName = "target-env:load";

const allowedTargetEnvironmentEndpointPaths = Object.freeze([
  "/v1/health",
  "/v1/health/readiness",
  "/v1/instances",
]);

const unsafeArtifactKeyPattern =
  /(^|[_-])(api[_-]?key|authorization|bearer|token|secret|password|base[_-]?url|url|jid|phone|text|payload|qr|auth[_-]?state|session[_-]?material|response[_-]?body|body|raw)([_-]|$)/iu;
const unsafeArtifactStringPatterns = Object.freeze([
  /\bhttps?:\/\//iu,
  /@s\.whatsapp\.net\b/iu,
  /@g\.us\b/iu,
  /\bbearer\s+[a-z0-9._-]+/iu,
  /\bx-api-key\b/iu,
]);

export async function evaluateTargetEnvironmentEvidence(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtEpochMilliseconds = options.checkedAtEpochMilliseconds ?? Date.now();
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
  await checkTargetEnvironmentReview(projectRoot, findings);
  await checkRootPackage(projectRoot, findings);
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "smoke",
    options.smokeReportPath ?? process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "load",
    options.loadReportPath ?? process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH,
    findings,
  );
  await checkOptionalTargetEnvironmentArtifact(
    projectRoot,
    "bundle",
    options.evidenceBundlePath ?? process.env.OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH,
    findings,
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
    await writeText(join(projectRoot, file), "fixture\n");
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
    return;
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

  for (const component of requiredTargetEnvironmentComponents) {
    if (!hasComponentRow(content, component)) {
      findings.push(
        createFinding("target_environment_component_missing", "blocker", {
          target: component,
          safeDetailCode: "target_environment_component_missing",
        }),
      );
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

  if (!content.includes("OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH")) {
    findings.push(createFinding("target_environment_bundle_artifact_path_missing", "blocker"));
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
    isOptionalBundleArtifactRef(value.load, validateTargetEnvironmentLoadArtifact)
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
    artifact.components.every((component) => component.status === "PASS")
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
      if (unsafeArtifactKeyPattern.test(key)) {
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
    "- `pnpm target-env:check` with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.",
    "",
    "## Known Constraints",
    "",
    "- Fixture constraints recorded.",
    "",
  ].join("\n");
}

async function main() {
  const report = await evaluateTargetEnvironmentEvidence();

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
