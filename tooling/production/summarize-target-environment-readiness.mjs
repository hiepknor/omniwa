import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateTargetEnvironmentEvidence,
  requiredTargetEnvironmentComponents,
  targetEnvironmentEvidenceStatuses,
} from "./check-target-environment-evidence.mjs";

export const targetEnvironmentReadinessArtifactInputs = Object.freeze([
  Object.freeze({
    kind: "smoke",
    envVar: "OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH",
    optionKey: "smokeReportPath",
  }),
  Object.freeze({
    kind: "load",
    envVar: "OMNIWA_TARGET_ENV_LOAD_REPORT_PATH",
    optionKey: "loadReportPath",
  }),
  Object.freeze({
    kind: "alert_slo_dry_run",
    envVar: "OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH",
    optionKey: "alertSloDryRunReportPath",
  }),
  Object.freeze({
    kind: "runtime_evidence",
    envVar: "OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH",
    optionKey: "runtimeEvidenceReportPath",
  }),
  Object.freeze({
    kind: "evidence_bundle",
    envVar: "OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH",
    optionKey: "evidenceBundlePath",
  }),
]);

export async function summarizeTargetEnvironmentReadiness(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const env = options.env ?? {};
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const review = await readTargetEnvironmentReview(projectRoot);
  const artifacts = targetEnvironmentReadinessArtifactInputs.map((artifact) =>
    freezeArtifactInputSummary({
      kind: artifact.kind,
      envVar: artifact.envVar,
      supplied:
        normalizeOptionalString(options[artifact.optionKey] ?? env[artifact.envVar]) !== undefined,
    }),
  );
  const gate = await evaluateTargetEnvironmentEvidence({
    projectRoot,
    checkedAtEpochMilliseconds: Date.parse(checkedAtIso),
    env,
    smokeReportPath: options.smokeReportPath,
    loadReportPath: options.loadReportPath,
    alertSloDryRunReportPath: options.alertSloDryRunReportPath,
    runtimeEvidenceReportPath: options.runtimeEvidenceReportPath,
    evidenceBundlePath: options.evidenceBundlePath,
  });
  const nextActions = summarizeNextActions({ review, artifacts, gate });

  return freezeReadinessSummary({
    status: readinessStatus({ review, gate }),
    checkedAtIso,
    review,
    artifacts,
    gate: freezeGateSummary(gate),
    nextActions,
  });
}

async function readTargetEnvironmentReview(projectRoot) {
  let content;

  try {
    content = await readFile(
      join(projectRoot, "docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md"),
      "utf8",
    );
  } catch {
    return freezeReviewSummary({
      status: "UNKNOWN",
      proofStates: {
        targetEnvironmentProven: "UNKNOWN",
        productionLoadProven: "UNKNOWN",
        sloEvidenceProven: "UNKNOWN",
      },
      components: summarizeComponents(new Map()),
    });
  }

  const componentStatuses = new Map(
    requiredTargetEnvironmentComponents.map((component) => [
      component,
      readComponentStatus(content, component) ?? "UNKNOWN",
    ]),
  );
  const status = content.match(/Target Environment Validation Status:\s*([A-Z_]+)/u)?.[1];

  return freezeReviewSummary({
    status:
      typeof status === "string" && targetEnvironmentEvidenceStatuses.includes(status)
        ? status
        : "UNKNOWN",
    proofStates: {
      targetEnvironmentProven: readYesNo(content, "Target Environment Proven"),
      productionLoadProven: readYesNo(content, "Production Load Proven"),
      sloEvidenceProven: readYesNo(content, "SLO Evidence Proven"),
    },
    components: summarizeComponents(componentStatuses),
  });
}

function summarizeComponents(componentStatuses) {
  const items = requiredTargetEnvironmentComponents.map((component) =>
    freezeComponentSummary({
      component,
      status: componentStatuses.get(component) ?? "UNKNOWN",
    }),
  );

  return Object.freeze({
    total: items.length,
    pass: items.filter((item) => item.status === "PASS").length,
    pending: items.filter((item) => item.status === "PENDING").length,
    fail: items.filter((item) => item.status === "FAIL").length,
    unknown: items.filter((item) => item.status === "UNKNOWN").length,
    items: Object.freeze(items),
  });
}

function summarizeNextActions({ review, artifacts, gate }) {
  if (gate.status === "passed" && reviewIsProven(review)) {
    return Object.freeze([]);
  }

  const actions = [];

  if (gate.status !== "passed") {
    actions.push("resolve_target_env_check_blockers");
  }

  if (review.status !== "PROVEN") {
    actions.push("collect_target_environment_evidence_before_proven_claim");
  }

  if (
    review.proofStates.targetEnvironmentProven !== "YES" ||
    review.proofStates.productionLoadProven !== "YES" ||
    review.proofStates.sloEvidenceProven !== "YES"
  ) {
    actions.push("update_all_proof_states_to_yes_only_after_artifact_review");
  }

  if (review.components.pass !== review.components.total) {
    actions.push("update_runtime_evidence_matrix_components_to_pass_after_validation");
  }

  for (const artifact of artifacts) {
    if (!artifact.supplied) {
      actions.push(`supply_${artifact.kind}_artifact_when_available`);
    }
  }

  return Object.freeze([...new Set(actions)]);
}

function readinessStatus({ review, gate }) {
  if (gate.status !== "passed") {
    return "blocked";
  }

  if (reviewIsProven(review)) {
    return "ready_for_production_cut_review";
  }

  return "not_ready";
}

function reviewIsProven(review) {
  return (
    review.status === "PROVEN" &&
    review.proofStates.targetEnvironmentProven === "YES" &&
    review.proofStates.productionLoadProven === "YES" &&
    review.proofStates.sloEvidenceProven === "YES" &&
    review.components.pass === review.components.total
  );
}

function readYesNo(content, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return content.match(new RegExp(`${escapedLabel}:\\s*(YES|NO)`, "u"))?.[1] ?? "UNKNOWN";
}

function readComponentStatus(content, component) {
  const escapedComponent = component.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const status = content.match(
    new RegExp(`\\|\\s*${escapedComponent}\\s*\\|\\s*([A-Z_]+)\\s*\\|`, "u"),
  )?.[1];

  return status === "PASS" || status === "PENDING" || status === "FAIL" ? status : undefined;
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function freezeReviewSummary(summary) {
  return Object.freeze({
    status: summary.status,
    proofStates: Object.freeze({ ...summary.proofStates }),
    components: summary.components,
  });
}

function freezeComponentSummary(summary) {
  return Object.freeze({
    component: summary.component,
    status: summary.status,
  });
}

function freezeArtifactInputSummary(summary) {
  return Object.freeze({
    kind: summary.kind,
    envVar: summary.envVar,
    supplied: summary.supplied,
  });
}

function freezeGateSummary(gate) {
  const blockerCodes = gate.findings
    .filter((finding) => finding.severity === "blocker")
    .map((finding) => finding.code);
  const warningCodes = gate.findings
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.code);

  return Object.freeze({
    status: gate.status,
    blockerCount: blockerCodes.length,
    warningCount: warningCodes.length,
    blockerCodes: Object.freeze(blockerCodes),
    warningCodes: Object.freeze(warningCodes),
  });
}

function freezeReadinessSummary(summary) {
  return Object.freeze({
    status: summary.status,
    checkedAtIso: summary.checkedAtIso,
    review: summary.review,
    artifacts: Object.freeze([...summary.artifacts]),
    gate: summary.gate,
    nextActions: Object.freeze([...summary.nextActions]),
  });
}

async function main() {
  const summary = await summarizeTargetEnvironmentReadiness({
    env: process.env,
  });

  console.log(JSON.stringify(summary, null, 2));

  if (summary.status === "blocked") {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
