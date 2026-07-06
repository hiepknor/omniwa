import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  findUnsafeArtifactContent,
  requiredTargetEnvironmentComponents,
  validateTargetEnvironmentRuntimeEvidenceArtifact,
} from "./check-target-environment-evidence.mjs";

const defaultDependencies = Object.freeze(["PostgreSQL", "Redis"]);
const defaultRuntimeEvidenceSafeErrorCode = "target_runtime_evidence_not_supplied";

export async function runTargetEnvironmentRuntimeEvidence(options = {}) {
  const checkedAtIso = options.checkedAtIso ?? new Date().toISOString();
  const inputPath = normalizeOptionalString(
    options.inputPath ?? process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH,
  );
  const inputResult =
    options.input === undefined
      ? await readInputFromPath(inputPath)
      : Object.freeze({ input: options.input, findings: [] });

  if (inputResult.input === undefined) {
    return createDefaultRuntimeEvidenceReport({
      checkedAtIso,
      findings:
        inputResult.findings.length === 0
          ? [
              createFinding(
                "target_runtime_evidence_input_missing",
                "warning",
                defaultRuntimeEvidenceSafeErrorCode,
              ),
            ]
          : inputResult.findings,
    });
  }

  if (findUnsafeArtifactContent(inputResult.input) !== undefined) {
    return createDefaultRuntimeEvidenceReport({
      checkedAtIso,
      findings: [
        createFinding(
          "target_runtime_evidence_input_unsafe_content",
          "blocker",
          "target_runtime_evidence_input_unsafe_content",
        ),
      ],
    });
  }

  if (!validateTargetEnvironmentRuntimeEvidenceArtifact(inputResult.input)) {
    return createDefaultRuntimeEvidenceReport({
      checkedAtIso,
      findings: [
        createFinding(
          "target_runtime_evidence_input_invalid_schema",
          "blocker",
          "target_runtime_evidence_input_invalid_schema",
        ),
      ],
    });
  }

  return freezeRuntimeEvidenceReport({
    ...inputResult.input,
    status: runtimeEvidenceStatus(inputResult.input),
    findings: inputResult.input.findings,
  });
}

async function readInputFromPath(inputPath) {
  if (inputPath === undefined) {
    return Object.freeze({ input: undefined, findings: [] });
  }

  try {
    return Object.freeze({
      input: JSON.parse(await readFile(inputPath, "utf8")),
      findings: [],
    });
  } catch {
    return Object.freeze({
      input: undefined,
      findings: [
        createFinding(
          "target_runtime_evidence_input_unreadable",
          "blocker",
          "target_runtime_evidence_input_unreadable",
        ),
      ],
    });
  }
}

function createDefaultRuntimeEvidenceReport({ checkedAtIso, findings }) {
  return freezeRuntimeEvidenceReport({
    status: "failed",
    checkedAtIso,
    runtimes: requiredTargetEnvironmentComponents.map((component) =>
      Object.freeze({
        component,
        started: false,
        readinessChecked: false,
        shutdownChecked: false,
        versionRef: `${component.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}-version-pending`,
        safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
      }),
    ),
    dependencies: defaultDependencies.map((dependency) =>
      Object.freeze({
        dependency,
        connectivityChecked: false,
        credentialBoundaryChecked: false,
        ...(dependency === "PostgreSQL" ? { migrationStatusChecked: false } : {}),
        safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
      }),
    ),
    providerCommandBridge: Object.freeze({
      workerConfigured: false,
      providerRuntimeServerConfigured: false,
      authenticationBoundaryChecked: false,
      commandRoundTripChecked: false,
      startupProofRef: "target-runtime-provider-command-bridge-startup-pending",
      workerClientProofRef: "target-runtime-provider-command-bridge-worker-client-pending",
      providerRuntimeServerProofRef: "target-runtime-provider-command-bridge-server-pending",
      authenticationProofRef: "target-runtime-provider-command-bridge-authentication-pending",
      roundTripProofRef: "target-runtime-provider-command-bridge-round-trip-pending",
      safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
    }),
    queueRuntime: Object.freeze({
      durableQueueProfileChecked: false,
      atomicReservationChecked: false,
      retryRecoveryChecked: false,
      deadLetterChecked: false,
      expiredLeaseRecoveryChecked: false,
      queueProfileProofRef: "target-runtime-queue-profile-pending",
      atomicReservationProofRef: "target-runtime-queue-atomic-reservation-pending",
      retryRecoveryProofRef: "target-runtime-queue-retry-recovery-pending",
      deadLetterProofRef: "target-runtime-queue-dead-letter-pending",
      expiredLeaseRecoveryProofRef: "target-runtime-queue-expired-lease-recovery-pending",
      safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
    }),
    observabilitySignals: Object.freeze({
      metricExporterChecked: false,
      structuredLoggingChecked: false,
      queueBacklogMetricsChecked: false,
      eventLogOutboxMetricsChecked: false,
      redactionChecked: false,
      metricsProofRef: "target-runtime-observability-metrics-pending",
      loggingProofRef: "target-runtime-observability-logging-pending",
      queueBacklogMetricsProofRef: "target-runtime-queue-backlog-metrics-pending",
      eventLogOutboxMetricsProofRef: "target-runtime-eventlog-outbox-metrics-pending",
      redactionProofRef: "target-runtime-observability-redaction-pending",
      safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
    }),
    backupRestore: Object.freeze({
      drillRef: "backup-restore-drill-pending",
      backupCreated: false,
      restoreValidated: false,
      rollbackOrForwardFixReviewed: false,
      safeErrorCode: defaultRuntimeEvidenceSafeErrorCode,
    }),
    findings,
  });
}

function runtimeEvidenceStatus(report) {
  return runtimeEvidenceChecksPass(report) ? "passed" : "failed";
}

function runtimeEvidenceChecksPass(report) {
  return (
    report.runtimes.every(
      (runtime) => runtime.started && runtime.readinessChecked && runtime.shutdownChecked,
    ) &&
    report.dependencies.every(
      (dependency) =>
        dependency.connectivityChecked &&
        dependency.credentialBoundaryChecked &&
        dependency.migrationStatusChecked !== false,
    ) &&
    report.providerCommandBridge.workerConfigured &&
    report.providerCommandBridge.providerRuntimeServerConfigured &&
    report.providerCommandBridge.authenticationBoundaryChecked &&
    report.providerCommandBridge.commandRoundTripChecked &&
    providerCommandBridgeProofRefsComplete(report.providerCommandBridge) &&
    report.queueRuntime.durableQueueProfileChecked &&
    report.queueRuntime.atomicReservationChecked &&
    report.queueRuntime.retryRecoveryChecked &&
    report.queueRuntime.deadLetterChecked &&
    report.queueRuntime.expiredLeaseRecoveryChecked &&
    queueRuntimeProofRefsComplete(report.queueRuntime) &&
    report.observabilitySignals.metricExporterChecked &&
    report.observabilitySignals.structuredLoggingChecked &&
    report.observabilitySignals.queueBacklogMetricsChecked &&
    report.observabilitySignals.eventLogOutboxMetricsChecked &&
    report.observabilitySignals.redactionChecked &&
    observabilityProofRefsComplete(report.observabilitySignals) &&
    report.backupRestore.backupCreated &&
    report.backupRestore.restoreValidated &&
    report.backupRestore.rollbackOrForwardFixReviewed &&
    report.findings.every((finding) => finding.severity !== "blocker")
  );
}

function providerCommandBridgeProofRefsComplete(providerCommandBridge) {
  return [
    providerCommandBridge.startupProofRef,
    providerCommandBridge.workerClientProofRef,
    providerCommandBridge.providerRuntimeServerProofRef,
    providerCommandBridge.authenticationProofRef,
    providerCommandBridge.roundTripProofRef,
  ].every((value) => typeof value === "string" && value.length > 0 && !value.includes("pending"));
}

function queueRuntimeProofRefsComplete(queueRuntime) {
  return [
    queueRuntime.queueProfileProofRef,
    queueRuntime.atomicReservationProofRef,
    queueRuntime.retryRecoveryProofRef,
    queueRuntime.deadLetterProofRef,
    queueRuntime.expiredLeaseRecoveryProofRef,
  ].every((value) => typeof value === "string" && value.length > 0 && !value.includes("pending"));
}

function observabilityProofRefsComplete(observabilitySignals) {
  return [
    observabilitySignals.metricsProofRef,
    observabilitySignals.loggingProofRef,
    observabilitySignals.queueBacklogMetricsProofRef,
    observabilitySignals.eventLogOutboxMetricsProofRef,
    observabilitySignals.redactionProofRef,
  ].every((value) => typeof value === "string" && value.length > 0 && !value.includes("pending"));
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function createFinding(code, severity, safeDetailCode = code) {
  return Object.freeze({
    code,
    severity,
    safeDetailCode,
  });
}

function freezeRuntimeEvidenceReport(report) {
  return Object.freeze({
    status: report.status,
    checkedAtIso: report.checkedAtIso,
    runtimes: Object.freeze(report.runtimes.map((runtime) => Object.freeze({ ...runtime }))),
    dependencies: Object.freeze(
      report.dependencies.map((dependency) => Object.freeze({ ...dependency })),
    ),
    providerCommandBridge: Object.freeze({ ...report.providerCommandBridge }),
    queueRuntime: Object.freeze({ ...report.queueRuntime }),
    observabilitySignals: Object.freeze({ ...report.observabilitySignals }),
    backupRestore: Object.freeze({ ...report.backupRestore }),
    findings: Object.freeze(report.findings.map((finding) => Object.freeze({ ...finding }))),
  });
}

export async function writeTargetEnvironmentRuntimeEvidenceReport(report, reportPath) {
  const normalizedPath = normalizeOptionalString(reportPath);

  if (normalizedPath === undefined) {
    return Object.freeze({ ok: true });
  }

  try {
    await mkdir(dirname(normalizedPath), { recursive: true });
    await writeFile(normalizedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({
      ok: false,
      safeErrorCode: "target_runtime_evidence_report_write_failed",
    });
  }
}

async function main() {
  const report = await runTargetEnvironmentRuntimeEvidence({
    inputPath: process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH,
  });
  const writeResult = await writeTargetEnvironmentRuntimeEvidenceReport(
    report,
    process.env.OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH,
  );

  console.log(JSON.stringify(report, null, 2));

  if (!writeResult.ok) {
    console.error(JSON.stringify(writeResult, null, 2));
  }

  if (report.status !== "passed" || !writeResult.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
