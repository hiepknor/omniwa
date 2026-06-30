import type { ConfigurationSnapshot } from "../configuration/configuration-snapshot.js";
import type { MediaAsset } from "../media/media-asset.js";
import type { MessageType } from "../messaging/message-type.js";
import type { WorkerJob } from "../operations/worker-job.js";
import type { GuardrailOutcome } from "./guardrail-outcome.js";
import type { ProviderProfile } from "../provider/provider-profile.js";
import type { AccessDecision } from "../security/access-decision.js";
import type { Session } from "../session/session.js";
import type { WebhookDelivery } from "../webhook/webhook-delivery.js";
import type {
  AuditEvidenceSafetyInput,
  CanSendMessageInput,
  DomainDataClassification,
  IntentScope,
  TelemetryProjectionSafetyInput,
} from "../specifications/domain-specifications.js";
import {
  canActivateConfiguration,
  canPerformPrivilegedMutation,
  canRetryWebhookDelivery,
  canSendMessage,
  isAuditEvidenceSafe,
  isProviderCapabilitySupported,
  isSessionUsable,
  isTelemetryProjectionSafe,
  isWebhookDeliverable,
} from "../specifications/domain-specifications.js";
import type { SpecificationResult } from "../specifications/specification-result.js";
import { failSpecification, isSpecificationPass } from "../specifications/specification-result.js";

export const policyOutcomes = [
  "allow",
  "reject",
  "block",
  "throttle",
  "action_required",
  "retry",
  "dead_letter",
  "recover",
] as const;

export type PolicyOutcome = (typeof policyOutcomes)[number];

export type PolicyDecision<TOutcome extends PolicyOutcome = PolicyOutcome> = Readonly<{
  outcome: TOutcome;
  specification: SpecificationResult;
}>;

export type ComplianceGuardrailInput = Readonly<{
  intentScope: IntentScope;
  rateLimitAllowed: boolean;
  abuseRiskDetected: boolean;
  configurationSafety: string;
  direction: "inbound" | "outbound";
}>;

export function evaluateMessageSendingPolicy(input: CanSendMessageInput): PolicyDecision {
  return decisionFromSpecification(canSendMessage(input), "allow", "reject");
}

export function evaluateMessageStatusPolicy(input: {
  translatedStatus: string;
  staleObservation: boolean;
}): PolicyDecision {
  const valid =
    !input.staleObservation &&
    ["sent", "delivered", "read", "failed"].includes(input.translatedStatus);

  return {
    outcome: valid ? "allow" : "reject",
    specification: valid
      ? { passed: true }
      : failSpecification({
          category: "external_signal_classification_error",
          ownerContext: "messaging",
          reasonCode: "message_status_not_translated",
          message: "Message status must be translated and non-stale.",
          recoverability: "time_correctable",
        }),
  };
}

export function evaluateWebhookRetryPolicy(
  delivery: WebhookDelivery,
  nextAttempt: number,
): PolicyDecision {
  const specification = canRetryWebhookDelivery(delivery, nextAttempt);
  return decisionFromSpecification(specification, "retry", "dead_letter");
}

export function evaluateWorkerJobRetryPolicy(job: WorkerJob, nextAttempt: number): PolicyDecision {
  const canRetry =
    !["completed", "dead"].includes(job.status) &&
    Number.isInteger(nextAttempt) &&
    nextAttempt <= job.retryPolicy.maxAttempts;

  return {
    outcome: canRetry ? "retry" : "dead_letter",
    specification: canRetry
      ? { passed: true }
      : failSpecification({
          category: "policy_violation",
          ownerContext: "operations",
          reasonCode: "worker_retry_not_allowed",
          message: "WorkerJob retry requires non-terminal state and remaining retry budget.",
          recoverability: "time_correctable",
        }),
  };
}

export function evaluateSessionRevocationPolicy(session: Session): PolicyDecision {
  return decisionFromSpecification(isSessionUsable(session), "allow", "action_required");
}

export function evaluateInstanceConnectionPolicy(input: {
  session: Session | undefined;
  translatedProviderReady: boolean;
  providerActionRequired: boolean;
}): PolicyDecision {
  const sessionUsable = isSpecificationPass(isSessionUsable(input.session));

  if (sessionUsable && input.translatedProviderReady && !input.providerActionRequired) {
    return { outcome: "allow", specification: { passed: true } };
  }

  return {
    outcome: input.providerActionRequired ? "action_required" : "reject",
    specification: failSpecification({
      category: "business_rule_violation",
      ownerContext: "instance",
      reasonCode: "instance_not_send_capable",
      message: "Instance requires usable session and translated provider readiness.",
      recoverability: "operator_correctable",
    }),
  };
}

export function evaluateMediaRetentionPolicy(input: {
  media: MediaAsset;
  diagnosticCaptureRequested: boolean;
  retentionBounded: boolean;
}): PolicyDecision {
  const allowed =
    input.media.status !== "cleaned" &&
    (!input.diagnosticCaptureRequested || input.retentionBounded);

  return {
    outcome: allowed ? "allow" : "reject",
    specification: allowed
      ? { passed: true }
      : failSpecification({
          category: "retention_rule_violation",
          ownerContext: "media",
          reasonCode: "media_retention_not_allowed",
          message: "Media retention requires explicit bounded retention.",
          recoverability: "caller_correctable",
        }),
  };
}

export function evaluateComplianceGuardrailPolicy(
  input: ComplianceGuardrailInput,
): GuardrailOutcome {
  if (input.configurationSafety === "guardrail_bypass_rejected" || input.abuseRiskDetected) {
    return "block";
  }

  if (!input.rateLimitAllowed) {
    return "throttle";
  }

  if (input.direction !== "outbound" || input.intentScope !== "single_message") {
    return "action_required";
  }

  return "allow";
}

export function evaluateProviderCapabilityPolicy(
  profile: ProviderProfile | undefined,
  messageType: MessageType,
): PolicyDecision {
  return decisionFromSpecification(
    isProviderCapabilitySupported(profile, messageType),
    "allow",
    "reject",
  );
}

export function evaluateConfigurationSafetyPolicy(
  snapshot: ConfigurationSnapshot,
  accessGranted: boolean,
): PolicyDecision {
  return decisionFromSpecification(
    canActivateConfiguration(snapshot, accessGranted),
    "allow",
    "reject",
  );
}

export function evaluateAuditRedactionPolicy(input: AuditEvidenceSafetyInput): PolicyDecision {
  return decisionFromSpecification(isAuditEvidenceSafe(input), "allow", "reject");
}

export function evaluatePrivilegedActionPolicy(
  decision: AccessDecision | undefined,
  capability: string,
): PolicyDecision {
  return decisionFromSpecification(
    canPerformPrivilegedMutation(decision, capability),
    "allow",
    "reject",
  );
}

export function evaluateHealthProjectionPolicy(input: {
  sourceSignalActionable: boolean;
  previousHealth: string;
}): PolicyDecision {
  const actionable = input.sourceSignalActionable || input.previousHealth !== "healthy";
  return { outcome: actionable ? "allow" : "reject", specification: { passed: true } };
}

export function evaluateTelemetrySafetyPolicy(
  input: TelemetryProjectionSafetyInput,
): PolicyDecision {
  return decisionFromSpecification(isTelemetryProjectionSafe(input), "allow", "reject");
}

export function evaluateWebhookSchedulingPolicy(
  input: Parameters<typeof isWebhookDeliverable>[0],
): PolicyDecision {
  return decisionFromSpecification(isWebhookDeliverable(input), "allow", "reject");
}

function decisionFromSpecification(
  specification: SpecificationResult,
  passOutcome: PolicyOutcome,
  failOutcome: PolicyOutcome,
): PolicyDecision {
  return {
    outcome: isSpecificationPass(specification) ? passOutcome : failOutcome,
    specification,
  };
}

export function isUnsafeForExternalDelivery(dataClassification: DomainDataClassification): boolean {
  return dataClassification === "secret";
}
