import type { Instance } from "../instance/instance.js";
import type { MediaAsset } from "../media/media-asset.js";
import type { MessageStatus } from "../status/message-status.js";
import type { Session } from "../session/session.js";
import type { WebhookSubscription } from "../webhook/webhook-subscription.js";
import type {
  CanSendMessageInput,
  DomainDataClassification,
  TelemetryProjectionSafetyInput,
  WebhookDeliverabilityInput,
} from "../specifications/domain-specifications.js";
import {
  canReconnectInstance,
  isMediaReadyForMessage,
  isSessionUsable,
  isWebhookDeliverable,
} from "../specifications/domain-specifications.js";
import type { SpecificationResult } from "../specifications/specification-result.js";
import { isSpecificationPass } from "../specifications/specification-result.js";
import type { PolicyDecision } from "../policies/domain-policies.js";
import {
  evaluateAuditRedactionPolicy,
  evaluateComplianceGuardrailPolicy,
  evaluateConfigurationSafetyPolicy,
  evaluateHealthProjectionPolicy,
  evaluateMessageSendingPolicy,
  evaluateProviderCapabilityPolicy,
  evaluateTelemetrySafetyPolicy,
  evaluateWebhookRetryPolicy,
  evaluateWorkerJobRetryPolicy,
  type ComplianceGuardrailInput,
} from "../policies/domain-policies.js";
import type { ConfigurationSnapshot } from "../configuration/configuration-snapshot.js";
import type { ProviderProfile } from "../provider/provider-profile.js";
import type { MessageType } from "../messaging/message-type.js";
import type { WebhookDelivery } from "../webhook/webhook-delivery.js";
import type { WorkerJob } from "../operations/worker-job.js";
import type { AuditEvidenceSafetyInput } from "../specifications/domain-specifications.js";

export type MessageAcceptanceDecision = PolicyDecision;

export type DeliveryStatusDecision = Readonly<{
  accepted: boolean;
  nextStatus?: MessageStatus;
  reasonCode: string;
}>;

export type InstanceReadinessDecision = Readonly<{
  sendCapable: boolean;
  recommendedStatus: "connected" | "disconnected" | "logged_out" | "action_required";
  specification: SpecificationResult;
}>;

export type SessionRecoveryDecision = Readonly<{
  usable: boolean;
  requiresRecovery: boolean;
  cleanupEligible: boolean;
  specification: SpecificationResult;
}>;

export type RetryEligibilityDecision = Readonly<{
  retryable: boolean;
  policy: PolicyDecision;
}>;

export function decideMessageAcceptance(input: CanSendMessageInput): MessageAcceptanceDecision {
  return evaluateMessageSendingPolicy(input);
}

export function classifyMessageDeliveryStatus(input: {
  translatedStatus: string;
  staleObservation: boolean;
}): DeliveryStatusDecision {
  if (input.staleObservation) {
    return { accepted: false, reasonCode: "stale_observation" };
  }

  if (["sent", "delivered", "read", "failed"].includes(input.translatedStatus)) {
    return {
      accepted: true,
      nextStatus: input.translatedStatus as MessageStatus,
      reasonCode: "translated_status_accepted",
    };
  }

  return { accepted: false, reasonCode: "unsupported_translated_status" };
}

export function decideInstanceReadiness(input: {
  instance: Instance;
  session: Session | undefined;
  translatedProviderReady: boolean;
  providerLoggedOut: boolean;
  providerActionRequired: boolean;
}): InstanceReadinessDecision {
  const sessionSpec = isSessionUsable(input.session);
  const sendCapable =
    input.instance.status !== "destroyed" &&
    input.translatedProviderReady &&
    isSpecificationPass(sessionSpec);

  if (sendCapable) {
    return { sendCapable: true, recommendedStatus: "connected", specification: sessionSpec };
  }

  return {
    sendCapable: false,
    recommendedStatus: input.providerLoggedOut
      ? "logged_out"
      : input.providerActionRequired
        ? "action_required"
        : "disconnected",
    specification: sessionSpec,
  };
}

export function decideReconnectEligibility(input: {
  instance: Instance;
  sessionUsableOrRecoverable: boolean;
  concurrentReconnectActive: boolean;
}): SpecificationResult {
  return canReconnectInstance({
    instanceStatus: input.instance.status,
    sessionUsableOrRecoverable: input.sessionUsableOrRecoverable,
    concurrentReconnectActive: input.concurrentReconnectActive,
  });
}

export function decideSessionRecovery(session: Session): SessionRecoveryDecision {
  const specification = isSessionUsable(session);
  return {
    usable: isSpecificationPass(specification),
    requiresRecovery:
      session.requiresRecovery || session.status === "expired" || session.status === "revoked",
    cleanupEligible: ["expired", "revoked", "cleanup"].includes(session.status),
    specification,
  };
}

export function decideWebhookScheduling(input: WebhookDeliverabilityInput): PolicyDecision {
  const specification = isWebhookDeliverable(input);
  return {
    outcome: isSpecificationPass(specification) ? "allow" : "reject",
    specification,
  };
}

export function decideWebhookDeliveryForSubscription(input: {
  subscription: WebhookSubscription | undefined;
  sourceSignalRef: string;
  dataClassification: DomainDataClassification;
  signalSelected: boolean;
  idempotencyKeyPresent: boolean;
}): PolicyDecision {
  return decideWebhookScheduling(input);
}

export function decideRetryEligibility(
  input:
    | { kind: "webhook_delivery"; delivery: WebhookDelivery; nextAttempt: number }
    | { kind: "worker_job"; job: WorkerJob; nextAttempt: number },
): RetryEligibilityDecision {
  const policy =
    input.kind === "webhook_delivery"
      ? evaluateWebhookRetryPolicy(input.delivery, input.nextAttempt)
      : evaluateWorkerJobRetryPolicy(input.job, input.nextAttempt);

  return {
    retryable: policy.outcome === "retry",
    policy,
  };
}

export function decideMediaReadiness(input: {
  media: MediaAsset | undefined;
  messageType: MessageType;
}): SpecificationResult {
  return isMediaReadyForMessage(input.media, input.messageType);
}

export function decideGuardrailEvaluation(
  input: ComplianceGuardrailInput,
): ReturnType<typeof evaluateComplianceGuardrailPolicy> {
  return evaluateComplianceGuardrailPolicy(input);
}

export function classifyProviderCompatibility(input: {
  profile: ProviderProfile | undefined;
  messageType: MessageType;
}): PolicyDecision {
  return evaluateProviderCapabilityPolicy(input.profile, input.messageType);
}

export function decideAuditEvidenceSafety(input: AuditEvidenceSafetyInput): PolicyDecision {
  return evaluateAuditRedactionPolicy(input);
}

export function decideHealthClassification(input: {
  sourceSignalActionable: boolean;
  previousHealth: string;
}): PolicyDecision {
  return evaluateHealthProjectionPolicy(input);
}

export function decideConfigurationActivation(input: {
  snapshot: ConfigurationSnapshot;
  accessGranted: boolean;
}): PolicyDecision {
  return evaluateConfigurationSafetyPolicy(input.snapshot, input.accessGranted);
}

export function decideTelemetryProjection(input: TelemetryProjectionSafetyInput): PolicyDecision {
  return evaluateTelemetrySafetyPolicy(input);
}
