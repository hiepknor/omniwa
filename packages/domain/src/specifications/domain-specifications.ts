import type { ConfigurationSnapshot } from "../configuration/configuration-snapshot.js";
import type { GuardrailDecision } from "../guardrails/guardrail-decision.js";
import type { GroupProviderCapability } from "../group/group-provider-capability.js";
import type { MediaAsset } from "../media/media-asset.js";
import { mediaCategories, type MediaCategory } from "../media/media-category.js";
import type { MessageType } from "../messaging/message-type.js";
import { isSupportedMessageType } from "../messaging/message-type.js";
import type { WorkerJob } from "../operations/worker-job.js";
import type { ProviderProfile } from "../provider/provider-profile.js";
import type { AccessDecision } from "../security/access-decision.js";
import type { Session } from "../session/session.js";
import type { WebhookDelivery } from "../webhook/webhook-delivery.js";
import type { WebhookSubscription } from "../webhook/webhook-subscription.js";
import {
  failSpecification,
  isSpecificationPass,
  passSpecification,
  type SpecificationResult,
} from "./specification-result.js";

export const dataClassifications = ["public", "internal", "confidential", "secret"] as const;

export type DomainDataClassification = (typeof dataClassifications)[number];

export type IntentScope =
  "single_message" | "broadcast" | "campaign" | "group_admin" | "automation";

export type CanSendMessageInput = Readonly<{
  messageType: string;
  session: Session | undefined;
  guardrailDecision: GuardrailDecision | undefined;
  providerProfile: ProviderProfile | undefined;
  mediaAsset?: MediaAsset;
  intentScope: IntentScope;
}>;

export type WebhookDeliverabilityInput = Readonly<{
  subscription: WebhookSubscription | undefined;
  sourceSignalRef: string;
  dataClassification: DomainDataClassification;
  idempotencyKeyPresent: boolean;
  signalSelected: boolean;
}>;

export type AuditEvidenceSafetyInput = Readonly<{
  sourceSignalRef: string;
  dataClassification: DomainDataClassification;
  redacted: boolean;
  retentionCategoryPresent: boolean;
}>;

export type TelemetryProjectionSafetyInput = Readonly<{
  dataClassification: DomainDataClassification;
  redacted: boolean;
  correlationSafe: boolean;
  projectionCategoryApproved: boolean;
}>;

export function isMessageTypeSupported(value: string): SpecificationResult {
  if (isSupportedMessageType(value)) {
    return passSpecification();
  }

  return failSpecification({
    category: "unsupported_capability",
    ownerContext: "messaging",
    reasonCode: "unsupported_message_type",
    message: "Message type is outside MVP send scope.",
    recoverability: "design_blocked",
  });
}

export function isMediaTypeSupported(value: string): SpecificationResult {
  if (mediaCategories.includes(value as MediaCategory)) {
    return passSpecification();
  }

  return failSpecification({
    category: "unsupported_capability",
    ownerContext: "media",
    reasonCode: "unsupported_media_type",
    message: "Media category is outside MVP media scope.",
    recoverability: "design_blocked",
  });
}

export function isSessionUsable(session: Session | undefined): SpecificationResult {
  if (session?.status === "active" && !session.requiresRecovery) {
    return passSpecification();
  }

  return failSpecification({
    category: "business_rule_violation",
    ownerContext: "session",
    reasonCode: "session_not_usable",
    message: "Session must be active and not recovery-required.",
    recoverability: "operator_correctable",
  });
}

export function isGuardrailDecisionPassing(
  decision: GuardrailDecision | undefined,
  evaluatedIntentRef?: string,
): SpecificationResult {
  const sameIntent =
    evaluatedIntentRef === undefined || decision?.evaluatedIntentRef === evaluatedIntentRef;

  if (decision?.outcome === "allow" && decision.status === "passed" && sameIntent) {
    return passSpecification();
  }

  return failSpecification({
    category: "policy_violation",
    ownerContext: "guardrails",
    reasonCode: "guardrail_not_passing",
    message: "Guardrail decision must explicitly allow the same intent.",
    recoverability: "caller_correctable",
  });
}

export function isProviderCapabilitySupported(
  profile: ProviderProfile | undefined,
  messageType: MessageType,
): SpecificationResult {
  const supported =
    profile !== undefined &&
    (profile.status === "supported" || profile.status === "degraded") &&
    profile.supportedMessageTypes.includes(messageType);

  if (supported) {
    return passSpecification();
  }

  return failSpecification({
    category: "unsupported_capability",
    ownerContext: "provider_integration",
    reasonCode: "provider_capability_not_supported",
    message: "Provider profile does not support the approved product capability.",
    recoverability: "operator_correctable",
  });
}

export function isGroupProviderCapabilitySupported(
  profile: ProviderProfile | undefined,
  capability: GroupProviderCapability,
): SpecificationResult {
  const supported =
    profile !== undefined &&
    (profile.status === "supported" || profile.status === "degraded") &&
    profile.supportedGroupCapabilities.includes(capability);

  if (supported) {
    return passSpecification();
  }

  return failSpecification({
    category: "unsupported_capability",
    ownerContext: "group",
    reasonCode: "group_provider_capability_not_supported",
    message: "Provider profile does not support the approved group capability.",
    recoverability: "operator_correctable",
  });
}

export function isMediaReadyForMessage(
  mediaAsset: MediaAsset | undefined,
  messageType: MessageType,
): SpecificationResult {
  if (messageType === "text") {
    return passSpecification();
  }

  if (mediaAsset === undefined) {
    return failSpecification({
      category: "business_rule_violation",
      ownerContext: "media",
      reasonCode: "media_required",
      message: "Media-bearing message requires a media asset.",
      recoverability: "caller_correctable",
    });
  }

  if (
    mediaAsset.category !== messageType ||
    !["processed", "attached"].includes(mediaAsset.status)
  ) {
    return failSpecification({
      category: "business_rule_violation",
      ownerContext: "media",
      reasonCode: "media_not_ready",
      message: "Media asset must match the message type and be processed or attached.",
      recoverability: "caller_correctable",
    });
  }

  return passSpecification();
}

export function canSendMessage(input: CanSendMessageInput): SpecificationResult {
  const typeResult = isMessageTypeSupported(input.messageType);
  if (!isSpecificationPass(typeResult)) return typeResult;

  if (input.intentScope !== "single_message") {
    return failSpecification({
      category: "unsupported_capability",
      ownerContext: "messaging",
      reasonCode: "unsupported_intent_scope",
      message: "Broadcast, campaign, group administration, and automation scope are out of MVP.",
      recoverability: "design_blocked",
    });
  }

  const messageType = input.messageType as MessageType;
  const checks = [
    isSessionUsable(input.session),
    isGuardrailDecisionPassing(input.guardrailDecision),
    isProviderCapabilitySupported(input.providerProfile, messageType),
    isMediaReadyForMessage(input.mediaAsset, messageType),
  ];

  return checks.find((result) => !isSpecificationPass(result)) ?? passSpecification();
}

export function canReconnectInstance(input: {
  instanceStatus: string;
  sessionUsableOrRecoverable: boolean;
  concurrentReconnectActive: boolean;
}): SpecificationResult {
  if (
    input.instanceStatus !== "destroyed" &&
    input.instanceStatus !== "logged_out" &&
    input.sessionUsableOrRecoverable &&
    !input.concurrentReconnectActive
  ) {
    return passSpecification();
  }

  return failSpecification({
    category: "invalid_state_transition",
    ownerContext: "instance",
    reasonCode: "reconnect_not_allowed",
    message: "Instance reconnect requires recoverable instance/session state.",
    recoverability: "operator_correctable",
  });
}

export function isWebhookSubscriptionActive(
  subscription: WebhookSubscription | undefined,
): SpecificationResult {
  if (subscription?.status === "active") {
    return passSpecification();
  }

  return failSpecification({
    category: "invalid_state_transition",
    ownerContext: "webhook_delivery",
    reasonCode: "webhook_subscription_not_active",
    message: "Webhook subscription must be active before delivery scheduling.",
    recoverability: "caller_correctable",
  });
}

export function isWebhookDeliverable(input: WebhookDeliverabilityInput): SpecificationResult {
  const activeResult = isWebhookSubscriptionActive(input.subscription);
  if (!isSpecificationPass(activeResult)) return activeResult;

  if (
    !input.signalSelected ||
    input.dataClassification === "secret" ||
    !input.idempotencyKeyPresent
  ) {
    return failSpecification({
      category:
        input.dataClassification === "secret" ? "sensitive_data_violation" : "policy_violation",
      ownerContext: "webhook_delivery",
      reasonCode: "webhook_not_deliverable",
      message: "Webhook delivery requires selected signal, safe data, and idempotency.",
      recoverability: "caller_correctable",
    });
  }

  return passSpecification();
}

export function canRetryWebhookDelivery(
  delivery: WebhookDelivery,
  nextAttempt: number,
): SpecificationResult {
  if (
    !["delivered", "dead_letter", "cancelled", "failed"].includes(delivery.status) &&
    Number.isInteger(nextAttempt) &&
    nextAttempt <= delivery.retryPolicy.maxAttempts
  ) {
    return passSpecification();
  }

  return failSpecification({
    category: "policy_violation",
    ownerContext: "webhook_delivery",
    reasonCode: "webhook_retry_not_allowed",
    message: "Webhook retry requires non-terminal state and remaining retry budget.",
    recoverability: "time_correctable",
  });
}

export function canReserveWorkerJob(job: WorkerJob): SpecificationResult {
  if (job.status === "queued" || job.status === "retrying") {
    return passSpecification();
  }

  return failSpecification({
    category: "invalid_state_transition",
    ownerContext: "operations",
    reasonCode: "worker_job_not_reservable",
    message: "WorkerJob can only be reserved from queued or retrying state.",
    recoverability: "time_correctable",
  });
}

export function canCompleteWorkerJob(
  job: WorkerJob,
  resultClassificationSafe: boolean,
): SpecificationResult {
  if (job.status === "running" && resultClassificationSafe) {
    return passSpecification();
  }

  return failSpecification({
    category: "consistency_error",
    ownerContext: "operations",
    reasonCode: "worker_job_not_completable",
    message: "WorkerJob completion requires running state and safe result classification.",
    recoverability: "caller_correctable",
  });
}

export function canPerformPrivilegedMutation(
  decision: AccessDecision | undefined,
  capability: string,
): SpecificationResult {
  if (
    decision?.status === "granted" &&
    decision.outcome === "granted" &&
    decision.capability === capability &&
    decision.auditEligible
  ) {
    return passSpecification();
  }

  return failSpecification({
    category: "access_decision_violation",
    ownerContext: "security_access",
    reasonCode: "privileged_access_not_granted",
    message: "Privileged mutation requires granted access and audit eligibility.",
    recoverability: "caller_correctable",
  });
}

export function canActivateConfiguration(
  snapshot: ConfigurationSnapshot,
  accessGranted: boolean,
): SpecificationResult {
  if (snapshot.status === "validated" && snapshot.safety === "valid" && accessGranted) {
    return passSpecification();
  }

  return failSpecification({
    category:
      snapshot.safety === "guardrail_bypass_rejected"
        ? "policy_violation"
        : "configuration_domain_error",
    ownerContext: "configuration",
    reasonCode: "configuration_not_activatable",
    message: "Configuration must be validated, safe, and access-approved before activation.",
    recoverability: "caller_correctable",
  });
}

export function isAuditEvidenceSafe(input: AuditEvidenceSafetyInput): SpecificationResult {
  if (
    input.sourceSignalRef.length > 0 &&
    input.dataClassification !== "secret" &&
    (input.dataClassification !== "confidential" || input.redacted) &&
    input.retentionCategoryPresent
  ) {
    return passSpecification();
  }

  return failSpecification({
    category:
      input.dataClassification === "secret"
        ? "sensitive_data_violation"
        : "retention_rule_violation",
    ownerContext: "audit",
    reasonCode: "audit_evidence_not_safe",
    message: "Audit evidence requires safe source, redaction, and explicit retention.",
    recoverability: "caller_correctable",
  });
}

export function isTelemetryProjectionSafe(
  input: TelemetryProjectionSafetyInput,
): SpecificationResult {
  if (
    input.dataClassification !== "secret" &&
    (input.dataClassification !== "confidential" || input.redacted) &&
    input.correlationSafe &&
    input.projectionCategoryApproved
  ) {
    return passSpecification();
  }

  return failSpecification({
    category: "sensitive_data_violation",
    ownerContext: "observability",
    reasonCode: "telemetry_projection_not_safe",
    message: "Telemetry projection requires sanitized data and safe correlation.",
    recoverability: "caller_correctable",
  });
}
