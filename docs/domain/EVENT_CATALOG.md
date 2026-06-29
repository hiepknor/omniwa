# OmniWA Event Catalog

## Purpose

This document catalogs meaningful OmniWA events for Phase 2.3.

The catalog is a product-language catalog. It does not define payload JSON, database tables, event bus topics, queue names, Kafka streams, BullMQ jobs, REST endpoints, Prisma models, or source code.

## Catalog Rules

- Keep only events that represent useful business facts, workflow facts, integration facts, or infrastructure observations.
- Prefer past tense for Domain Events and Integration Events.
- Use request-like names only for Application Events that start workflow work.
- Do not expose Secret values or raw Confidential payloads.
- Do not turn every internal state transition into an external Integration Event.

## Domain Event Catalog

| Event | Signal Name | Producer Aggregate | Category | Business Meaning | Primary Consumers |
| --- | --- | --- | --- | --- | --- |
| InstanceCreated | `instance.created` | Instance | Domain Event | A product instance exists. | Health, Audit, Webhook Delivery, Observability. |
| InstanceQrRequired | `instance.qr_required` | Instance | Domain Event | Pairing action is required before connection can complete. | Session, Health, Observability. |
| InstanceConnected | `instance.connected` | Instance | Domain Event | Instance is connected according to translated provider/session readiness. | Health, Webhook Delivery, Observability. |
| InstanceDisconnected | `instance.disconnected` | Instance | Domain Event | Instance lost connection or cannot currently send/receive. | Session, Health, Scheduler/Application, Webhook Delivery. |
| InstanceLoggedOut | `instance.logged_out` | Instance | Domain Event | Instance is logged out or unlinked and needs operator action before normal messaging. | Session, Health, Audit, Webhook Delivery. |
| InstanceActionRequired | `instance.action_required` | Instance | Domain Event | Operator action is required for instance recovery or operation. | Health, Audit, Observability. |
| InstanceDestroyed | `instance.destroyed` | Instance | Domain Event | Instance lifecycle ended. | Session, Audit, Health, Observability. |
| SessionPairingStarted | `session.pairing_started` | Session | Domain Event | Pairing flow has started for a session. | Instance, Audit, Observability. |
| SessionPending | `session.pending` | Session | Domain Event | Session establishment or restore is in progress. | Instance, Health, Observability. |
| SessionActivated | `session.activated` | Session | Domain Event | Session is usable by provider runtime. | Instance, Health, Webhook Delivery, Observability. |
| SessionExpired | `session.expired` | Session | Domain Event | Session can no longer be restored automatically. | Instance, Health, Audit, Webhook Delivery. |
| SessionRevoked | `session.revoked` | Session | Domain Event | Session was invalidated by logout, unlink, account condition, policy, or provider signal. | Instance, Health, Audit, Webhook Delivery. |
| SessionRecoveryRequired | `session.recovery_required` | Session | Domain Event | Session requires recovery or operator action. | Operations, Health, Audit. |
| SessionCleaned | `session.cleaned` | Session | Domain Event | Session state was cleaned under retention/deletion policy. | Audit, Health, Observability. |
| InboundMessageReceived | `message.inbound_received` | Message | Domain Event | Inbound provider signal became a product message fact. | Webhook Delivery, Audit, Observability. |
| UnsupportedMessageReceived | `message.unsupported_received` | Message | Domain Event | Inbound signal contains unsupported message type but is safe to surface as unsupported. | Webhook Delivery, Observability. |
| MessageAccepted | `message.accepted` | Message | Domain Event | Outbound message intent passed product checks and can continue. | Operations, Webhook Delivery, Audit, Observability. |
| MessageRejected | `message.rejected` | Message | Domain Event | Message intent was rejected by validation, business rule, or guardrail. | Audit, Health, Observability. |
| MessageQueued | `message.queued` | Message | Domain Event | Accepted outbound work is queued/visible for async processing. | WorkerJob, Health, Observability. |
| MessageProcessingStarted | `message.processing_started` | Message | Domain Event | Message processing has begun. | Operations, Observability. |
| MessageDispatched | `message.dispatched` | Message | Domain Event | Provider accepted send or equivalent send-state is known. | Webhook Delivery, Health, Observability. |
| MessageDelivered | `message.delivered` | Message | Domain Event | Translated provider status indicates delivered where available. | Webhook Delivery, Observability. |
| MessageRead | `message.read` | Message | Domain Event | Translated provider status indicates read where available. | Webhook Delivery, Observability. |
| MessageFailed | `message.failed` | Message | Domain Event | Message reached failed state with safe failure category. | Webhook Delivery, Audit, Health, Observability. |
| MessageCancelled | `message.cancelled` | Message | Domain Event | Message work was intentionally stopped. | Operations, Audit, Observability. |
| MediaAccepted | `media.accepted` | MediaAsset | Domain Event | Media metadata passed product checks. | Message, Operations, Observability. |
| MediaProcessingStarted | `media.processing_started` | MediaAsset | Domain Event | Media processing has begun. | Operations, Observability. |
| MediaProcessed | `media.processed` | MediaAsset | Domain Event | Media metadata/content reference is ready for workflow. | Message, Webhook Delivery, Observability. |
| MediaAttached | `media.attached` | MediaAsset | Domain Event | Media is associated with message workflow. | Message, Observability. |
| MediaFailed | `media.failed` | MediaAsset | Domain Event | Media cannot proceed. | Message, Webhook Delivery, Health, Observability. |
| MediaExpired | `media.expired` | MediaAsset | Domain Event | Media retention window expired. | Audit, Observability. |
| MediaCleaned | `media.cleaned` | MediaAsset | Domain Event | Temporary media content was cleaned according to policy. | Audit, Observability. |
| DiagnosticCaptureRequested | `media.diagnostic_capture_requested` | MediaAsset | Domain Event | Explicit bounded diagnostic capture was requested. | Audit, Observability. |
| WebhookSubscriptionProposed | `webhook.subscription.proposed` | WebhookSubscription | Domain Event | Webhook subscription intent was proposed and needs validation. | Webhook Delivery, Audit, Observability. |
| WebhookSubscriptionValidated | `webhook.subscription.validated` | WebhookSubscription | Domain Event | Subscription is valid for approved delivery. | WebhookDelivery, Audit, Health. |
| WebhookSubscriptionActivated | `webhook.subscription.activated` | WebhookSubscription | Domain Event | Subscription can receive approved Integration Events. | WebhookDelivery, Audit, Observability. |
| WebhookSubscriptionSuspended | `webhook.subscription.suspended` | WebhookSubscription | Domain Event | Subscription cannot receive normal deliveries temporarily. | WebhookDelivery, Health, Audit. |
| WebhookSubscriptionInvalidated | `webhook.subscription.invalidated` | WebhookSubscription | Domain Event | Subscription is not safe or valid for delivery. | WebhookDelivery, Health, Audit. |
| WebhookSubscriptionRetired | `webhook.subscription.retired` | WebhookSubscription | Domain Event | Subscription lifecycle ended. | WebhookDelivery, Audit, Observability. |
| WebhookDeliveryScheduled | `webhook.delivery.scheduled` | WebhookDelivery | Domain Event | Delivery work is scheduled for approved integration signal. | WorkerJob, Health, Observability. |
| WebhookDeliveryStarted | `webhook.delivery.started` | WebhookDelivery | Domain Event | A delivery attempt has started. | WorkerJob, Observability. |
| WebhookDeliverySucceeded | `webhook.delivery.succeeded` | WebhookDelivery | Domain Event | Receiver acknowledged delivery according to future transport rules. | Audit, Health, Observability. |
| WebhookDeliveryRetryScheduled | `webhook.delivery.retry_scheduled` | WebhookDelivery | Domain Event | Delivery failed but retry remains eligible. | WorkerJob, Health, Observability. |
| WebhookDeliveryFailed | `webhook.delivery.failed` | WebhookDelivery | Domain Event | Delivery failed terminally without dead-letter path or due to non-retryable cause. | Audit, Health, Observability. |
| WebhookDeliveryDeadLettered | `webhook.delivery.dead_lettered` | WebhookDelivery | Domain Event | Delivery reached dead-letter state and needs operator visibility. | Audit, Health, Observability. |
| WebhookDeliveryCancelled | `webhook.delivery.cancelled` | WebhookDelivery | Domain Event | Delivery was intentionally cancelled by lifecycle policy. | Audit, Observability. |
| GuardrailEvaluated | `guardrail.evaluated` | GuardrailDecision | Domain Event | Guardrail evaluation completed. | Message, Audit, Observability. |
| GuardrailPassed | `guardrail.passed` | GuardrailDecision | Domain Event | Work intent may continue. | Message, Observability. |
| GuardrailBlocked | `guardrail.blocked` | GuardrailDecision | Domain Event | Work intent is blocked. | Message, Audit, Health, Webhook Delivery where approved. |
| GuardrailThrottled | `guardrail.throttled` | GuardrailDecision | Domain Event | Work intent is throttled. | Message, Operations, Audit, Observability. |
| GuardrailActionRequired | `guardrail.action_required` | GuardrailDecision | Domain Event | Operator action is required before work can continue. | Health, Audit, Observability. |
| ProviderProfileSupported | `provider_profile.supported` | ProviderProfile | Domain Event | Provider profile supports approved product capabilities. | Health, Observability. |
| ProviderProfileDegraded | `provider_profile.degraded` | ProviderProfile | Domain Event | Provider compatibility or capability is degraded. | Health, Observability. |
| ProviderProfileUnsupported | `provider_profile.unsupported` | ProviderProfile | Domain Event | Provider profile cannot satisfy current product contract. | Health, Observability. |
| ProviderCapabilityChanged | `provider_profile.capability_changed` | ProviderProfile | Domain Event | Provider product capability classification changed. | Health, Observability. |
| ProviderFailureClassified | `provider_profile.failure_classified` | ProviderProfile | Domain Event | Provider failure was classified into product vocabulary. | Instance, Session, Message, Media, Health. |
| WorkerJobQueued | `worker.job.queued` | WorkerJob | Domain Event | Async work has visible queued state. | Owner context, Health, Observability. |
| WorkerJobReserved | `worker.job.reserved` | WorkerJob | Domain Event | Work was reserved for execution. | Owner context, Observability. |
| WorkerJobStarted | `worker.job.started` | WorkerJob | Domain Event | Work execution started. | Owner context, Observability. |
| WorkerJobCompleted | `worker.job.completed` | WorkerJob | Domain Event | Work completed from job lifecycle perspective. | Owner context, Health, Observability. |
| WorkerJobRetryScheduled | `worker.job.retry_scheduled` | WorkerJob | Domain Event | Retry was scheduled for a job. | Owner context, Health, Observability. |
| WorkerJobDead | `worker.job.dead` | WorkerJob | Domain Event | Job lineage reached terminal dead state. | Owner context, Audit, Health, Observability. |
| WorkerJobRecoveryRequired | `worker.job.recovery_required` | WorkerJob | Domain Event | Operator recovery action is required. | Owner context, Audit, Health. |
| AccessGranted | `access.granted` | AccessDecision | Domain Event | Actor is allowed to perform requested capability. | Target context, Audit. |
| AccessDenied | `access.denied` | AccessDecision | Domain Event | Actor is denied requested capability. | Target context, Audit, Observability. |
| PrivilegedActionMarked | `access.privileged_action_marked` | AccessDecision | Domain Event | Action is classified as privileged and audit-eligible. | Audit, target context. |
| SecretAccessRequested | `access.secret_access_requested` | AccessDecision | Domain Event | Secret access was requested with reason. | Audit, Security and Access. |
| AccessDecisionExpired | `access.decision_expired` | AccessDecision | Domain Event | Access decision is no longer valid for mutation. | Target context, Audit, Observability. |
| AuditRecordRequested | `audit.record_requested` | AuditRecord | Domain Event | Safe audit evidence should exist. | Audit, Observability. |
| AuditRecorded | `audit.recorded` | AuditRecord | Domain Event | Audit evidence was recorded safely. | Observability, Health. |
| AuditRedactionApplied | `audit.redaction_applied` | AuditRecord | Domain Event | Sensitive data was redacted in audit evidence. | Observability. |
| AuditRetentionExpired | `audit.retention_expired` | AuditRecord | Domain Event | Audit retention window ended. | Observability. |
| HealthStatusChanged | `health.status_changed` | HealthStatus | Domain Event | Health classification changed. | Observability, Webhook Delivery where approved. |
| HealthDegraded | `health.degraded` | HealthStatus | Domain Event | Health degraded for product/dependency subject. | Observability, Webhook Delivery where approved. |
| HealthRecovered | `health.recovered` | HealthStatus | Domain Event | Health recovered. | Observability, Webhook Delivery where approved. |
| HealthActionRequired | `health.action_required` | HealthStatus | Domain Event | Operator action is required. | Audit, Observability, Webhook Delivery where approved. |
| ConfigurationValidated | `configuration.validated` | ConfigurationSnapshot | Domain Event | Configuration snapshot is valid. | Product contexts, Audit. |
| ConfigurationRejected | `configuration.rejected` | ConfigurationSnapshot | Domain Event | Configuration snapshot is invalid or unsafe. | Audit, Health, Observability. |
| ConfigurationActivated | `configuration.activated` | ConfigurationSnapshot | Domain Event | Valid configuration snapshot became active. | Product contexts, Audit, Health. |
| ConfigurationGuardrailBypassRejected | `configuration.guardrail_bypass_rejected` | ConfigurationSnapshot | Domain Event | Unsafe guardrail-bypass setting was rejected. | Guardrails, Audit, Health. |
| ConfigurationSuperseded | `configuration.superseded` | ConfigurationSnapshot | Domain Event | Configuration snapshot was replaced. | Product contexts, Audit. |
| TelemetryCaptured | `telemetry.captured` | TelemetrySignal | Domain Event | Telemetry signal entered sanitization flow. | Observability. |
| TelemetrySanitized | `telemetry.sanitized` | TelemetrySignal | Domain Event | Telemetry signal was sanitized. | Observability adapters. |
| TelemetryDropped | `telemetry.dropped` | TelemetrySignal | Domain Event | Telemetry signal was dropped because it was unsafe or invalid. | Observability, Health if systemic. |
| TelemetryProjected | `telemetry.projected` | TelemetrySignal | Domain Event | Telemetry signal was projected safely. | Observability adapters. |

## Application Event Catalog

| Event | Signal Name | Producer | Consumer | Meaning |
| --- | --- | --- | --- | --- |
| OutboundMessageSendRequested | `application.outbound_message_send_requested` | Application | WorkerJob / Worker orchestration | Durable outbound send work should be created. |
| MediaProcessingRequested | `application.media_processing_requested` | Application | WorkerJob / Worker orchestration | Media processing work should be created. |
| WebhookDeliveryRequested | `application.webhook_delivery_requested` | Application / Webhook Delivery | WorkerJob / Webhook Delivery | External webhook delivery work should be created. |
| ReconnectRequested | `application.reconnect_requested` | Application / Scheduler | WorkerJob / Instance / Session | Reconnect workflow should be attempted. |
| RetentionCleanupRequested | `application.retention_cleanup_requested` | Application / Scheduler | WorkerJob / owning aggregate | Retention cleanup should run. |
| HealthRefreshRequested | `application.health_refresh_requested` | Application / Scheduler | HealthStatus | Health classification should be refreshed. |
| AuditWriteRequested | `application.audit_write_requested` | Application | AuditRecord | Safe audit evidence should be recorded. |

## Infrastructure Event Catalog

| Event | Signal Name | Producer | Consumer | Translation Rule |
| --- | --- | --- | --- | --- |
| ProviderConnectionObserved | `infrastructure.provider.connection_observed` | Provider adapter | Application | Translate to Instance/Session product fact before domain. |
| ProviderAuthenticationObserved | `infrastructure.provider.authentication_observed` | Provider adapter | Application | Translate to Session product fact before domain. |
| ProviderMessageStatusObserved | `infrastructure.provider.message_status_observed` | Provider adapter | Application | Translate to Message delivery fact before domain. |
| ProviderInboundMessageObserved | `infrastructure.provider.inbound_message_observed` | Provider adapter | Application | Translate to InboundMessageReceived or UnsupportedMessageReceived. |
| ProviderMediaObserved | `infrastructure.provider.media_observed` | Provider adapter | Application | Translate to Media product signal before domain. |
| WebhookTransportOutcomeObserved | `infrastructure.webhook.transport_outcome_observed` | Webhook transport adapter | Application | Translate to WebhookDelivery fact. |
| QueueWorkOutcomeObserved | `infrastructure.queue.work_outcome_observed` | Queue/worker adapter | Application | Translate to WorkerJob fact. |
| DependencyHealthObserved | `infrastructure.dependency.health_observed` | Infrastructure probe | Application | Translate to HealthStatus fact. |

## Integration Event Catalog

| Integration Event | Source Domain Events | Owner | External Meaning |
| --- | --- | --- | --- |
| `instance.created.v1` | InstanceCreated | Webhook Delivery | External consumer may observe instance creation. |
| `instance.connected.v1` | InstanceConnected | Webhook Delivery | External consumer may observe instance connected state. |
| `instance.disconnected.v1` | InstanceDisconnected | Webhook Delivery | External consumer may observe disconnected state. |
| `instance.logged_out.v1` | InstanceLoggedOut | Webhook Delivery | External consumer may observe action-required logout state. |
| `session.activated.v1` | SessionActivated | Webhook Delivery | External consumer may observe session usable state without Secret data. |
| `session.expired.v1` | SessionExpired | Webhook Delivery | External consumer may observe expired session state. |
| `session.revoked.v1` | SessionRevoked | Webhook Delivery | External consumer may observe revoked session state without Secret data. |
| `message.received.v1` | InboundMessageReceived | Webhook Delivery | External consumer may observe inbound message fact with sanitized metadata. |
| `message.accepted.v1` | MessageAccepted | Webhook Delivery | External consumer may observe outbound acceptance. |
| `message.dispatched.v1` | MessageDispatched | Webhook Delivery | External consumer may observe provider-accepted send state. |
| `message.delivered.v1` | MessageDelivered | Webhook Delivery | External consumer may observe delivery status where available. |
| `message.read.v1` | MessageRead | Webhook Delivery | External consumer may observe read status where available. |
| `message.failed.v1` | MessageFailed | Webhook Delivery | External consumer may observe safe failure category. |
| `media.processed.v1` | MediaProcessed | Webhook Delivery | External consumer may observe media processing complete. |
| `media.failed.v1` | MediaFailed | Webhook Delivery | External consumer may observe media failure category. |
| `webhook.delivery.succeeded.v1` | WebhookDeliverySucceeded | Webhook Delivery | External consumer may observe its own delivery success where approved. |
| `webhook.delivery.failed.v1` | WebhookDeliveryFailed | Webhook Delivery | External consumer may observe delivery failure where approved. |
| `webhook.delivery.dead_lettered.v1` | WebhookDeliveryDeadLettered | Webhook Delivery | External consumer may observe dead-letter state where approved. |
| `guardrail.blocked.v1` | GuardrailBlocked | Webhook Delivery | External consumer may observe blocked responsible-usage outcome. |
| `guardrail.throttled.v1` | GuardrailThrottled | Webhook Delivery | External consumer may observe throttled outcome. |
| `health.degraded.v1` | HealthDegraded | Webhook Delivery | External consumer may observe degraded product/dependency health. |
| `health.recovered.v1` | HealthRecovered | Webhook Delivery | External consumer may observe recovery. |

## Catalog Exclusions

| Excluded Event | Reason |
| --- | --- |
| Raw Baileys callback events | Provider-native and infrastructure-only. |
| Database persistence events | Persistence decisions are deferred and not domain language. |
| Queue-engine attempt events | Queue implementation is deferred; WorkerJob owns product lifecycle. |
| Log written events | Observability projection, not business fact. |
| Campaign/broadcast events | Out of MVP scope. |
| Group administration events | Out of MVP send scope. |
| Unsupported advanced send-type events | Out of MVP product commitment. |
