import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createTargetEnvironmentEvidenceBundleTemplate,
  findUnsafeArtifactContent,
  validateTargetEnvironmentAlertSloDryRunArtifact,
  validateTargetEnvironmentEvidenceBundleArtifact,
  validateTargetEnvironmentLoadArtifact,
  validateTargetEnvironmentRuntimeEvidenceArtifact,
  validateTargetEnvironmentSmokeArtifact,
} from "./check-target-environment-evidence.mjs";

const defaultTemplatePath = "docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json";

export async function createTargetEnvironmentEvidenceBundle(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const findings = [];
  const outputPath = normalizeOptionalString(
    options.outputPath ?? process.env.OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH,
  );

  if (outputPath === undefined) {
    findings.push(createBundleFinding("target_environment_bundle_output_path_missing"));
    return freezeBundleReport({ status: "failed", checkedAtIso, findings, written: false });
  }

  const template = await readBundleTemplate(
    projectRoot,
    normalizeOptionalString(options.templatePath) ?? defaultTemplatePath,
    findings,
  );

  if (template === undefined) {
    return freezeBundleReport({ status: "failed", checkedAtIso, findings, written: false });
  }

  const bundle = {
    ...template,
    checkedAtIso,
    artifacts: {
      ...template.artifacts,
    },
  };

  await attachOptionalArtifact({
    projectRoot,
    bundle,
    kind: "smoke",
    artifactPath: options.smokeReportPath ?? process.env.OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH,
    artifactRef:
      options.smokeArtifactRef ??
      process.env.OMNIWA_TARGET_ENV_SMOKE_ARTIFACT_REF ??
      "target-env-smoke-report",
    validator: validateTargetEnvironmentSmokeArtifact,
    findings,
  });

  await attachOptionalArtifact({
    projectRoot,
    bundle,
    kind: "load",
    artifactPath: options.loadReportPath ?? process.env.OMNIWA_TARGET_ENV_LOAD_REPORT_PATH,
    artifactRef:
      options.loadArtifactRef ??
      process.env.OMNIWA_TARGET_ENV_LOAD_ARTIFACT_REF ??
      "target-env-load-report",
    validator: validateTargetEnvironmentLoadArtifact,
    findings,
  });

  await attachOptionalArtifact({
    projectRoot,
    bundle,
    kind: "alert_slo_dry_run",
    artifactKey: "alertSloDryRun",
    artifactPath:
      options.alertSloDryRunReportPath ??
      process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH,
    artifactRef:
      options.alertSloDryRunArtifactRef ??
      process.env.OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_ARTIFACT_REF ??
      "target-env-alert-slo-dry-run-report",
    validator: validateTargetEnvironmentAlertSloDryRunArtifact,
    findings,
  });

  await attachOptionalArtifact({
    projectRoot,
    bundle,
    kind: "runtime_evidence",
    artifactKey: "runtimeEvidence",
    artifactPath:
      options.runtimeEvidenceReportPath ??
      process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH,
    artifactRef:
      options.runtimeEvidenceArtifactRef ??
      process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_ARTIFACT_REF ??
      "target-env-runtime-evidence-report",
    validator: validateTargetEnvironmentRuntimeEvidenceArtifact,
    findings,
  });

  if (!validateTargetEnvironmentEvidenceBundleArtifact(bundle)) {
    findings.push(createBundleFinding("target_environment_bundle_generated_invalid_schema"));
  }

  if (findUnsafeArtifactContent(bundle) !== undefined) {
    findings.push(createBundleFinding("target_environment_bundle_generated_unsafe_content"));
  }

  if (findings.some((finding) => finding.severity === "blocker")) {
    return freezeBundleReport({ status: "failed", checkedAtIso, findings, written: false });
  }

  await writeJsonAtomic(resolveArtifactPath(projectRoot, outputPath), bundle);

  return freezeBundleReport({ status: "passed", checkedAtIso, findings, written: true });
}

async function readBundleTemplate(projectRoot, templatePath, findings) {
  let template;

  try {
    template = JSON.parse(await readFile(resolveArtifactPath(projectRoot, templatePath), "utf8"));
  } catch {
    findings.push(createBundleFinding("target_environment_bundle_template_unreadable"));
    return undefined;
  }

  if (!isSafeBundleTemplate(template)) {
    findings.push(createBundleFinding("target_environment_bundle_template_invalid_schema"));
  }

  if (findUnsafeArtifactContent(template) !== undefined) {
    findings.push(createBundleFinding("target_environment_bundle_template_unsafe_content"));
  }

  return findings.some((finding) => finding.severity === "blocker") ? undefined : template;
}

async function attachOptionalArtifact({
  projectRoot,
  bundle,
  kind,
  artifactKey = kind,
  artifactPath,
  artifactRef,
  validator,
  findings,
}) {
  const normalizedPath = normalizeOptionalString(artifactPath);

  if (normalizedPath === undefined) {
    return;
  }

  let artifact;

  try {
    artifact = JSON.parse(await readFile(resolveArtifactPath(projectRoot, normalizedPath), "utf8"));
  } catch {
    findings.push(createBundleFinding(`target_environment_${kind}_artifact_unreadable`));
    return;
  }

  if (!validator(artifact)) {
    findings.push(createBundleFinding(`target_environment_${kind}_artifact_invalid_schema`));
  }

  if (findUnsafeArtifactContent(artifact) !== undefined) {
    findings.push(createBundleFinding(`target_environment_${kind}_artifact_unsafe_content`));
  }

  if (findUnsafeArtifactContent({ artifactRef }) !== undefined) {
    findings.push(createBundleFinding(`target_environment_${kind}_artifact_ref_unsafe_content`));
  }

  if (!findings.some((finding) => finding.severity === "blocker")) {
    bundle.artifacts[artifactKey] = {
      artifactRef,
      status: artifact.status,
      summary: artifact,
    };
  }
}

function isSafeBundleTemplate(value) {
  return (
    validateTargetEnvironmentEvidenceBundleArtifact(value) &&
    value.status === "NOT_PROVEN" &&
    value.proofStates.targetEnvironmentProven === false &&
    value.proofStates.productionLoadProven === false &&
    value.proofStates.sloEvidenceProven === false &&
    value.components.every((component) => component.status === "PENDING")
  );
}

function resolveArtifactPath(projectRoot, artifactPath) {
  return isAbsolute(artifactPath) ? artifactPath : join(projectRoot, artifactPath);
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

function createBundleFinding(code) {
  return Object.freeze({
    code,
    severity: "blocker",
    safeDetailCode: code,
  });
}

function freezeBundleReport(report) {
  return Object.freeze({
    ...report,
    findings: Object.freeze([...report.findings]),
  });
}

async function main() {
  const report = await createTargetEnvironmentEvidenceBundle();

  if (report.status === "passed") {
    console.log("Target environment evidence bundle written.");
    return;
  }

  console.error("Target environment evidence bundle generation failed:");
  for (const finding of report.findings) {
    console.error(`- ${finding.severity}: ${finding.code}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export const targetEnvironmentEvidenceBundleTemplateForTests =
  createTargetEnvironmentEvidenceBundleTemplate;
