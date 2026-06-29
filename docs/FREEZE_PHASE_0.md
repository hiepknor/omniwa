# OmniWA Phase 0 Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Status

**Phase 0 = FROZEN**

## Freeze Decision

APPROVED.

The Architecture Review Board confirms that OmniWA Phase 0 Product Definition is complete enough to proceed to Phase 1 - System Architecture.

## Reviewer Summary

ARB roles represented in this review:

- Principal Software Architect.
- Principal Product Manager.
- Senior Backend Engineer.
- DevOps Architect.
- Security Architect.

Review result:

- Product Readiness: 9/10.
- Documentation Quality: 9/10.
- Architecture Readiness: 8/10.

No critical open questions remain. Phase 0.5 decisions resolve the blockers identified in the previous ARB review.

## Approved Documents

The following documents are approved as the frozen Phase 0 baseline:

- `docs/VISION.md`
- `docs/PRODUCT_SCOPE.md`
- `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
- `docs/ROADMAP.md`
- `docs/PROJECT_CONVENTIONS.md`
- `docs/GLOSSARY.md`
- `docs/RISKS.md`
- `docs/SUCCESS_METRICS.md`
- `docs/OPEN_QUESTIONS.md`
- `docs/DECISIONS.md`

## Final Decisions

The following decisions are approved and must be treated as Phase 1 constraints:

| Decision | Final Position |
| --- | --- |
| MVP Persona | Primary: developer-led SaaS builder. Secondary: internal technical team. |
| Tenancy | Single Tenant + Multi Instance for MVP. |
| Compliance | API platform with MVP product-enforced guardrails. |
| Message Types | MVP supports text, image, video, document, and audio. |
| Reliability | Explicit MVP targets are accepted for availability, latency, webhooks, reconnect, queue success, deployment time, and MTTR. |
| Retention | Default retention windows are accepted for audit, webhook, message, queue, media, session, and backup data. |
| Sensitive Data | Public, Internal, Confidential, and Secret data classes are accepted. |
| Backup And Recovery | Encrypted daily backup, 24h RPO, 4h RTO, and documented recovery procedure are accepted. |
| Baileys Upgrade Policy | Exact version pinning, regression validation, and rollback are required. |

## Remaining Deferred Items

| Item | Status | Constraint |
| --- | --- | --- |
| Stable SDK packages | Deferred | MVP may include documentation and examples only. Stable SDK package commitments are not part of the MVP. |
| Multi-tenant product model | Deferred | MVP remains Single Tenant + Multi Instance. Multi-tenancy requires a future product decision and architecture review. |
| Group product capabilities | Deferred | MVP may surface unsupported incoming events where useful, but group administration and group messaging are not MVP send capabilities. |
| Advanced message types | Deferred | Sticker, location, contact card, reaction, poll, interactive, status, newsletter, commerce, campaign, and broadcast messages are out of MVP scope. |

## Assumptions

- OmniWA is built on WhiskeySockets/Baileys.
- OmniWA is not a replacement for Meta's official WhatsApp Business Platform.
- OmniWA does not bypass WhatsApp, Meta, account, device, or policy restrictions.
- MVP users need production-minded integration, observability, and responsible usage boundaries more than broad feature coverage.
- Availability and delivery metrics separate OmniWA-controlled behavior from upstream WhatsApp, device, account, customer network, and downstream endpoint behavior.
- Legal compliance remains the user's responsibility; OmniWA provides product guardrails but does not provide legal advice.

## Constraints

Phase 1 architecture must comply with:

- MVP persona and tenancy decisions in `docs/DECISIONS.md`.
- MVP scope and out-of-scope boundaries in `docs/PRODUCT_SCOPE.md`.
- Reliability, retention, security, backup, and recovery requirements in `docs/NON_FUNCTIONAL_REQUIREMENTS.md`.
- Success metrics in `docs/SUCCESS_METRICS.md`.
- Risk mitigations and Baileys upgrade policy in `docs/RISKS.md` and `docs/DECISIONS.md`.
- Terminology in `docs/GLOSSARY.md`.

Phase 1 must not introduce:

- Multi-tenant MVP scope.
- Stable SDK package commitments.
- Broadcast, campaign, audience-management, or marketing-automation workflows.
- Group administration or group messaging as MVP send capabilities.
- Unsupported MVP message types as product commitments.
- Claims that OmniWA guarantees upstream WhatsApp delivery or bypasses policy limits.

## Architecture Preconditions

Before detailed implementation planning, Phase 1 must produce architecture decisions that address:

- System context.
- Core domain boundaries.
- Runtime component model.
- Data ownership model.
- Integration boundaries.
- Security model.
- Reliability and observability model.
- Backup and recovery model.
- Baileys upgrade and compatibility model.

These are architecture deliverables for Phase 1. They are not decided in this freeze document.

## Approval Summary

The ARB approves Phase 0 freeze because:

- Vision and mission are clear and stable.
- Product scope is narrowed for MVP.
- Out-of-scope boundaries are explicit.
- Critical decisions are accepted in `docs/DECISIONS.md`.
- Open questions show `Critical Open = 0`.
- Reliability, retention, security, backup, and upgrade policy are concrete enough for architecture work.
- No product-definition ambiguity remains that blocks Phase 1.

**Phase 0 = FROZEN**
