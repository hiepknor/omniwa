# OmniWA Non-Functional Requirements

This document defines product-level quality expectations. It does not choose infrastructure, database technology, deployment topology, API design, or internal architecture.

## Assumptions

- OmniWA will run long-lived WhatsApp sessions through Baileys.
- Production users will care about message reliability, reconnect behavior, webhook delivery, and troubleshooting.
- Early MVP quality targets should be realistic enough to implement while still setting a production direction.
- Targets may be revised after real workload data is collected.

## Performance

### Goal

OmniWA should feel responsive for common operational and messaging workflows under normal load.

### Metrics

- P95 product operation latency for common non-media actions: under 500 ms after the request reaches OmniWA, excluding upstream WhatsApp behavior.
- P95 text message enqueue latency: under 300 ms under normal load.
- P95 dashboard interaction latency for core pages: under 1 second with MVP-scale data.
- P95 media enqueue latency for supported MVP media under documented size limits: under 1 second, excluding upload/download time dominated by network and upstream WhatsApp behavior.

### Trade-off

Fast request acknowledgement should not imply guaranteed delivery. For reliability, some work may be queued and completed asynchronously. The product must clearly distinguish accepted, queued, sent, delivered, failed, and unknown states.

## Scalability

### Goal

OmniWA should scale from a single developer instance to many managed WhatsApp instances without changing the product model.

### Metrics

- MVP should support at least 10 active instances in one deployment profile for validation.
- Phase 2 scale-validation target: validate 100+ active instances through measured load testing.
- Queue throughput should be tracked by messages processed per minute and webhook events delivered per minute.

### Trade-off

The MVP should not over-optimize for large enterprise scale before proving the core lifecycle. However, naming, documentation, and product boundaries must not block future scale.

## Reliability

### Goal

OmniWA should handle expected failures gracefully: disconnects, reconnects, webhook failures, media failures, queue delays, and upstream Baileys changes.

### Metrics

- 85.0% of auto-recoverable disconnects should return to connected state within 5 minutes. Logout, policy restriction, missing credentials, device unlink, and action-required states are excluded and must be surfaced separately.
- 99.0% of webhook events should reach successful delivery within 15 minutes for healthy downstream endpoints.
- 95.0% of webhook events should succeed on first attempt for healthy downstream endpoints.
- 99.0% of accepted queue work should reach completed or terminal failed state within 10 minutes under normal MVP load.
- 0 known silent drops for accepted work; every accepted item should be observable as completed, pending, retried, failed, or action-required.
- Message failure reasons should be visible and categorized.
- Operator-visible error events should exist for critical instance and queue failures.

### Trade-off

Reliability requires surfacing complexity. The product should not pretend every failure is recoverable or hide unknown upstream states.

## Availability

### Goal

OmniWA should remain usable for operational tasks even when some instances, workers, or external dependencies are unhealthy.

### Metrics

- MVP target service availability: 99.0% for non-upstream product surfaces in controlled deployments.
- MVP production-readiness target for P1 OmniWA-controlled incident recovery: restore service within 4 hours.
- Critical operator actions should be available when individual WhatsApp instances fail.

### Trade-off

WhatsApp connectivity availability is not fully controlled by OmniWA. Availability reporting must separate platform availability from upstream account, device, network, and WhatsApp behavior.

## Maintainability

### Goal

OmniWA should be easy to understand, extend, debug, and review as the product grows.

### Metrics

- New backend contributors should understand the product domains within one onboarding session.
- Every core capability should have product documentation before implementation begins.
- Significant decisions should be captured as ADRs.
- Repeated implementation patterns should be documented before becoming conventions.

### Trade-off

Maintainability creates documentation and review overhead, but it prevents long-term product drift and hidden coupling.

## Security

### Goal

OmniWA should protect credentials, session material, customer data, webhook secrets, and operational controls.

### Metrics

- No session secrets, tokens, API keys, or sensitive payloads should be written to logs in plain text.
- Access to administrative actions should be authenticated and auditable.
- Sensitive data handling rules should be documented before production use.
- Security review should be an exit criterion for production-facing phases.
- Secret data must be encrypted in transit and at rest, never logged, and never exposed in plaintext after creation or capture except through controlled secret-handling flows.
- Confidential data must be encrypted in transit and at rest and redacted from normal logs.

### Trade-off

Security controls can slow down developer setup. The product should provide a simple local development path while keeping production defaults stricter.

### Data Classification

OmniWA uses four data classes:

| Class | Definition | Examples | Handling Requirement |
| --- | --- | --- | --- |
| Public | Information intentionally safe to publish. | Public docs, release notes, non-sensitive marketing copy. | No special protection required. |
| Internal | Operational information that should stay inside the operating team but does not identify message content or secrets. | Instance display names, aggregate health counts, non-sensitive configuration labels. | Access-controlled; safe for normal logs when it contains no identifiers or payloads. |
| Confidential | Customer, message, contact, webhook, media, or operational data that could expose business activity or personal data. | Phone numbers, JIDs, contact names, message metadata, message bodies, media metadata, webhook payloads, audit subjects. | Encrypted in transit and at rest; redacted from normal logs; visible only through authorized product surfaces. |
| Secret | Credentials or material that can grant access or impersonate a system, account, or instance. | API keys, webhook secrets, session/auth material, tokens, private encryption keys. | Encrypted in transit and at rest; never logged; never exposed in plaintext after creation or capture except through controlled secret-handling flows. |

## Observability

### Goal

Operators should understand what OmniWA is doing, why a workflow failed, and what action is needed.

### Metrics

- Each instance should expose product-level health state.
- Message, webhook, queue, and reconnect workflows should emit observable events.
- Critical failures should include human-readable categories.
- Dashboards should show current state and recent failure history.

### Trade-off

More observability creates more data volume. The product should prioritize actionable signals over noisy low-level traces.

## Logging

### Goal

Logs should help developers and operators debug production issues without exposing sensitive information.

### Metrics

- Logs should include correlation identifiers for important workflows.
- Logs should classify severity consistently.
- Logs should redact secrets and sensitive content by default.
- Error logs should preserve enough context for diagnosis without requiring raw user data.
- Secret data must never be logged.
- Confidential message bodies, media payloads, webhook payloads, phone numbers, and JIDs must be redacted, hashed, truncated, or replaced with references in normal logs.
- Diagnostic capture of Confidential content requires explicit enablement, expiration, and operator awareness.

### Trade-off

Redaction can reduce debugging detail. The product should support controlled diagnostic modes with clear safety warnings rather than unsafe default logging.

## Deployment

### Goal

OmniWA should be deployable by small teams first and adaptable to more mature production environments later.

### Metrics

- MVP deployment time for a developer should target under 30 minutes once documentation exists.
- Documented single-tenant MVP deployment should complete within 60 minutes once deployment documentation exists.
- Production deployment documentation should identify required configuration, secrets, and operational checks.
- Deployment health checks should be product-level, not only process-level.

### Trade-off

Phase 0 does not choose deployment architecture. The product requirement is that deployment must become repeatable, observable, and documented.

## Retention

### Goal

OmniWA should retain only the data needed for operation, troubleshooting, audit, and recovery.

### Metrics

| Data Category | Default Retention |
| --- | --- |
| Audit Log | 180 days. |
| Webhook Log | 30 days for delivery metadata and redacted payload references. |
| Message Log | 30 days for metadata; message body is not retained by default after processing. If diagnostic content capture is explicitly enabled, maximum retention is 7 days. |
| Queue | Completed work retained for 7 days; terminal failed or action-required work retained for 30 days. |
| Media | Binary media is not retained by default after processing; media metadata retained for 30 days. If diagnostic media capture is explicitly enabled, maximum retention is 7 days. |
| Session | Retained while the instance is active. Deleted within 24 hours after instance deletion, except encrypted backups that expire under backup retention. |
| Backup | Encrypted backups retained for 14 days. |

### Trade-off

Short content retention reduces privacy risk but can limit debugging detail. Metadata retention remains long enough for operational analysis.

## Backup

### Goal

Teams should be able to preserve the state needed to recover from expected failures.

### Metrics

- Encrypted backup at least once every 24 hours for OmniWA-owned recoverable state.
- Backup retention: 14 days.
- Recovery Point Objective: 24 hours for OmniWA-owned recoverable state.
- Backup restore should be tested before production readiness is claimed.
- Session material may be included in backups only when protected as Secret data.

### Trade-off

Not all WhatsApp state may be safely or meaningfully backed up by OmniWA. The product must separate OmniWA-managed state from upstream WhatsApp/device state.

## Recovery

### Goal

OmniWA should support recovery from service failure, instance failure, queue failure, and operator mistakes.

### Metrics

- Mean Time To Recovery should be tracked for critical incidents.
- Recovery runbooks should exist for common failure classes.
- Failed webhooks and queued jobs should have visible recovery paths.
- Instance reconnect procedures should be documented.
- Recovery Time Objective: 4 hours for P1 OmniWA-controlled service recovery.
- Restore validation should verify backup integrity, instance inventory, session state availability, queue state, webhook retry state, and audit continuity where available.
- Disaster recovery for MVP requires documented restore to a replacement environment. Active-active or multi-region disaster recovery is out of scope for MVP.

### Trade-off

Recovery workflows can become complex. MVP should focus on the highest-frequency and highest-impact failures before advanced disaster recovery scenarios.

## Quality Gates

Before Phase 1 system architecture starts, the team should agree on:

- MVP latency targets: defined in Performance.
- Initial instance scale target: at least 10 active instances in one deployment profile for validation.
- Minimum observability requirements: defined in Observability and Logging.
- Security baseline: defined in Security and Data Classification.
- Backup and recovery expectations: defined in Backup and Recovery.
- Production readiness definition: must include the accepted targets in this document.
