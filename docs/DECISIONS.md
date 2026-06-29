# OmniWA Product Decisions

## Purpose

This document resolves Phase 0 blocked findings and critical open questions so the product definition can return to Freeze Review.

This is not an architecture document. It does not define APIs, databases, modules, infrastructure, or deployment topology.

## Decision Summary

| Decision ID | Topic | Status | Decision |
| --- | --- | --- | --- |
| DEC-001 | MVP Persona | Accepted | Primary: developer-led SaaS builder. Secondary: internal technical team. |
| DEC-002 | Tenancy Model | Accepted | MVP uses Single Tenant + Multi Instance. |
| DEC-003 | Compliance Posture | Accepted | OmniWA is an API platform with MVP product-enforced guardrails. |
| DEC-004 | Supported Message Types | Accepted | MVP supports text, image, video, document, and audio. Other types are deferred or rejected for MVP. |
| DEC-005 | Reliability Target | Accepted | MVP has explicit targets for availability, webhooks, reconnects, queues, and deployment time. |
| DEC-006 | Data Retention | Accepted | MVP has fixed default retention windows for audit, webhook, message, queue, media, session, and backup data. |
| DEC-007 | Sensitive Data | Accepted | MVP uses four data classes: Public, Internal, Confidential, and Secret. |
| DEC-008 | Backup And Recovery | Accepted | MVP requires encrypted daily backup, 24h RPO, 4h RTO, and documented recovery procedure. |
| DEC-009 | Baileys Upgrade Policy | Accepted | MVP pins Baileys versions and upgrades through regression validation with rollback. |

## DEC-001 - MVP Persona

### Status

Accepted.

### Decision

OmniWA MVP targets the following personas:

- Primary persona: developer-led SaaS builder.
- Secondary persona: internal technical team operating WhatsApp automation for one organization.

The primary persona is a developer or small technical team building WhatsApp messaging capabilities into a product or operational workflow. This persona needs reliable instance lifecycle, messaging, webhooks, troubleshooting, and clear product boundaries before advanced enterprise features.

### Rationale

This choice aligns with the existing vision: OmniWA should provide a stable product surface over Baileys, improve developer experience, and remain production-minded. It also keeps MVP focused on integration and operation rather than broad CRM, campaign, or enterprise platform features.

### Alternatives Considered

- Startup teams: too broad for architecture-relevant MVP decisions because startup needs vary from prototypes to production operations.
- CRM systems: important integration target, but CRM-specific workflows would pull OmniWA toward becoming a CRM product.
- Automation platforms: important integration target, but platform marketplace and connector needs should not drive the MVP core.
- Internal enterprise teams as primary: valuable, but enterprise governance would force tenant, audit, and compliance scope too early.

### Trade-offs

The MVP becomes narrower and easier to validate. The trade-off is that CRM-specific, automation-platform-specific, and enterprise governance capabilities are deferred until the core platform is reliable.

### Future Impact

Future phases can add stronger enterprise controls, connectors, SDKs, and CRM-oriented workflows after the core platform proves reliable for the primary persona.

## DEC-002 - Tenancy Model

### Status

Accepted.

### Decision

OmniWA MVP uses Single Tenant + Multi Instance.

One deployment represents one organization, workspace, or operational owner. That owner can manage multiple WhatsApp instances. MVP does not provide multi-tenant isolation.

### Rationale

Single Tenant + Multi Instance matches the MVP need to operate more than one WhatsApp connection without prematurely adding tenant isolation, tenant billing, tenant administration, tenant-level policy, or cross-tenant security controls.

### Security Impact

The MVP security boundary is one organization per deployment. Access control must protect administrative actions and sensitive data inside that deployment, but MVP does not claim isolation between unrelated customers inside the same deployment.

### Database Impact

Phase 0.5 does not design a database. Product-wise, MVP data belongs to one tenant boundary and multiple instances. Future multi-tenancy would require an explicit migration decision and cannot be assumed from the MVP model.

### API Impact

Phase 0.5 does not design APIs. Product-wise, MVP contracts should not expose multi-tenant behavior or imply cross-tenant administration. Instance identity is the main product scope within the single tenant boundary.

### Deployment Impact

MVP deployment is scoped to one organization or workspace. Customers needing hard isolation between organizations should use separate deployments until a later multi-tenant product phase is approved.

### Alternatives Considered

- Single Tenant + Single Instance: simpler, but too limited for the stated goal of operating many WhatsApp connections.
- Multi Tenant: powerful, but increases security, retention, backup, observability, and administration complexity before MVP value is proven.

### Trade-offs

The decision supports meaningful multi-instance use while avoiding multi-tenant complexity. The trade-off is that SaaS providers serving many end customers need separate deployments or must wait for a later multi-tenant phase.

### Future Impact

Future multi-tenancy remains possible, but it must be introduced through a dedicated decision, migration plan, and security review.

## DEC-003 - Compliance Posture

### Status

Accepted.

### Decision

OmniWA is an API platform with MVP product-enforced guardrails.

The MVP does not attempt to provide legal compliance automation. It does enforce product boundaries that reduce obvious misuse.

### Definitions

- Spam: unsolicited, deceptive, repetitive, or high-volume messaging sent without user consent or outside an expected conversation.
- Broadcast: sending the same or near-identical message to many recipients as a campaign or audience blast.
- Rate limit: a product-level send control that caps unsafe bursts and makes throughput limits visible. It is not a bypass for WhatsApp limits.
- Abuse detection: product-level detection of suspicious usage patterns such as excessive failures, blocked sends, repeated recipients, or abnormal burst behavior. MVP detection is rule-based and operator-visible, not automated enforcement by machine learning.

### MVP Guardrails

- Broadcast and campaign sending are not supported in MVP.
- Bulk recipient import for sending is not supported in MVP.
- Product documentation must state that users are responsible for opt-in, consent, and policy compliance.
- Sending workflows must have visible rate-limit and abuse-risk states before production readiness.
- Operators must be able to see when activity is blocked, throttled, failed, or marked action-required.

### Rationale

OmniWA's vision explicitly rejects spam, policy bypass, and Cloud API replacement positioning. Documentation-only guardrails are not enough for a production-minded WhatsApp automation platform, but heavy compliance automation would overreach the MVP.

### Alternatives Considered

- Documentation-only API platform: simpler, but too weak for known WhatsApp policy and misuse risks.
- Full compliance automation: too broad for MVP and would imply legal certainty OmniWA cannot provide.

### Trade-offs

Product-enforced guardrails may block some high-volume use cases. The trade-off is acceptable because OmniWA should optimize for responsible, durable usage rather than risky growth.

### Future Impact

Future phases can add richer policy controls, approval workflows, abuse analytics, and enterprise governance after MVP behavior is validated.

## DEC-004 - Supported Message Types

### Status

Accepted.

### Decision

MVP supports the following message types:

- Text.
- Image.
- Video.
- Document.
- Audio, including voice-note-like audio where supported by the underlying WhatsApp behavior.

MVP does not support the following as product capabilities:

- Sticker.
- Location.
- Contact card.
- Reaction.
- Poll.
- Button, list, template, or interactive business message.
- Status or story.
- Newsletter or channel message.
- Broadcast or campaign message.
- Group administration message.
- Payment, catalog, order, or commerce-specific message.

Unsupported incoming message types should be visible as unsupported events where safe and useful, but they are not MVP send capabilities.

### Rationale

Text plus basic media is enough to validate the core product promise without creating a large compatibility matrix. The decision also aligns with the existing MVP scope that names text and basic media.

### Alternatives Considered

- Text only: too narrow for real business workflows.
- All common WhatsApp types: too broad and risky for MVP reliability.
- Include reactions, stickers, location, and contacts: useful, but not necessary to prove the core platform.

### Trade-offs

MVP supports practical communication while deferring lower-priority and higher-variance formats. The trade-off is that some integrations will need to wait for later phases.

### Future Impact

New message types can be added after the MVP reliability baseline is proven and each type has explicit product behavior, observability, and failure handling.

## DEC-005 - Reliability Target

### Status

Accepted.

### Decision

The MVP reliability targets are:

| Metric | MVP Target |
| --- | --- |
| API Availability | 99.0% monthly availability for OmniWA-controlled product surfaces, excluding upstream WhatsApp, device, account, and customer network failures. |
| API Latency | P95 under 500 ms for common non-media product operations under normal MVP load. |
| Text Message Enqueue Latency | P95 under 300 ms under normal MVP load. |
| Webhook Success Rate | 99.0% eventual delivery within 15 minutes for healthy downstream endpoints. |
| Webhook First-Attempt Success Rate | 95.0% for healthy downstream endpoints. |
| Reconnect Success | 85.0% of auto-recoverable disconnects return to connected state within 5 minutes. Logout, policy restriction, missing credentials, device unlink, and action-required states are excluded from this rate and must be surfaced separately. |
| Queue Success | 99.0% of accepted queue work reaches completed or terminal failed state within 10 minutes under normal MVP load. |
| Accepted Work Loss | 0 known silent drops; every accepted work item must be observable as completed, pending, retried, failed, or action-required. |
| Deployment Time | Local developer setup under 30 minutes; documented single-tenant MVP deployment under 60 minutes. |
| MTTR | P1 OmniWA-controlled incidents restored within 4 hours. |

### Rationale

The targets are explicit enough for Phase 1 architecture evaluation while still realistic for an MVP that depends on WhatsApp Web behavior through Baileys.

### Alternatives Considered

- Higher availability targets such as 99.9%: not realistic before production learning and operational maturity.
- No numeric targets until implementation: blocks architecture and release readiness decisions.
- Messaging delivery guarantees: rejected because upstream WhatsApp behavior is not fully controlled by OmniWA.

### Trade-offs

The targets force observability and recovery discipline early. The trade-off is that implementation cannot treat operational behavior as an afterthought.

### Future Impact

Post-MVP phases may raise availability, reconnect, queue, and MTTR targets after real workload data exists.

## DEC-006 - Data Retention

### Status

Accepted.

### Decision

MVP default retention policy:

| Data Category | Default Retention |
| --- | --- |
| Audit Log | 180 days. |
| Webhook Log | 30 days for delivery metadata and redacted payload references. |
| Message Log | 30 days for metadata; message body is not retained by default after processing. If diagnostic content capture is explicitly enabled, maximum retention is 7 days. |
| Queue | Completed work retained for 7 days; terminal failed or action-required work retained for 30 days. |
| Media | Binary media is not retained by default after processing; media metadata retained for 30 days. If diagnostic media capture is explicitly enabled, maximum retention is 7 days. |
| Session | Retained while the instance is active. Deleted within 24 hours after instance deletion, except encrypted backups that expire under backup retention. |
| Backup | Encrypted backups retained for 14 days. |

### Rationale

These defaults balance debugging needs, privacy, storage cost, and the risk of holding sensitive messaging data longer than needed.

### Alternatives Considered

- Keep all message and media content for troubleshooting: rejected because it creates unnecessary privacy and security risk.
- Keep only operational metadata for 7 days: too short for incident review and customer support.
- No fixed retention defaults: blocks security and recovery planning.

### Trade-offs

Short content retention reduces privacy risk but may limit debugging detail. Metadata retention remains long enough for operational analysis.

### Future Impact

Future enterprise phases can add configurable retention policies, legal hold, tenant-specific retention, and deletion workflows after governance requirements are approved.

## DEC-007 - Sensitive Data

### Status

Accepted.

### Decision

MVP uses four data classes:

| Class | Definition | Examples | Handling Requirement |
| --- | --- | --- | --- |
| Public | Information intentionally safe to publish. | Public docs, release notes, non-sensitive marketing copy. | No special protection required. |
| Internal | Operational information that should stay inside the operating team but does not identify message content or secrets. | Instance display names, aggregate health counts, non-sensitive configuration labels. | Access-controlled; safe for normal logs when it contains no identifiers or payloads. |
| Confidential | Customer, message, contact, webhook, media, or operational data that could expose business activity or personal data. | Phone numbers, JIDs, contact names, message metadata, message bodies, media metadata, webhook payloads, audit subjects. | Encrypted in transit and at rest; redacted from normal logs; visible only through authorized product surfaces. |
| Secret | Credentials or material that can grant access or impersonate a system, account, or instance. | API keys, webhook secrets, session/auth material, tokens, private encryption keys. | Encrypted at rest and in transit; never logged; never exposed in plaintext after creation or capture except through controlled secret-handling flows. |

### Logging Rules

- Secret data must never be logged.
- Confidential message bodies, media payloads, webhook payloads, phone numbers, and JIDs must be redacted, hashed, truncated, or replaced with references in normal logs.
- Diagnostic capture of Confidential content requires explicit enablement, expiration, and operator awareness.

### Rationale

OmniWA handles session material and communications data. Without a clear classification model, security and observability decisions will conflict.

### Alternatives Considered

- Simple sensitive/non-sensitive model: easier, but too vague for message platforms.
- Full enterprise classification model: stronger, but too heavy for MVP.

### Trade-offs

The four-tier data classification model is simple enough for MVP but precise enough to guide Phase 1 security review.

### Future Impact

Future phases can add data residency, tenant-specific classification, legal hold, and compliance evidence workflows.

## DEC-008 - Backup And Recovery

### Status

Accepted.

### Decision

MVP backup and recovery targets:

| Area | MVP Decision |
| --- | --- |
| Backup Frequency | Encrypted backup at least once every 24 hours for OmniWA-owned recoverable state. |
| Backup Retention | 14 days. |
| Recovery Point Objective | 24 hours for OmniWA-owned recoverable state. |
| Recovery Time Objective | 4 hours for P1 OmniWA-controlled service recovery. |
| Restore Validation | Restore procedure must verify backup integrity, instance inventory, session state availability, queue state, webhook retry state, and audit continuity where available. |
| Disaster Recovery | MVP requires documented restore to a replacement environment. Active-active or multi-region disaster recovery is out of scope for MVP. |

### Recovery Procedure

The product recovery procedure must cover:

- Identify the incident category and affected instances.
- Restore the latest valid encrypted backup for OmniWA-owned recoverable state.
- Validate restored instance inventory and operational logs.
- Validate session state and mark instances that require re-pairing as action-required.
- Resume or mark queued work according to visible terminal states.
- Re-deliver failed webhooks only when safe and idempotency expectations are met.
- Record recovery outcome in the audit log.

### Rationale

MVP needs a realistic recovery baseline without claiming control over all WhatsApp, device, account, or upstream state.

### Alternatives Considered

- No backup requirement for MVP: rejected because session and operational state are production-critical.
- Continuous backup and multi-region disaster recovery: too expensive and complex for MVP.

### Trade-offs

Daily backup and 4-hour recovery are pragmatic. The trade-off is that some recent state can be lost within the 24-hour RPO and some instances may require re-pairing.

### Future Impact

Future phases can improve RPO, RTO, regional resilience, restore automation, and recovery testing cadence.

## DEC-009 - Baileys Upgrade Policy

### Status

Accepted.

### Decision

MVP Baileys policy:

| Area | MVP Decision |
| --- | --- |
| Version Pinning | Pin an exact Baileys version. Do not track `latest` in MVP. |
| Upgrade Cadence | Review upgrades monthly and immediately when a security issue, WhatsApp Web breakage, or critical compatibility issue appears. |
| Upgrade Process | Upgrade in an isolated change, review release notes and observed behavior, run regression validation, then approve or reject the upgrade. |
| Regression Testing | Validate QR pairing, session restart, reconnect, text send/receive, supported media send/receive, webhook events, message status visibility, queue terminal states, and failure categorization. |
| Rollback | Keep the previous known-good version available for rollback. Roll back if regression validation fails or production-critical behavior breaks. |
| Compatibility Policy | MVP supports one pinned Baileys line at a time. Multi-version runtime compatibility is out of scope for MVP. |

### Rationale

Baileys depends on WhatsApp Web behavior, so uncontrolled upgrades are a production risk. Exact pinning and regression gates protect the OmniWA product contract.

### Alternatives Considered

- Always upgrade immediately: reduces drift but increases regression risk.
- Never upgrade during MVP: safer short-term but dangerous if WhatsApp Web changes or security issues appear.
- Support multiple Baileys versions at runtime: too complex for MVP.

### Trade-offs

Pinning slows access to upstream fixes. The trade-off is acceptable because production reliability is more important than feature velocity.

### Future Impact

Future phases can formalize a compatibility matrix, long-term support policy, and upgrade automation after MVP behavior stabilizes.

## Open Questions Disposition

| OQ | Status | Resolution |
| --- | --- | --- |
| OQ-001 | Resolved | Product positioning is developer-first, production-minded API platform for developer-led SaaS builders and internal technical teams. |
| OQ-002 | Resolved | DEC-001 selects primary and secondary MVP personas. |
| OQ-003 | Resolved | DEC-002 selects Single Tenant + Multi Instance. |
| OQ-004 | Resolved | DEC-003 selects product-enforced MVP guardrails. |
| OQ-005 | Resolved | OmniWA recommends Meta's official WhatsApp Business Platform when official compliance, templates, business-initiated messaging, or Meta-supported guarantees are required. |
| OQ-006 | Resolved | DEC-004 selects MVP message types. |
| OQ-007 | Resolved | Group features are deferred from MVP except safe visibility of unsupported incoming events where useful. |
| OQ-008 | Resolved | MVP dashboard is limited to instance health, QR pairing state, recent message/event inspection, webhook delivery status, and queue/failure visibility. |
| OQ-009 | Deferred | Stable SDK packages are deferred until after the core platform behavior is proven. MVP may provide documentation and examples only. |
| OQ-010 | Resolved | DEC-005 sets reliability targets. |
| OQ-011 | Resolved | DEC-006 sets data retention defaults. |
| OQ-012 | Resolved | DEC-007 sets data classes and handling rules. |
| OQ-013 | Resolved | DEC-008 sets backup and recovery targets. |
| OQ-014 | Resolved | DEC-009 sets Baileys upgrade policy. |
| OQ-015 | Resolved | Metric ownership belongs to role owners: Product owns product success metrics, Backend owns platform behavior metrics, DevOps owns deployment/recovery metrics, Security owns data handling and abuse guardrails. Named owners can be assigned when the team roster exists. |

## Affected Documents

| Document | Affected Sections | Reason |
| --- | --- | --- |
| `docs/PRODUCT_SCOPE.md` | Target Users, Core Product Capabilities, MVP Scope, Out Of Scope | Resolve MVP persona, tenancy, compliance, message type, group, dashboard, and SDK scope. |
| `docs/NON_FUNCTIONAL_REQUIREMENTS.md` | Reliability, Availability, Security, Logging, Deployment, Backup, Recovery, Quality Gates | Add concrete targets, retention, classification, backup, and recovery requirements. |
| `docs/SUCCESS_METRICS.md` | Reliability and operational metric sections | Replace baseline-only metrics with MVP targets. |
| `docs/RISKS.md` | Legal, operational, security, dependency, and Baileys risks | Align mitigations with accepted guardrails and upgrade policy. |
| `docs/ROADMAP.md` | Phase 0, Phase 5, Phase 7 | Reflect Phase 0.5 decisions and clarified MVP dashboard/security scope. |
| `docs/PROJECT_CONVENTIONS.md` | Folder Convention | Add `docs/DECISIONS.md` as the product decision record. |
| `docs/GLOSSARY.md` | Product terminology | Add terms required by compliance and data classification decisions. |
| `docs/OPEN_QUESTIONS.md` | Full document | Mark OQs as resolved, deferred, or rejected. |

## Phase 0 Readiness Checklist

| Area | Status |
| --- | --- |
| Vision | PASS |
| Product Scope | PASS |
| Target Persona | PASS |
| Tenancy | PASS |
| Compliance | PASS |
| Reliability | PASS |
| Retention | PASS |
| Security Classification | PASS |
| Backup | PASS |
| Upgrade Policy | PASS |

**Phase 0 is ready for Freeze Review.**
