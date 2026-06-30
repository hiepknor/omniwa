import { createStringUnionValue } from "../common/string-union-value.js";

export const domainAggregateTypes = [
  "Instance",
  "Session",
  "Message",
  "MediaAsset",
  "WebhookSubscription",
  "WebhookDelivery",
  "GuardrailDecision",
  "ProviderProfile",
  "WorkerJob",
  "AccessDecision",
  "AuditRecord",
  "HealthStatus",
  "ConfigurationSnapshot",
  "TelemetrySignal",
] as const;

export type DomainAggregateType = (typeof domainAggregateTypes)[number];

export const domainEventNames = [
  "InstanceCreated",
  "InstanceQrRequired",
  "InstanceConnected",
  "InstanceDisconnected",
  "InstanceLoggedOut",
  "InstanceActionRequired",
  "InstanceDestroyed",
  "SessionPairingStarted",
  "SessionPending",
  "SessionActivated",
  "SessionExpired",
  "SessionRevoked",
  "SessionRecoveryRequired",
  "SessionCleaned",
  "InboundMessageReceived",
  "MessageAccepted",
  "MessageRejected",
  "MessageQueued",
  "MessageProcessingStarted",
  "MessageDispatched",
  "MessageDelivered",
  "MessageRead",
  "MessageFailed",
  "MessageCancelled",
  "MediaAccepted",
  "MediaProcessingStarted",
  "MediaProcessed",
  "MediaAttached",
  "MediaFailed",
  "MediaCleaned",
  "DiagnosticCaptureRequested",
  "WebhookSubscriptionProposed",
  "WebhookSubscriptionValidated",
  "WebhookSubscriptionActivated",
  "WebhookSubscriptionSuspended",
  "WebhookSubscriptionInvalidated",
  "WebhookSubscriptionRetired",
  "WebhookDeliveryScheduled",
  "WebhookDeliveryStarted",
  "WebhookDeliverySucceeded",
  "WebhookDeliveryRetryScheduled",
  "WebhookDeliveryFailed",
  "WebhookDeliveryDeadLettered",
  "WebhookDeliveryCancelled",
  "GuardrailEvaluated",
  "GuardrailPassed",
  "GuardrailBlocked",
  "GuardrailThrottled",
  "GuardrailActionRequired",
  "ProviderProfileSupported",
  "ProviderProfileDegraded",
  "ProviderProfileUnsupported",
  "WorkerJobQueued",
  "WorkerJobReserved",
  "WorkerJobStarted",
  "WorkerJobCompleted",
  "WorkerJobRetryScheduled",
  "WorkerJobDead",
  "WorkerJobRecoveryRequired",
  "AccessGranted",
  "AccessDenied",
  "PrivilegedActionMarked",
  "AccessDecisionExpired",
  "AuditRecordRequested",
  "AuditRecorded",
  "AuditRedactionApplied",
  "AuditRetentionExpired",
  "HealthStatusChanged",
  "HealthDegraded",
  "HealthRecovered",
  "HealthActionRequired",
  "ConfigurationValidated",
  "ConfigurationRejected",
  "ConfigurationActivated",
  "ConfigurationGuardrailBypassRejected",
  "ConfigurationSuperseded",
  "TelemetryCaptured",
  "TelemetrySanitized",
  "TelemetryDropped",
  "TelemetryProjected",
] as const;

export type DomainEventName = (typeof domainEventNames)[number];

export type DomainEvent = Readonly<{
  name: DomainEventName;
  aggregateType: DomainAggregateType;
  aggregateId: string;
}>;

export function createDomainEvent(input: DomainEvent): DomainEvent {
  return Object.freeze({
    name: createStringUnionValue(input.name, domainEventNames, "DomainEventName"),
    aggregateType: createStringUnionValue(
      input.aggregateType,
      domainAggregateTypes,
      "DomainAggregateType",
    ),
    aggregateId: input.aggregateId,
  });
}

export function appendDomainEvent(
  events: readonly DomainEvent[],
  aggregateType: DomainAggregateType,
  aggregateId: string,
  name: DomainEventName,
): readonly DomainEvent[] {
  return Object.freeze([
    ...events,
    createDomainEvent({
      aggregateType,
      aggregateId,
      name,
    }),
  ]);
}
