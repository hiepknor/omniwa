# OmniWA System Context

## Purpose

This document defines OmniWA at C4 System Context level.

It identifies what OmniWA is, who uses it, which external systems it communicates with, where responsibility boundaries sit, and which constraints Phase 1.3 Module Architecture must obey.

This document does not design APIs, endpoints, database schemas, modules, Docker, workers, Prisma, source code, or Baileys internals.

## System Definition

OmniWA is a Single Tenant + Multi Instance WhatsApp API platform for developer-led SaaS builders and internal technical teams.

OmniWA provides a production-minded product boundary over WhatsApp connectivity through a provider adapter, initially WhiskeySockets/Baileys. It manages product-level concepts such as instances, sessions, supported messages, webhooks, queue-visible work, guardrail states, logs, and operator visibility.

## What OmniWA Is

OmniWA is:

- A platform for operating multiple WhatsApp instances inside one tenant boundary.
- A stable product surface over Baileys.
- An API platform with product-enforced guardrails.
- A system that makes messaging, webhook delivery, reconnects, provider failures, and async work observable.
- A system that treats Secret and Confidential data as protected by default.

## What OmniWA Is Not

OmniWA is not:

- A replacement for Meta's official WhatsApp Business Platform.
- A spam, scraping, policy-bypass, or deceptive automation tool.
- A campaign, broadcast, audience-management, or marketing automation platform.
- A general CRM.
- A general workflow automation product.
- A multi-tenant platform in MVP.
- A system that guarantees upstream WhatsApp delivery.
- A system that hides all provider or WhatsApp policy limitations.

## Core Responsibility

OmniWA owns:

- Product-level WhatsApp instance lifecycle.
- Product-level session visibility and action-required state.
- Supported MVP message workflows: text, image, video, document, and audio.
- Product-level provider abstraction through a messaging provider boundary.
- Webhook event preparation and delivery visibility.
- Async work visibility for pending, retried, failed, dead-letter, completed, and action-required states.
- Product-enforced guardrails for spam, broadcast, rate-limit, and abuse-risk states.
- Logging, correlation, redaction, and sensitive data handling inside OmniWA boundaries.
- Backup and recovery expectations for OmniWA-owned recoverable state.

## External Responsibility

External actors and systems own:

- WhatsApp account standing, account bans, and device/account policy conditions.
- End-user consent and lawful basis for messaging.
- External webhook endpoint uptime and correctness.
- External CRM or automation business workflows.
- Network availability outside OmniWA-controlled infrastructure.
- Provider behavior and upstream WhatsApp protocol changes.
- Future official Cloud API behavior where selected through a separate product and architecture decision.

## Boundary Of Responsibility

OmniWA responsibility begins when an authenticated actor or trusted provider event enters an OmniWA boundary and ends when OmniWA has:

- Accepted or rejected the request according to product policy.
- Translated provider behavior into product concepts.
- Recorded observable state for accepted work.
- Attempted provider or webhook operations through adapters.
- Classified failures into product-level error categories.

OmniWA does not own final delivery inside WhatsApp, downstream webhook processing, external CRM state, or user consent collection outside OmniWA.

## System Context Summary

| Element | Context Position |
| --- | --- |
| Tenant model | Single Tenant + Multi Instance. |
| Primary persona | Developer-led SaaS builder. |
| Secondary persona | Internal technical team. |
| Provider posture | Baileys behind provider adapter; no business logic depends directly on Baileys. |
| Guardrail posture | Product-enforced MVP guardrails. |
| Message scope | Text, image, video, document, audio. |
| Deferred scope | Multi-tenancy, stable SDK packages, group messaging/admin, broadcast/campaign, advanced message types. |

## Responsibility Matrix

| Responsibility | Owned by OmniWA | Owned by User | Owned by Provider | Notes |
| --- | --- | --- | --- | --- |
| API authentication boundary | Yes | User manages credentials safely | No | Concrete API design is out of scope; authenticated boundary is required. |
| Admin/operator authorization | Yes | User assigns trusted operators | No | Admin actions cross a higher-trust boundary. |
| Message delivery attempt | Yes | User initiates valid workflows | Provider carries provider-side delivery | OmniWA owns attempt and state visibility, not final WhatsApp delivery. |
| WhatsApp account health | No | Yes | Provider/WhatsApp enforces policy | OmniWA surfaces action-required and failure categories. |
| Spam behavior | Guardrails only | Yes | Provider may enforce policy | OmniWA blocks MVP broadcast/campaign/bulk import workflows. |
| Webhook endpoint uptime | No | Yes | No | OmniWA owns retry and terminal state visibility. |
| Session backup | Yes for OmniWA-owned recoverable state | User protects deployment and backup access | No | Session data is Secret data. |
| Provider breaking changes | Mitigate through pinning/regression | No | Provider/upstream changes behavior | Baileys exact-version pinning and rollback are required. |
| Message and media body retention | Yes inside OmniWA defaults | User controls downstream copies | Provider may retain under its own behavior | OmniWA does not retain bodies by default after processing. |
| External CRM state | No | Yes | No | OmniWA may deliver events, but CRM state remains external. |
| Monitoring interpretation | Yes for OmniWA signals | User operates response process | No | Monitoring system is an external consumer of observability data. |

## Context-Level Risks

| Risk | Impact | Likelihood | Mitigation | Phase Affected |
| --- | --- | --- | --- | --- |
| Provider instability | Broken sessions, reconnect failures, event format drift | High | Provider adapter boundary, Baileys pinning, regression validation, error translation | Phase 1.3+ |
| WhatsApp account ban or restriction | Instance cannot send or receive normally | Medium | Guardrail states, action-required status, no bypass claims, operator visibility | Phase 1.3+ |
| Webhook receiver downtime | Delayed or failed downstream workflows | High | Async webhook delivery, retries, terminal failed/dead-letter visibility, idempotency guidance | Phase 1.3+ |
| Public API abuse | Spam, account risk, resource exhaustion | Medium | Authentication boundary, validation, rate-limit and abuse-risk states, no broadcast/campaign MVP scope | Phase 1.3+ |
| Sensitive data leakage | Privacy/security incident | Medium | Data classification, redaction, Secret never logged, diagnostic capture controls | Phase 1.3+ |
| Data service unavailability | State, queue, audit, or recovery degradation | Medium | Health visibility, recovery procedure, backup expectations, terminal states | Phase 1.3+ |
| Queue service unavailability | Accepted async work may stall | Medium | Async job state, retry/dead-letter model, no silent drops | Phase 1.3+ |
| External policy changes | Product workflows may become unsafe or invalid | Medium | Risk review cadence, official policy baseline review, guardrail updates through ADR/product decision | All phases |
| Monitoring blind spots | Longer incidents and weaker recovery | Medium | Observability boundary, correlation IDs, structured logs, health-state requirements | Phase 1.3+ |

## Architecture Constraints For Phase 1.3

Phase 1.3 Module Architecture must follow these constraints:

- API/interface layer must not call Baileys directly.
- Provider interaction must go through a MessagingProvider-style port.
- Baileys-specific behavior must stay inside provider adapter boundaries.
- External provider failures must be translated into External Provider Error categories.
- Webhook delivery must be asynchronous and observable.
- Accepted work must never silently disappear.
- Public API and admin surfaces must have authentication boundaries.
- Admin/operator interactions must be separated from public client interactions.
- Session material is Secret data and must never be logged.
- Confidential payloads must be redacted from normal logs.
- Message and media bodies are not retained by default after processing.
- Queue behavior must expose pending, retrying, failed, dead-letter, completed, and action-required states.
- Data storage and queue boundaries must be treated as internal trusted services, not public surfaces.
- Monitoring and logging sinks must not receive raw Secret or unredacted Confidential data.
- External CRM, automation platform, and webhook receivers must not be trusted as part of OmniWA runtime.
- Future Cloud API, Telegram, Messenger, or Instagram support must go through provider/product decisions and adapter boundaries.

## Phase 1.2 Readiness Checklist

| Item | Status |
| --- | --- |
| Context defined | PASS |
| Actors defined | PASS |
| External dependencies defined | PASS |
| Trust boundaries defined | PASS |
| Diagrams created | PASS |
| Responsibility matrix completed | PASS |
| Constraints for Phase 1.3 defined | PASS |

**Phase 1.2 is ready for review.**
