# OmniWA Bounded Contexts

## Purpose

This document defines OmniWA's bounded contexts at strategic DDD level.

The sections named "Published Domain Events" and "Consumed Domain Events" describe conceptual product signals only. They are not event schemas, event classes, queue topics, webhook payloads, or implementation contracts.

## Context Summary

| Context | Classification | Primary Capability |
| --- | --- | --- |
| Instance | Core | Manage the product lifecycle and visible state of a WhatsApp instance. |
| Session | Core | Manage pairing, active session, revocation, expiry, and Secret-sensitive session policy. |
| Messaging | Core | Manage supported message acceptance, lifecycle, and delivery visibility. |
| Webhook Delivery | Core | Manage external integration delivery lifecycle and retry/dead-letter visibility. |
| Guardrails | Core | Enforce product-level responsible usage decisions. |
| Media | Supporting | Manage MVP media metadata, validation, processing, and retention policy. |
| Provider Integration | Supporting | Translate provider behavior behind an anti-corruption boundary. |
| Operations | Supporting | Manage visible async work lifecycle, retry, recovery, and dead-letter state. |
| Security and Access | Supporting | Manage access concepts, capability decisions, and privileged action control. |
| Audit | Supporting | Manage Secret-safe audit evidence and retention semantics. |
| Health | Supporting | Classify product and dependency health for operator action. |
| Configuration | Generic | Manage validated configuration concepts without bypassing product constraints. |
| Observability | Generic | Manage sanitized telemetry vocabulary and correlation. |

## Instance Context

### Purpose

Represent each OmniWA-managed WhatsApp instance as a product resource with explicit lifecycle, health, and action-required state.

### Business Capability

- Create and manage instance lifecycle.
- Reflect connection readiness without exposing provider-native state.
- Distinguish OmniWA-controlled state from provider/account/downstream state.
- Surface operator action requirements.

### Owns

- Instance identity.
- Instance lifecycle state.
- Instance display/operational metadata.
- Instance health summary.
- Instance action-required state.

### Does Not Own

- Session Secret material.
- Provider-native connection payloads.
- Message delivery lifecycle.
- Webhook delivery lifecycle.
- Queue or worker implementation state.

### Inbound Dependencies

- Application orchestration for lifecycle commands.
- Session Context for session availability and revocation signals.
- Provider Integration Context for translated connection signals.
- Health Context for dependency health classification.

### Outbound Dependencies

- Session Context for pairing/session state coordination.
- Health Context for instance health projection.
- Audit Context for privileged lifecycle action evidence.

### Published Domain Events

- `instance.created`
- `instance.connect_requested`
- `instance.qr_required`
- `instance.connected`
- `instance.disconnected`
- `instance.logged_out`
- `instance.destroyed`
- `instance.action_required`
- `instance.health_changed`

### Consumed Domain Events

- `session.pending`
- `session.active`
- `session.expired`
- `session.revoked`
- `provider.connection_changed`
- `provider.logged_out`
- `health.dependency_changed`

### Public Contracts

- Instance lifecycle command contract through Application.
- Instance status query contract through Application.
- Instance action-required status contract.
- Instance health summary contract.

### Internal Concepts

- Instance status.
- Connection readiness.
- Action-required reason.
- Instance health category.
- Provider ownership hint.

## Session Context

### Purpose

Represent product-level session state and protect Secret-sensitive authentication/session material from leaking into business or observability flows.

### Business Capability

- Track pairing lifecycle.
- Track active, expired, revoked, and action-required session state.
- Enforce session retention and recovery product rules.
- Expose enough state for reconnect and operator visibility.

### Owns

- Session identity.
- Session lifecycle state.
- Session availability.
- Session action-required status.
- Session retention classification.
- Secret data classification for session/auth material.

### Does Not Own

- Instance lifecycle.
- QR presentation.
- Provider-native session format.
- Message delivery state.
- Webhook delivery state.
- Secret provider implementation.

### Inbound Dependencies

- Instance Context for instance lifecycle intent.
- Provider Integration Context for translated authentication and logout signals.
- Configuration Context for retention and backup policy values.
- Security and Access Context for privileged session actions.

### Outbound Dependencies

- Instance Context for session availability status.
- Operations Context for recovery/backup work visibility.
- Audit Context for privileged session actions.
- Health Context for session health classification.

### Published Domain Events

- `session.empty`
- `session.pending`
- `session.active`
- `session.expired`
- `session.revoked`
- `session.backup_required`
- `session.recovery_required`
- `session.action_required`

### Consumed Domain Events

- `instance.created`
- `instance.destroyed`
- `provider.authenticated`
- `provider.authentication_failed`
- `provider.logged_out`
- `provider.session_invalid`
- `configuration.changed`

### Public Contracts

- Session state contract through Application.
- Session pairing status contract.
- Session retention status contract.
- Session recovery status contract.

### Internal Concepts

- Pairing state.
- Active session marker.
- Session expiry reason.
- Revocation reason.
- Secret handling category.

## Messaging Context

### Purpose

Represent product-level inbound and outbound message workflows for the MVP-supported message types.

### Business Capability

- Accept or reject outbound message intent according to supported product scope.
- Track message lifecycle from accepted work through delivery visibility.
- Classify inbound provider messages into product message concepts.
- Preserve the distinction between delivery attempt and upstream WhatsApp delivery guarantee.

### Owns

- Message identity.
- Message direction.
- Supported message type classification.
- Message lifecycle state.
- Delivery visibility state.
- Message metadata retention policy.
- Product-level failure category for message workflows.

### Does Not Own

- Session lifecycle or session Secret data.
- Provider-native message payload.
- Media binary storage.
- Webhook delivery.
- Campaign, broadcast, audience, or marketing workflows.
- Unsupported advanced message types.

### Inbound Dependencies

- Application orchestration for message intent.
- Session Context for session availability.
- Guardrails Context for accept/block/throttle decisions.
- Media Context for media metadata readiness.
- Provider Integration Context for translated send result and inbound message signals.
- Operations Context for async work lifecycle.

### Outbound Dependencies

- Guardrails Context before outbound acceptance.
- Media Context for media-bearing message metadata.
- Webhook Delivery Context through published product signals.
- Audit Context for security-sensitive message action evidence where required.
- Health Context for message flow degradation.

### Published Domain Events

- `message.accepted`
- `message.rejected`
- `message.queued`
- `message.processing`
- `message.sent`
- `message.delivered`
- `message.read`
- `message.failed`
- `message.cancelled`
- `message.inbound_received`

### Consumed Domain Events

- `session.active`
- `session.expired`
- `session.revoked`
- `guardrail.passed`
- `guardrail.blocked`
- `guardrail.throttled`
- `media.accepted`
- `media.failed`
- `provider.message_sent`
- `provider.delivery_updated`
- `provider.inbound_message_received`
- `worker.job.dead`

### Public Contracts

- Message acceptance contract through Application.
- Message status contract through Application.
- Inbound message classification contract.
- Supported message type contract.

### Internal Concepts

- Outbound message intent.
- Inbound message signal.
- Delivery status.
- Failure reason.
- Supported message type.
- Message retention category.

## Webhook Delivery Context

### Purpose

Represent external integration delivery as a reliable, observable product workflow.

### Business Capability

- Convert approved product signals into integration delivery work.
- Track webhook delivery lifecycle.
- Make retry and dead-letter states visible.
- Ensure webhook failure does not mutate core business state.

### Owns

- Webhook subscription intent at product level.
- Webhook delivery lifecycle.
- Webhook delivery retry state.
- Webhook dead-letter visibility.
- Webhook delivery failure classification.

### Does Not Own

- Original business facts.
- Message lifecycle state.
- Instance/session lifecycle state.
- External receiver uptime.
- Webhook transport implementation.
- Provider callbacks.

### Inbound Dependencies

- Published product signals from Instance, Session, Messaging, Media, Guardrails, Operations, Health, and Audit contexts.
- Configuration Context for endpoint and delivery policy values.
- Operations Context for async delivery work lifecycle.

### Outbound Dependencies

- Operations Context for delivery jobs, retry, timeout, and dead-letter visibility.
- Audit Context for delivery failure evidence where required.
- Observability Context for sanitized delivery telemetry.

### Published Domain Events

- `webhook.delivery.scheduled`
- `webhook.delivery.delivering`
- `webhook.delivery.delivered`
- `webhook.delivery.retrying`
- `webhook.delivery.failed`
- `webhook.delivery.dead_lettered`

### Consumed Domain Events

- `instance.*`
- `session.*`
- `message.*`
- `media.*`
- `guardrail.*`
- `health.state_changed`
- `configuration.changed`
- `worker.job.completed`
- `worker.job.dead`

### Public Contracts

- Webhook subscription status contract through Application.
- Webhook delivery status contract through Application.
- Dead-letter visibility contract.
- Replay eligibility policy contract.

### Internal Concepts

- Integration signal.
- Delivery attempt.
- Retry eligibility.
- Dead-letter reason.
- Receiver failure category.

## Guardrails Context

### Purpose

Enforce product-level responsible usage rules before OmniWA accepts outbound work that could violate MVP scope or responsible-operation constraints.

### Business Capability

- Detect unsupported broadcast/campaign-like intent.
- Apply rate-limit and abuse-risk decisions.
- Block, throttle, allow, or mark action-required outcomes.
- Keep guardrail decisions operator-visible.

### Owns

- Guardrail decision.
- Rate-limit state at product level.
- Abuse-risk classification.
- Unsupported usage classification.
- Guardrail action-required state.

### Does Not Own

- Legal compliance automation.
- Customer consent evidence outside OmniWA.
- WhatsApp or Meta policy enforcement.
- Provider account health.
- Campaign management.
- Configuration as a bypass path.

### Inbound Dependencies

- Messaging Context for outbound intent classification.
- Configuration Context for validated thresholds and policy toggles that cannot bypass mandatory guardrails.
- Security and Access Context for actor/capability context.

### Outbound Dependencies

- Messaging Context for allow/block/throttle outcome.
- Audit Context for blocked or sensitive decisions.
- Health Context for systemic abuse-risk degradation.
- Observability Context for sanitized guardrail telemetry.

### Published Domain Events

- `guardrail.passed`
- `guardrail.blocked`
- `guardrail.throttled`
- `guardrail.abuse_risk_detected`
- `guardrail.action_required`

### Consumed Domain Events

- `message.intent_submitted`
- `configuration.changed`
- `security.access_context_changed`

### Public Contracts

- Guardrail evaluation contract through Application.
- Guardrail decision status contract.
- Guardrail reason vocabulary.

### Internal Concepts

- Guardrail decision.
- Guardrail reason.
- Rate-limit window.
- Abuse-risk indicator.
- Unsupported usage indicator.

## Media Context

### Purpose

Represent MVP media metadata and processing state without retaining media bodies by default.

### Business Capability

- Classify supported media categories: image, video, document, and audio.
- Validate media metadata and product limits.
- Track media processing state.
- Enforce media retention and diagnostic capture rules.

### Owns

- Media identity.
- Media category.
- Media metadata.
- Media processing state.
- Media retention classification.
- Diagnostic capture state when explicitly enabled.

### Does Not Own

- Message lifecycle.
- Object storage implementation.
- Provider media transport internals.
- Default binary retention.
- Unsupported message types such as sticker, location, contact card, reaction, poll, interactive, status, newsletter, commerce, campaign, or broadcast.

### Inbound Dependencies

- Messaging Context for media-bearing message intent.
- Configuration Context for size, type, retention, and diagnostic policy values.
- Provider Integration Context for translated provider media result signals.

### Outbound Dependencies

- Messaging Context for media readiness or failure.
- Operations Context for async media work visibility.
- Audit Context for diagnostic capture evidence.
- Observability Context for sanitized processing telemetry.

### Published Domain Events

- `media.accepted`
- `media.processing`
- `media.processed`
- `media.failed`
- `media.retention_expired`
- `media.diagnostic_capture_requested`

### Consumed Domain Events

- `message.media_submitted`
- `provider.media_uploaded`
- `provider.media_downloaded`
- `configuration.changed`
- `worker.job.dead`

### Public Contracts

- Media metadata validation contract through Application.
- Media processing status contract.
- Media retention status contract.

### Internal Concepts

- Media category.
- Attachment metadata.
- Processing result.
- Retention decision.
- Diagnostic capture marker.

## Provider Integration Context

### Purpose

Protect OmniWA product language from Baileys and future provider-specific behavior.

### Business Capability

- Translate product requests into provider operations.
- Translate provider signals into product-level signals.
- Classify provider failures into product error categories.
- Preserve provider abstraction boundaries.

### Owns

- Provider compatibility language.
- Provider capability mapping.
- Provider signal translation.
- Provider error classification.
- Provider boundary health hints.

### Does Not Own

- Business rules.
- Guardrail decisions.
- Message lifecycle policy.
- Session product policy.
- Webhook delivery.
- Provider-native payload exposure to domain.

### Inbound Dependencies

- Application-defined provider ports.
- Configuration Context for provider selection/configuration values.
- Session Context for product session state requests through Application.
- Messaging and Media contexts for product operation intent through Application.

### Outbound Dependencies

- Instance Context through translated connection signals.
- Session Context through translated authentication/session signals.
- Messaging Context through translated message signals.
- Media Context through translated media signals.
- Health Context through provider health classification.

### Published Domain Events

- None as a business policy owner.
- It emits translated provider signals such as `provider.connection_changed`, `provider.authenticated`, `provider.message_sent`, and `provider.delivery_updated` for Application-owned routing.

### Consumed Domain Events

- Product operation intent coordinated by Application.
- `configuration.changed`
- `session.recovery_required`

### Public Contracts

- Provider capability contract.
- Provider signal translation contract.
- Provider failure classification contract.
- Provider compatibility contract.

### Internal Concepts

- Provider capability.
- Provider signal.
- Provider failure category.
- Provider compatibility status.

## Operations Context

### Purpose

Represent async work as visible product-supporting lifecycle state.

### Business Capability

- Track accepted async work.
- Track retry, timeout, backpressure, and dead-letter states.
- Expose recovery/action-required status.
- Prevent accepted work from silently disappearing.

### Owns

- Worker job lifecycle at product-supporting level.
- Retry state.
- Dead-letter state.
- Scheduler signal.
- Recovery signal.
- Backpressure classification.

### Does Not Own

- Message business policy.
- Session business policy.
- Webhook business policy.
- Queue engine implementation.
- Worker process implementation.

### Inbound Dependencies

- Application orchestration for accepted async work.
- Messaging Context for outbound send work visibility.
- Webhook Delivery Context for webhook delivery work visibility.
- Media Context for media processing work visibility.
- Session Context for recovery work visibility.

### Outbound Dependencies

- Owning product context for job result interpretation.
- Health Context for queue/worker degradation.
- Audit Context for operator-visible dead-letter actions.
- Observability Context for sanitized job telemetry.

### Published Domain Events

- `worker.job.queued`
- `worker.job.reserved`
- `worker.job.running`
- `worker.job.completed`
- `worker.job.retrying`
- `worker.job.dead`
- `worker.backpressure_detected`

### Consumed Domain Events

- `message.accepted`
- `webhook.delivery.scheduled`
- `media.accepted`
- `session.recovery_required`
- `configuration.changed`

### Public Contracts

- Async work lifecycle contract through Application.
- Retry status contract.
- Dead-letter status contract.
- Recovery status contract.

### Internal Concepts

- Job lifecycle.
- Retry eligibility.
- Dead-letter reason.
- Backpressure state.
- Recovery action.

## Security And Access Context

### Purpose

Represent who may perform privileged product actions and what access context must be available for sensitive operations.

### Business Capability

- Classify actors and capabilities.
- Decide whether an actor may request sensitive operations.
- Mark privileged actions for audit.
- Protect access-sensitive operations without owning identity provider implementation.

### Owns

- Access context.
- Capability decision.
- Privileged action classification.
- API key security classification.
- Actor role vocabulary.

### Does Not Own

- External identity provider records.
- Session Secret storage implementation.
- Product lifecycle state.
- Audit record retention.
- Billing or tenant management.

### Inbound Dependencies

- Interface/Application request context.
- Configuration Context for security policy values.
- Audit Context for evidence requirements.

### Outbound Dependencies

- Product contexts requiring access decisions.
- Audit Context for privileged action evidence.
- Observability Context for sanitized security telemetry.

### Published Domain Events

- `security.access_granted`
- `security.access_denied`
- `security.privileged_action_requested`
- `security.secret_access_requested`

### Consumed Domain Events

- `configuration.changed`
- `audit.record_requested`

### Public Contracts

- Access decision contract.
- Capability vocabulary.
- Privileged action classification contract.

### Internal Concepts

- Actor.
- Capability.
- Access decision.
- Privileged action.
- Secret access reason.

## Audit Context

### Purpose

Represent Secret-safe operational and security evidence required for accountability and review.

### Business Capability

- Record audit-relevant facts without storing Secret data.
- Apply audit retention policy.
- Capture privileged action evidence.
- Preserve traceability for guardrail, session, configuration, and operator actions.

### Owns

- Audit record semantics.
- Audit retention category.
- Audit redaction requirement.
- Audit evidence classification.

### Does Not Own

- Application logs.
- Raw message bodies.
- Raw media payloads.
- Raw webhook payloads.
- Identity provider records.
- Product lifecycle state.

### Inbound Dependencies

- Security and Access Context for privileged actions.
- Session Context for sensitive session actions.
- Guardrails Context for blocked/throttled decisions.
- Configuration Context for configuration changes.
- Operations Context for dead-letter and recovery actions.

### Outbound Dependencies

- Observability Context for sanitized audit telemetry.
- Health Context if audit path degradation affects operations.

### Published Domain Events

- `audit.record_requested`
- `audit.recorded`
- `audit.redaction_applied`
- `audit.retention_expired`

### Consumed Domain Events

- `security.privileged_action_requested`
- `security.access_denied`
- `session.revoked`
- `guardrail.blocked`
- `configuration.changed`
- `worker.job.dead`

### Public Contracts

- Audit evidence contract.
- Redaction requirement contract.
- Audit retention status contract.

### Internal Concepts

- Audit record.
- Audit category.
- Evidence summary.
- Redaction marker.
- Retention expiry.

## Health Context

### Purpose

Classify product and dependency health so operators can understand whether issues are caused by OmniWA, provider/account state, downstream receivers, or infrastructure dependencies.

### Business Capability

- Combine safe health signals.
- Classify degraded, unavailable, action-required, and recovered states.
- Distinguish OmniWA-controlled failures from upstream/downstream failures.
- Provide operator-readable health status.

### Owns

- Health state.
- Dependency health category.
- Action-required health reason.
- Recovery visibility.

### Does Not Own

- Reconnect business policy.
- Provider implementation health probes.
- Message delivery state.
- Webhook delivery state.
- Observability storage.

### Inbound Dependencies

- Instance Context.
- Session Context.
- Provider Integration Context.
- Operations Context.
- Webhook Delivery Context.
- Configuration Context.
- Observability Context for sanitized telemetry summary.

### Outbound Dependencies

- Instance Context for instance health projection.
- Operations Context for recovery visibility.
- Audit Context for operator action evidence when required.

### Published Domain Events

- `health.state_changed`
- `health.degraded`
- `health.recovered`
- `health.action_required`
- `health.dependency_changed`

### Consumed Domain Events

- `instance.health_changed`
- `session.action_required`
- `provider.connection_changed`
- `provider.failure_classified`
- `worker.backpressure_detected`
- `webhook.delivery.dead_lettered`
- `configuration.changed`

### Public Contracts

- Health summary contract.
- Dependency health status contract.
- Action-required health contract.

### Internal Concepts

- Health category.
- Dependency category.
- Degradation reason.
- Recovery marker.

## Configuration Context

### Purpose

Represent validated configuration concepts while preventing configuration from silently bypassing frozen product guardrails.

### Business Capability

- Validate configuration meaning.
- Classify configuration safety.
- Preserve explicit configuration change visibility.
- Prevent disabling required guardrails through configuration.

### Owns

- Configuration snapshot concept.
- Configuration validation result.
- Configuration safety classification.
- Configuration change reason.

### Does Not Own

- Business policy decisions.
- Provider implementation configuration loading.
- Secret provider implementation.
- Guardrail outcomes.
- Deployment environment design.

### Inbound Dependencies

- Application configuration change flow.
- Security and Access Context for privileged configuration actions.

### Outbound Dependencies

- Guardrails Context for validated thresholds and non-bypassable settings.
- Session Context for retention and backup policy values.
- Media Context for media limits and retention policy values.
- Webhook Delivery Context for delivery policy values.
- Audit Context for configuration change evidence.

### Published Domain Events

- `configuration.validated`
- `configuration.rejected`
- `configuration.changed`
- `configuration.guardrail_bypass_rejected`

### Consumed Domain Events

- `security.privileged_action_requested`

### Public Contracts

- Configuration validation contract.
- Configuration safety contract.
- Configuration snapshot status contract.

### Internal Concepts

- Configuration snapshot.
- Configuration safety.
- Guardrail-bypass prevention.
- Change reason.

## Observability Context

### Purpose

Represent sanitized telemetry, correlation, and failure classification vocabulary without becoming a raw payload sink or business owner.

### Business Capability

- Preserve correlation, request, and trace vocabulary.
- Classify telemetry safety.
- Project sanitized product/failure signals into logs, metrics, and traces.
- Support debugging without exposing Secret or raw Confidential data.

### Owns

- Correlation context vocabulary.
- Telemetry safety category.
- Sanitized failure projection.
- Metric/log/trace naming semantics at product level.

### Does Not Own

- Business rules.
- Product lifecycle state.
- Audit records.
- Raw provider payloads.
- Raw message bodies.
- Raw media payloads.
- Raw webhook payloads.

### Inbound Dependencies

- Sanitized signals from product contexts.
- Error classifications from Application/domain boundaries.
- Configuration Context for telemetry safety policy values.

### Outbound Dependencies

- Monitoring systems through infrastructure adapters.
- Health Context through sanitized telemetry summary where applicable.

### Published Domain Events

- None as a business context.
- It may emit sanitized telemetry signals, but those are not business facts.

### Consumed Domain Events

- Sanitized summaries of `instance.*`, `session.*`, `message.*`, `media.*`, `webhook.delivery.*`, `guardrail.*`, `worker.job.*`, `health.*`, `audit.*`, and error classifications.

### Public Contracts

- Correlation context contract.
- Telemetry safety contract.
- Sanitized failure projection contract.

### Internal Concepts

- Correlation ID.
- Request ID.
- Trace ID.
- Telemetry category.
- Redaction marker.
- Failure classification.
