# OmniWA Domain Overview

## Purpose

This document defines OmniWA's strategic domain model for Phase 2.1.

It identifies domain areas, classifies them as Core, Supporting, or Generic, and establishes the bounded-context direction for later detailed domain design.

This document does not define REST APIs, OpenAPI contracts, database schema, Prisma models, repository implementations, source code, aggregates, entities, or event schemas.

## Frozen Inputs

The domain model must comply with:

- Phase 0 Product Definition freeze.
- Phase 1 Architecture freeze.
- MVP tenancy: Single Tenant + Multi Instance.
- MVP primary persona: developer-led SaaS builder.
- MVP secondary persona: internal technical team.
- MVP compliance posture: API platform with product-enforced guardrails.
- MVP supported message types: text, image, video, document, and audio.
- Architecture style: Modular Monolith with Clean Architecture and Hexagonal Ports and Adapters.
- Dependency direction: Interface -> Application -> Domain; Infrastructure implements ports.
- Provider isolation: domain policy must not depend on Baileys or provider-native payloads.
- Secret and Confidential handling: no Secret logging and no raw Confidential logging.
- Retention posture: no default message or media body retention after processing.

## Domain Classification

| Domain Area | Classification | Bounded Contexts | Reason |
| --- | --- | --- | --- |
| Instance Operations | Core Domain | Instance, Session | The product's primary unit is a managed WhatsApp instance with explicit connection, pairing, reconnect, and action-required state. This is a major differentiator over raw Baileys usage. |
| Message Delivery | Core Domain | Messaging, Webhook Delivery | OmniWA's main value is reliable product-level messaging workflow visibility and integration event delivery for SaaS builders. |
| Responsible Usage | Core Domain | Guardrails | Product-enforced guardrails are a frozen MVP decision and affect message acceptance, abuse visibility, and policy-safe operation. |
| Media Handling | Supporting Domain | Media | Media supports messaging but is scoped to MVP categories and metadata/retention rules rather than being the product's primary differentiator. |
| Provider Integration | Supporting Domain | Provider Integration | Provider translation is critical but exists to protect the product model from Baileys and future provider differences. It must not own business policy. |
| Async Operations | Supporting Domain | Operations | Queue-visible work, retry, dead-letter, and recovery visibility support reliability requirements but do not define core product behavior by themselves. |
| Platform Control | Supporting Domain | Security and Access, Audit, Health | Access decisions, audit evidence, and health classification support safe operation for the target personas. |
| Configuration and Telemetry | Generic Domain | Configuration, Observability | Configuration validation and sanitized telemetry are common platform capabilities. They must remain product-aware enough to enforce constraints, but not become business owners. |

## Core Domain

The Core Domain is the smallest set of behavior that makes OmniWA valuable as a production-minded WhatsApp API platform instead of a thin Baileys wrapper.

Core contexts:

- Instance Context.
- Session Context.
- Messaging Context.
- Webhook Delivery Context.
- Guardrails Context.

These contexts own the product language around lifecycle, accepted work, supported message scope, responsible usage, and integration delivery visibility.

## Supporting Domains

Supporting domains enable the core product but should remain replaceable or evolvable without rewriting the core business policy.

Supporting contexts:

- Media Context.
- Provider Integration Context.
- Operations Context.
- Security and Access Context.
- Audit Context.
- Health Context.

The main trade-off is that some supporting contexts, such as Provider Integration and Operations, are technically essential. They are still classified as supporting because their purpose is to execute and protect core decisions, not define product policy independently.

## Generic Domains

Generic domains provide reusable platform capabilities that should avoid product-specific business ownership.

Generic contexts:

- Configuration Context.
- Observability Context.

They may enforce frozen product constraints, such as preventing guardrail bypass and protecting sensitive data, but they do not decide message, session, or webhook business outcomes.

## Strategic Bounded Contexts

Phase 2.1 defines these bounded contexts:

| Context | Classification | Primary Role |
| --- | --- | --- |
| Instance | Core | Product lifecycle and operator-visible state of each WhatsApp instance. |
| Session | Core | Product session lifecycle, pairing state, revocation/expiry state, and Secret-sensitive session policy. |
| Messaging | Core | Supported inbound/outbound message lifecycle and delivery visibility. |
| Webhook Delivery | Core | External integration delivery lifecycle, retry visibility, and dead-letter visibility. |
| Guardrails | Core | Product-enforced anti-spam, anti-broadcast, rate-limit, and abuse-risk outcomes. |
| Media | Supporting | MVP media metadata, validation policy, processing state, and retention policy. |
| Provider Integration | Supporting | Anti-corruption layer between product concepts and Baileys/future providers. |
| Operations | Supporting | Async work lifecycle, retry state, dead-letter state, and scheduler/recovery signals. |
| Security and Access | Supporting | Authentication/authorization concepts and privileged action control. |
| Audit | Supporting | Secret-safe operational and security evidence. |
| Health | Supporting | Product and dependency health classification for operators. |
| Configuration | Generic | Validated configuration concepts and constraint-safe configuration state. |
| Observability | Generic | Sanitized logs, metrics, traces, correlation vocabulary, and error classification projections. |

## Design Assumptions

- The first implementation is one deployable modular monolith, not distributed services.
- Context boundaries are conceptual and package-aligned, not network boundaries.
- Application orchestration coordinates context interaction and event publication timing.
- Domain contexts create product facts, but do not publish directly to queues, webhooks, logs, provider adapters, or external systems.
- Provider uncertainty is represented as product-level states and error categories, not provider-native values.
- Event names in Phase 2.1 are strategic signals only; they are not event classes, schemas, topics, or transport contracts.

## Strategic Trade-offs

| Decision | Benefit | Trade-off | Future Impact |
| --- | --- | --- | --- |
| Split Instance and Session contexts. | Clarifies that instance lifecycle is not the same as Secret-backed authentication/session state. | Requires explicit coordination between two tightly related contexts. | Multi-device, re-pairing, and future provider support can evolve without mixing session secrets with instance operations. |
| Keep Provider Integration outside core policy. | Protects domain behavior from Baileys churn and future providers. | Requires translation and anti-corruption mapping. | WhatsApp Cloud API or other providers can be evaluated through product contracts. |
| Treat Webhook Delivery as core. | Integration reliability is a primary product promise for SaaS builders. | More lifecycle states must be modeled than a simple callback system. | Future analytics or billing can consume stable delivery facts without owning webhook mechanics. |
| Treat Observability as generic. | Prevents telemetry from becoming a hidden business database or raw payload sink. | Product contexts must expose sanitized state intentionally. | Observability stack can change without domain model changes. |

## Out Of Scope For Phase 2.1

- REST endpoint design.
- OpenAPI contract design.
- Database schema or ORM design.
- Repository implementation.
- Queue engine selection.
- Worker implementation.
- Provider/Baileys implementation.
- Aggregate design.
- Entity design.
- Value object design.
- Domain event schema design.
- Docker or deployment design.

## Phase 2.1 Checklist

| Item | Status |
| --- | --- |
| Core domain identified | PASS |
| Supporting domains identified | PASS |
| Bounded contexts defined | PASS |
| Domain map completed | PASS |
| Ubiquitous language completed | PASS |
| Context relationships defined | PASS |
| Domain ownership defined | PASS |
| Constraints defined | PASS |

**Phase 2.1 is ready for review.**
