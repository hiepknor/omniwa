import {
  applyAuditRedaction,
  recordAuditEvidence,
  requestAuditRecord,
  type AuditRecord,
} from "../audit/audit-record.js";
import { createChat, type Chat } from "../chat/chat.js";
import {
  proposeConfigurationSnapshot,
  rejectGuardrailBypassConfiguration,
  rejectConfigurationSnapshot,
  validateConfigurationSnapshot,
  type ConfigurationSnapshot,
} from "../configuration/configuration-snapshot.js";
import { createContact, type Contact, type ContactDisplayName } from "../contact/contact.js";
import {
  blockGuardrailDecision,
  passGuardrailDecision,
  requestGuardrailDecision,
  requireGuardrailAction,
  throttleGuardrailDecision,
  type GuardrailDecision,
} from "../guardrails/guardrail-decision.js";
import {
  classifyDegraded,
  classifyHealthy,
  classifyUnavailable,
  createHealthStatus,
  markHealthActionRequired,
  markHealthRecovered,
  type HealthStatus,
} from "../health/health-status.js";
import type {
  AccessDecisionId,
  AuditRecordId,
  ChatId,
  ConfigurationSnapshotId,
  ContactId,
  GuardrailDecisionId,
  GroupId,
  HealthStatusId,
  InstanceId,
  JobId,
  LabelId,
  MediaId,
  MessageId,
  ProviderId,
  SessionId,
  TelemetrySignalId,
  WebhookDeliveryId,
  WebhookId,
} from "../identity/aggregate-ids.js";
import { createGroup, type Group, type GroupMetadata } from "../group/group.js";
import type { GroupProviderCapability } from "../group/group-provider-capability.js";
import { createLabel, type Label } from "../label/label.js";
import type { Jid } from "../references/jid.js";
import type { PhoneNumber } from "../references/phone-number.js";
import { createInstance, type Instance, type InstanceMetadata } from "../instance/instance.js";
import {
  acceptMediaAsset,
  createMediaAsset,
  requestDiagnosticCapture,
  type MediaAsset,
} from "../media/media-asset.js";
import type { MediaCategory } from "../media/media-category.js";
import {
  acceptMessage,
  createInboundMessage,
  createOutboundMessageIntent,
  type Message,
} from "../messaging/message.js";
import type { MessageType } from "../messaging/message-type.js";
import {
  captureTelemetrySignal,
  dropTelemetrySignal,
  sanitizeTelemetrySignal,
  type TelemetrySignal,
} from "../observability/telemetry-signal.js";
import { queueWorkerJob, type WorkerJob } from "../operations/worker-job.js";
import type { DomainOwnerContext } from "../errors/domain-owner-context.js";
import type { GuardrailOutcome } from "../policies/guardrail-outcome.js";
import type { RetentionPolicy } from "../policies/retention-policy.js";
import type { RetryPolicy } from "../policies/retry-policy.js";
import {
  createProviderProfile,
  markProviderDegraded,
  markProviderSupported,
  markProviderUnsupported,
  type ProviderProfile,
} from "../provider/provider-profile.js";
import {
  denyAccessDecision,
  grantAccessDecision,
  markPrivilegedAction,
  requestAccessDecision,
  type AccessDecision,
} from "../security/access-decision.js";
import { createSession, startSessionPairing, type Session } from "../session/session.js";
import type { ConfigurationSafety } from "../status/configuration-safety.js";
import type { HealthCategory } from "../status/health-category.js";
import { scheduleWebhookDelivery, type WebhookDelivery } from "../webhook/webhook-delivery.js";
import {
  createWebhookSubscription,
  type WebhookSubscription,
} from "../webhook/webhook-subscription.js";
import type { WebhookUrl } from "../webhook/webhook-url.js";
import type { FailureCategory } from "../errors/failure-category.js";

export function createInstanceAggregate(id: InstanceId, metadata?: InstanceMetadata): Instance {
  return createInstance(id, metadata);
}

export function createSessionAggregate(input: {
  id: SessionId;
  instanceId: InstanceId;
  startPairing?: boolean;
}): Session {
  const session = createSession(input.id, input.instanceId);
  return input.startPairing === true ? startSessionPairing(session) : session;
}

export function createOutboundMessageAggregate(input: {
  id: MessageId;
  instanceId: InstanceId;
  type: MessageType;
  guardrailDecisionId?: GuardrailDecisionId;
  mediaId?: MediaId;
  retentionPolicy?: RetentionPolicy;
}): Message {
  const message = createOutboundMessageIntent(input);
  return input.guardrailDecisionId === undefined
    ? message
    : acceptMessage(message, input.guardrailDecisionId);
}

export function createInboundMessageAggregate(input: {
  id: MessageId;
  instanceId: InstanceId;
  type: MessageType;
  mediaId?: MediaId;
  retentionPolicy?: RetentionPolicy;
}): Message {
  return createInboundMessage(input);
}

export function createMediaAssetAggregate(input: {
  id: MediaId;
  category: MediaCategory;
  retentionPolicy: RetentionPolicy;
  accept?: boolean;
  diagnosticCapture?: boolean;
}): MediaAsset {
  const media =
    input.accept === true
      ? acceptMediaAsset(createMediaAsset(input.id, input.category, input.retentionPolicy))
      : createMediaAsset(input.id, input.category, input.retentionPolicy);

  return input.diagnosticCapture === true ? requestDiagnosticCapture(media) : media;
}

export function createChatAggregate(input: {
  id: ChatId;
  instanceId: InstanceId;
  jid: Jid;
  labelIds?: readonly LabelId[];
}): Chat {
  return createChat(input);
}

export function createContactAggregate(input: {
  id: ContactId;
  instanceId: InstanceId;
  jid: Jid;
  displayName?: ContactDisplayName;
  phoneNumber?: PhoneNumber;
}): Contact {
  return createContact(input);
}

export function createLabelAggregate(input: {
  id: LabelId;
  instanceId: InstanceId;
  name: string;
  colorCode?: string;
}): Label {
  return createLabel(input);
}

export function createGroupAggregate(input: {
  id: GroupId;
  instanceId: InstanceId;
  jid: Jid;
  metadata: GroupMetadata;
}): Group {
  return createGroup(input);
}

export function createWebhookSubscriptionAggregate(input: {
  id: WebhookId;
  targetUrl: WebhookUrl;
}): WebhookSubscription {
  return createWebhookSubscription(input.id, input.targetUrl);
}

export function createWebhookDeliveryAggregate(input: {
  id: WebhookDeliveryId;
  webhookId: WebhookId;
  sourceSignalRef: string;
  retryPolicy: RetryPolicy;
}): WebhookDelivery {
  return scheduleWebhookDelivery(
    input.id,
    input.webhookId,
    input.sourceSignalRef,
    input.retryPolicy,
  );
}

export function createGuardrailDecisionAggregate(input: {
  id: GuardrailDecisionId;
  evaluatedIntentRef: string;
  outcome: GuardrailOutcome;
  reasonCode: string;
}): GuardrailDecision {
  const decision = requestGuardrailDecision(input.id, input.evaluatedIntentRef);

  switch (input.outcome) {
    case "allow":
      return passGuardrailDecision(decision, input.reasonCode);
    case "block":
      return blockGuardrailDecision(decision, input.reasonCode);
    case "throttle":
      return throttleGuardrailDecision(decision, input.reasonCode);
    case "action_required":
      return requireGuardrailAction(decision, input.reasonCode);
  }
}

export function createProviderProfileAggregate(input: {
  id: ProviderId;
  providerKind: string;
  status: "candidate" | "supported" | "degraded" | "unsupported";
  supportedMessageTypes?: readonly MessageType[];
  supportedGroupCapabilities?: readonly GroupProviderCapability[];
  failureCategory?: FailureCategory;
}): ProviderProfile {
  const profile = createProviderProfile(input.id, input.providerKind);

  if (input.status === "supported") {
    return markProviderSupported(
      profile,
      input.supportedMessageTypes ?? [],
      input.supportedGroupCapabilities ?? [],
    );
  }

  if (input.status === "degraded") {
    return markProviderDegraded(profile, requireFailureCategory(input.failureCategory));
  }

  if (input.status === "unsupported") {
    return markProviderUnsupported(profile, requireFailureCategory(input.failureCategory));
  }

  return profile;
}

export function createWorkerJobAggregate(input: {
  id: JobId;
  ownerContext: DomainOwnerContext;
  workType: string;
  retryPolicy: RetryPolicy;
}): WorkerJob {
  return queueWorkerJob(input.id, input.ownerContext, input.workType, input.retryPolicy);
}

export function createAccessDecisionAggregate(input: {
  id: AccessDecisionId;
  actorRef: string;
  capability: string;
  outcome: "granted" | "denied";
  privileged?: boolean;
}): AccessDecision {
  const requested = requestAccessDecision(input.id, input.actorRef, input.capability);
  const decision = input.privileged === true ? markPrivilegedAction(requested) : requested;
  return input.outcome === "granted" ? grantAccessDecision(decision) : denyAccessDecision(decision);
}

export function createAuditRecordAggregate(input: {
  id: AuditRecordId;
  auditCategory: string;
  retentionPolicy: RetentionPolicy;
  evidenceSummaryCode: string;
  redacted?: boolean;
}): AuditRecord {
  const requested = requestAuditRecord(input.id, input.auditCategory, input.retentionPolicy);
  const maybeRedacted = input.redacted === true ? applyAuditRedaction(requested) : requested;
  return recordAuditEvidence(maybeRedacted, input.evidenceSummaryCode);
}

export function createHealthStatusAggregate(input: {
  id: HealthStatusId;
  subjectRef: string;
  category: HealthCategory;
  causeCategory?: string;
}): HealthStatus {
  const health = createHealthStatus(input.id, input.subjectRef);

  if (input.category === "healthy") return classifyHealthy(health);
  if (input.category === "degraded") {
    return classifyDegraded(health, input.causeCategory ?? "unknown");
  }
  if (input.category === "unavailable") {
    return classifyUnavailable(health, input.causeCategory ?? "unknown");
  }
  if (input.category === "action_required") {
    return markHealthActionRequired(health, input.causeCategory ?? "unknown");
  }
  if (input.category === "recovered") return markHealthRecovered(health);

  return health;
}

export function createConfigurationSnapshotAggregate(input: {
  id: ConfigurationSnapshotId;
  safety: ConfigurationSafety;
}): ConfigurationSnapshot {
  const snapshot = proposeConfigurationSnapshot(input.id, input.safety);

  if (input.safety === "valid") {
    return validateConfigurationSnapshot(snapshot);
  }

  if (input.safety === "guardrail_bypass_rejected") {
    return rejectGuardrailBypassConfiguration(snapshot);
  }

  return rejectConfigurationSnapshot(snapshot);
}

export function createTelemetrySignalAggregate(input: {
  id: TelemetrySignalId;
  sourceContextRef: string;
  safeForProjection: boolean;
}): TelemetrySignal {
  const signal = captureTelemetrySignal(input.id, input.sourceContextRef);
  return input.safeForProjection ? sanitizeTelemetrySignal(signal) : dropTelemetrySignal(signal);
}

function requireFailureCategory(value: FailureCategory | undefined): FailureCategory {
  if (value === undefined) {
    throw new TypeError(
      "FailureCategory is required for degraded or unsupported provider profile.",
    );
  }

  return value;
}
