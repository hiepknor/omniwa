# OmniWA Phase 1 Handoff

## Purpose

This document hands the frozen Phase 0 Product Definition to Phase 1 - System Architecture.

It does not design the architecture. It identifies the required inputs, constraints, and architecture decisions that Phase 1 must produce.

## Phase 1 Goal

Design the technical architecture that can support the approved OmniWA Product Definition without expanding MVP scope.

Phase 1 must turn the frozen product decisions into an architecture that is reviewable, testable, secure, observable, and suitable for MVP implementation planning.

## Required Reading Before Architecture Design

Read these documents before creating any Phase 1 architecture deliverable:

1. `docs/FREEZE_PHASE_0.md`
2. `docs/DECISIONS.md`
3. `docs/VISION.md`
4. `docs/PRODUCT_SCOPE.md`
5. `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
6. `docs/SUCCESS_METRICS.md`
7. `docs/RISKS.md`
8. `docs/OPEN_QUESTIONS.md`
9. `docs/GLOSSARY.md`
10. `docs/ROADMAP.md`
11. `docs/PROJECT_CONVENTIONS.md`

## Architecture Decision Backlog

Phase 1 should create ADRs for the following decisions. Each ADR must include context, decision, alternatives considered, trade-offs, consequences, and links back to Phase 0 constraints.

| ADR | Required Decision |
| --- | --- |
| ADR-001 | System context and external boundary. |
| ADR-002 | Core product domain boundaries. |
| ADR-003 | Runtime component model. |
| ADR-004 | Data ownership model. |
| ADR-005 | Persistence strategy for OmniWA-owned recoverable state. |
| ADR-006 | Queue and background work strategy. |
| ADR-007 | Webhook delivery and retry strategy. |
| ADR-008 | Instance lifecycle and reconnect strategy. |
| ADR-009 | Media handling strategy for supported MVP media types. |
| ADR-010 | Security model for Public, Internal, Confidential, and Secret data. |
| ADR-011 | Logging, redaction, audit, and diagnostic capture strategy. |
| ADR-012 | Observability and health-state strategy. |
| ADR-013 | Backup, restore, RPO, and RTO strategy. |
| ADR-014 | Baileys version pinning, upgrade, regression, and rollback strategy. |
| ADR-015 | Deployment profile for Single Tenant + Multi Instance MVP. |
| ADR-016 | Product guardrail enforcement strategy for spam, broadcast, rate-limit, and abuse-risk states. |

The ADR backlog is a required decision list, not a preselected architecture.

## Architecture Constraints

Phase 1 architecture must satisfy:

- MVP persona: developer-led SaaS builder, with internal technical team as secondary.
- MVP tenancy: Single Tenant + Multi Instance.
- MVP supported message types: text, image, video, document, and audio.
- MVP compliance posture: API platform with product-enforced guardrails.
- MVP dashboard scope: instance health, QR pairing state, recent message/event inspection, webhook delivery status, and queue/failure visibility.
- MVP reliability targets from `docs/DECISIONS.md` DEC-005 and `docs/NON_FUNCTIONAL_REQUIREMENTS.md`.
- Retention defaults from `docs/DECISIONS.md` DEC-006.
- Data classification and handling rules from `docs/DECISIONS.md` DEC-007.
- Backup and recovery targets from `docs/DECISIONS.md` DEC-008.
- Baileys upgrade policy from `docs/DECISIONS.md` DEC-009.

## Non-Negotiable Product Boundaries

The following must not change during Phase 1 without a new approved ADR and, where product scope changes, an updated product decision:

- OmniWA is not a spam, policy-bypass, scraping, or deceptive automation tool.
- OmniWA does not replace Meta's official WhatsApp Business Platform.
- MVP is Single Tenant + Multi Instance.
- MVP does not include multi-tenant isolation.
- MVP does not include stable SDK package commitments.
- MVP does not include campaign, broadcast, audience-management, or marketing-automation workflows.
- MVP does not include group administration or group messaging as send capabilities.
- MVP does not include unsupported advanced message types as product commitments.
- Secret data must never be logged.
- Confidential message bodies, media payloads, webhook payloads, phone numbers, and JIDs must be redacted from normal logs.
- Message and media bodies are not retained by default after processing.
- Baileys must be exact-version pinned for MVP and upgraded only through regression validation with rollback available.

## Architecture Review Expectations

Phase 1 is complete only when:

- Required ADRs are written and reviewed.
- Architecture explicitly traces back to frozen Phase 0 decisions.
- Architecture explains how it meets reliability, security, retention, backup, recovery, and observability targets.
- Architecture identifies risks introduced by the selected technical approach.
- Implementation planning can begin without re-litigating Phase 0 product scope.

## Handoff Status

Phase 0 is frozen and handed off to Phase 1.
