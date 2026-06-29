# OmniWA Entities

## Purpose

This document identifies tactical domain entities for OmniWA Phase 2.2.

It describes identity, purpose, lifecycle, and ownership only. It does not define fields, database tables, ORM models, repositories, source code, or methods.

## Entity Design Rules

- Aggregate roots are entities.
- Child entities may only be changed through their aggregate root.
- Entity identity is product identity, not provider-native identity.
- Entities do not publish integration events.
- Entities do not call infrastructure, provider adapters, queues, logs, telemetry, or persistence.
- Entity lifecycle must remain inside the owning bounded context.

## Aggregate Root Entities

| Entity | Aggregate | Identity | Purpose | Lifecycle | Ownership |
| --- | --- | --- | --- | --- | --- |
| Instance | Instance | InstanceId | Product-managed WhatsApp connection unit. | Created through Destroyed. | Instance Context. |
| Session | Session | SessionId | Product-level session/auth lifecycle for one instance. | Empty/Pending through Active/Expired/Revoked/Cleanup. | Session Context. |
| Message | Message | MessageId | Product message lifecycle for supported inbound/outbound message types. | Created through terminal or visible delivery state. | Messaging Context. |
| MediaAsset | MediaAsset | MediaId | Product media metadata and processing lifecycle. | Received/Referenced through Processed/Failed/Cleaned. | Media Context. |
| WebhookSubscription | WebhookSubscription | WebhookId | Product-level subscription intent for approved integration signals. | Proposed through Active/Suspended/Invalid/Retired. | Webhook Delivery Context. |
| WebhookDelivery | WebhookDelivery | WebhookDeliveryId | Delivery lifecycle for one approved integration signal. | Pending through Delivered/Failed/Dead Letter/Cancelled. | Webhook Delivery Context. |
| GuardrailDecision | GuardrailDecision | GuardrailDecisionId | Responsible-usage decision for one evaluated intent. | Requested through Passed/Blocked/Throttled/Action Required/Expired. | Guardrails Context. |
| ProviderProfile | ProviderProfile | ProviderId | Product-level provider capability and compatibility profile. | Candidate through Supported/Degraded/Unsupported/Retired. | Provider Integration Context. |
| WorkerJob | WorkerJob | JobId | Visible lifecycle for accepted asynchronous work. | Queued through Completed/Retrying/Dead. | Operations Context. |
| AccessDecision | AccessDecision | AccessDecisionId | Capability decision for one actor/action request. | Requested through Granted/Denied/Expired. | Security and Access Context. |
| AuditRecord | AuditRecord | AuditRecordId | Secret-safe evidence for one auditable fact. | Requested through Recorded/Retained/Retention Expired. | Audit Context. |
| HealthStatus | HealthStatus | HealthStatusId | Health classification for one product/dependency subject. | Unknown through Healthy/Degraded/Unavailable/Action Required/Recovered. | Health Context. |
| ConfigurationSnapshot | ConfigurationSnapshot | ConfigurationSnapshotId | Validated effective configuration and safety classification. | Proposed through Active/Superseded/Retired or Rejected. | Configuration Context. |
| TelemetrySignal | TelemetrySignal | TelemetrySignalId | Sanitized telemetry projection decision. | Captured through Projected/Dropped. | Observability Context. |

## Child/Internal Entities

| Entity | Parent Aggregate | Identity | Purpose | Lifecycle | Ownership |
| --- | --- | --- | --- | --- | --- |
| InstanceActionMarker | Instance | InstanceActionMarkerId | Capture operator action-required reason for an instance. | Open -> Resolved/Expired. | Instance. |
| PairingAttempt | Session | PairingAttemptId | Represent one QR/pairing attempt at product level without provider-native QR payload. | Started -> Pending -> Completed/Expired/Failed. | Session. |
| SessionRecoveryMarker | Session | SessionRecoveryMarkerId | Represent session recovery requirement and outcome. | Required -> In Progress -> Resolved/Failed. | Session. |
| DeliveryObservation | Message | DeliveryObservationId | Represent translated provider delivery/read/failure observation. | Received -> Applied/Ignored as stale/Rejected as invalid. | Message. |
| MessageFailureRecord | Message | MessageFailureRecordId | Record product-level failure category for message lifecycle. | Created -> Terminal or superseded by corrected classification. | Message. |
| MediaProcessingAttempt | MediaAsset | MediaProcessingAttemptId | Represent one processing/upload/download attempt at product level. | Started -> Succeeded/Failed/Cleaned. | MediaAsset. |
| DiagnosticCaptureMarker | MediaAsset | DiagnosticCaptureMarkerId | Represent explicit diagnostic capture decision and expiry. | Requested -> Active -> Expired/Removed. | MediaAsset. |
| WebhookDeliveryAttempt | WebhookDelivery | WebhookDeliveryAttemptId | Represent one delivery attempt and retry outcome. | Created -> Delivering -> Succeeded/Retryable Failed/Terminal Failed. | WebhookDelivery. |
| RetryScheduleEntry | WebhookDelivery or WorkerJob | RetryScheduleEntryId | Represent next retry eligibility and budget visibility. | Scheduled -> Consumed/Expired/Cancelled. | Owning aggregate. |
| RateLimitWindow | GuardrailDecision | RateLimitWindowId | Represent rate-limit evaluation window used by the decision. | Evaluated -> Open/Exceeded/Expired. | GuardrailDecision. |
| AbuseRiskIndicator | GuardrailDecision | AbuseRiskIndicatorId | Represent product-level abuse-risk evidence without raw payload retention. | Detected -> Considered -> Cleared/Action Required. | GuardrailDecision. |
| ProviderCapabilityEntry | ProviderProfile | ProviderCapabilityEntryId | Represent support level for one product capability. | Proposed -> Supported/Unsupported/Degraded. | ProviderProfile. |
| ProviderFailureClassification | ProviderProfile | ProviderFailureClassificationId | Represent product-level classification for provider failures. | Defined -> Applied/Retired. | ProviderProfile. |
| JobAttempt | WorkerJob | JobAttemptId | Represent one visible execution attempt for accepted work. | Reserved -> Running -> Completed/Retryable Failed/Dead. | WorkerJob. |
| RecoveryActionMarker | WorkerJob | RecoveryActionMarkerId | Represent operator-visible recovery requirement for a job lineage. | Required -> In Progress -> Resolved/Abandoned. | WorkerJob. |
| AuditEvidenceSummary | AuditRecord | AuditEvidenceSummaryId | Represent redacted evidence summary. | Prepared -> Recorded -> Redacted/Expired. | AuditRecord. |
| DependencyHealthItem | HealthStatus | DependencyHealthItemId | Represent one dependency/product subject contributing to health classification. | Unknown -> Healthy/Degraded/Unavailable/Recovered. | HealthStatus. |
| ConfigurationValidationResult | ConfigurationSnapshot | ConfigurationValidationResultId | Represent validation outcome and safety classification. | Created -> Accepted/Rejected/Superseded. | ConfigurationSnapshot. |
| TelemetryRedactionDecision | TelemetrySignal | TelemetryRedactionDecisionId | Represent redaction/sanitization decision for a telemetry signal. | Pending -> Sanitized/Dropped. | TelemetrySignal. |

## Non-Entity Concepts

| Concept | Reason |
| --- | --- |
| JID | Value object because equality is value-based and it has no lifecycle independent of messages/contacts. |
| PhoneNumber | Value object because it is a normalized, Confidential value with no lifecycle in MVP. |
| CorrelationId | Value object because it traces workflows but does not own behavior. |
| RetryPolicy | Value object because policy equality is based on values and it is immutable once applied to a job/delivery. |
| Provider native message id | External reference only; it is not an OmniWA entity identity. |
| QR payload | Provider/native or presentation data; it is not a domain entity. |
| Message body | Confidential content; not retained by default and not an entity. |
| Media binary | Confidential content; not retained by default and not an entity. |

## Entity Ownership Constraints

- Message entities cannot mutate Session entities.
- Session entities cannot apply Message business rules.
- Webhook entities cannot mutate Message, Instance, Session, Media, or Guardrail entities.
- ProviderProfile entities cannot mutate product business entities.
- WorkerJob entities cannot decide the business meaning of Message, Media, Session, or Webhook outcomes.
- AuditRecord and TelemetrySignal entities cannot store raw Secret or raw Confidential payloads.
- ConfigurationSnapshot entities cannot silently bypass Guardrails.
