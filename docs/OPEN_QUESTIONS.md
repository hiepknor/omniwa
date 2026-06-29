# OmniWA Open Questions

This document tracks the disposition of Phase 0 open questions after Phase 0.5 Product Decision Resolution.

## Status Summary

| Status | Count |
| --- | ---: |
| Resolved | 14 |
| Deferred | 1 |
| Rejected | 0 |
| Critical Open | 0 |

## Open Questions Disposition

| ID | Area | Previous Question | Status | Resolution |
| --- | --- | --- | --- | --- |
| OQ-001 | Product Positioning | Should OmniWA be positioned primarily as an internal platform, open-source project, commercial product, or developer tool? | Resolved | OmniWA is positioned as a developer-first, production-minded API platform for developer-led SaaS builders and internal technical teams. |
| OQ-002 | MVP Users | Which user group is the first MVP target? | Resolved | Primary persona: developer-led SaaS builder. Secondary persona: internal technical team. See `docs/DECISIONS.md` DEC-001. |
| OQ-003 | Multi-Tenancy | Is tenant isolation part of MVP, or only a later phase? | Resolved | MVP uses Single Tenant + Multi Instance. Multi-tenant isolation is not MVP scope. See `docs/DECISIONS.md` DEC-002. |
| OQ-004 | Compliance Posture | What level of responsible-use enforcement should OmniWA include in MVP? | Resolved | OmniWA is an API platform with MVP product-enforced guardrails. See `docs/DECISIONS.md` DEC-003. |
| OQ-005 | Official API Relationship | When should OmniWA recommend Meta's official WhatsApp Business Platform instead of OmniWA? | Resolved | Recommend the official platform when official compliance, templates, business-initiated messaging, or Meta-supported guarantees are required. |
| OQ-006 | Supported Message Types | Which message types are required for MVP? | Resolved | MVP supports text, image, video, document, and audio. See `docs/DECISIONS.md` DEC-004. |
| OQ-007 | Group Features | Are group capabilities required in MVP or deferred? | Resolved | Group product capabilities are deferred from MVP except safe visibility of unsupported incoming events where useful. |
| OQ-008 | Dashboard Scope | What operator tasks must the MVP dashboard support? | Resolved | MVP dashboard supports instance health, QR pairing state, recent message/event inspection, webhook delivery status, and queue/failure visibility. |
| OQ-009 | SDK Priority | Should SDK work be part of MVP or follow after core platform stabilization? | Deferred | Stable SDK packages are deferred until after core platform behavior is proven. MVP may include documentation and examples only. |
| OQ-010 | Reliability Target | What is the minimum acceptable reliability bar for MVP release? | Resolved | Reliability targets are defined in `docs/DECISIONS.md` DEC-005 and reflected in NFR and Success Metrics. |
| OQ-011 | Data Retention | How long should messages, media metadata, logs, and events be retained by default? | Resolved | Retention defaults are defined in `docs/DECISIONS.md` DEC-006 and reflected in NFR. |
| OQ-012 | Sensitive Data | Which payload fields are considered sensitive and must be redacted by default? | Resolved | Data classes and handling rules are defined in `docs/DECISIONS.md` DEC-007 and reflected in NFR. |
| OQ-013 | Backup And Recovery | Which state must be backed up for MVP production use? | Resolved | Backup and recovery targets are defined in `docs/DECISIONS.md` DEC-008 and reflected in NFR. |
| OQ-014 | Baileys Upgrade Policy | How aggressively should OmniWA track Baileys releases? | Resolved | Baileys upgrade policy is defined in `docs/DECISIONS.md` DEC-009 and reflected in Risks. |
| OQ-015 | Success Metric Ownership | Who owns each success metric and phase gate review? | Resolved | Role ownership: Product owns product success metrics, Backend owns platform behavior metrics, DevOps owns deployment/recovery metrics, Security owns data handling and abuse guardrails. Named owners can be assigned when the team roster exists. |

## Decision Rule

No Critical Open Questions remain after Phase 0.5.

Phase 0 may return to Freeze Review. `docs/FREEZE_PHASE_0.md` must only be created after the next Review & Freeze step returns `APPROVED` or `APPROVED WITH MINOR CHANGES`.
