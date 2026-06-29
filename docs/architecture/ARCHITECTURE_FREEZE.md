# OmniWA Architecture Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Decision

**APPROVED**

**Architecture Phase is FROZEN.**

The Architecture Review Board approves OmniWA Phase 1 System Architecture for handoff to Phase 2 - Domain Design.

## Architecture Version

Phase 1 Architecture v1.0.

This version freezes:

- Phase 1.1 Architecture Principles and ADR.
- Phase 1.2 System Context.
- Phase 1.3 Module Architecture and Ownership.
- Phase 1.4 Runtime Architecture and Interaction Flows.

## Reviewer Summary

ARB roles represented:

- Principal Software Architect.
- Principal Backend Engineer.
- DevOps Architect.
- Security Architect.
- Platform Architect.

Review result:

- Critical findings: 0.
- Major findings: 0.
- Minor findings: 0.
- Suggestions: 3.

The ARB found no architecture contradiction that blocks Phase 2.

## Architecture Score

| Area | Score |
| --- | ---: |
| Architecture Style | 9 |
| Dependency | 9 |
| Module Design | 9 |
| Runtime Design | 9 |
| Testability | 9 |
| Security | 9 |
| Scalability | 8 |
| Maintainability | 9 |
| Observability | 9 |
| Documentation | 9 |

## Approved ADR

| ADR | Status | Topic |
| --- | --- | --- |
| ADR-001 | Accepted | Architecture Style |
| ADR-002 | Accepted | Modular Monolith |
| ADR-003 | Accepted | Dependency Rule |
| ADR-004 | Accepted | Layered Architecture |
| ADR-005 | Accepted | Event Driven Strategy |
| ADR-006 | Accepted | Adapter Pattern |
| ADR-007 | Accepted | Provider Abstraction |
| ADR-008 | Accepted | Configuration Strategy |
| ADR-009 | Accepted | Error Handling Strategy |
| ADR-010 | Accepted | Logging Strategy |
| ADR-011 | Accepted | Package Boundary |
| ADR-012 | Accepted | Internal Event Bus |
| ADR-013 | Accepted | Async Job Strategy |
| ADR-014 | Accepted | Transaction Boundary |
| ADR-015 | Accepted | Testability |
| ADR-016 | Accepted | Future Evolution |

## Approved Documents

The following documents are approved as the Phase 1 architecture baseline:

- `docs/architecture/ARCHITECTURE_PRINCIPLES.md`
- `docs/architecture/ARCHITECTURE_STYLE.md`
- `docs/architecture/DEPENDENCY_RULES.md`
- `docs/architecture/SYSTEM_CONTEXT.md`
- `docs/architecture/EXTERNAL_ACTORS.md`
- `docs/architecture/EXTERNAL_DEPENDENCIES.md`
- `docs/architecture/TRUST_BOUNDARIES.md`
- `docs/architecture/CONTEXT_DIAGRAMS.md`
- `docs/architecture/MODULE_ARCHITECTURE.md`
- `docs/architecture/MODULE_RESPONSIBILITIES.md`
- `docs/architecture/MODULE_DEPENDENCY_MATRIX.md`
- `docs/architecture/PACKAGE_BOUNDARIES.md`
- `docs/architecture/COMPONENT_INTERACTIONS.md`
- `docs/architecture/EXTENSION_POINTS.md`
- `docs/architecture/CROSS_CUTTING_CONCERNS.md`
- `docs/architecture/ARCHITECTURE_FITNESS_FUNCTIONS.md`
- `docs/architecture/RUNTIME_ARCHITECTURE.md`
- `docs/architecture/RUNTIME_LIFECYCLE.md`
- `docs/architecture/SEQUENCE_DIAGRAMS.md`
- `docs/architecture/STATE_MACHINES.md`
- `docs/architecture/EVENT_PROPAGATION.md`
- `docs/architecture/FAILURE_HANDLING.md`
- `docs/architecture/ASYNC_PROCESSING.md`
- `docs/architecture/LIFECYCLE_GUARDRAILS.md`
- `docs/architecture/adr/ADR-001-architecture-style.md`
- `docs/architecture/adr/ADR-002-modular-monolith.md`
- `docs/architecture/adr/ADR-003-dependency-rule.md`
- `docs/architecture/adr/ADR-004-layered-architecture.md`
- `docs/architecture/adr/ADR-005-event-driven-strategy.md`
- `docs/architecture/adr/ADR-006-adapter-pattern.md`
- `docs/architecture/adr/ADR-007-provider-abstraction.md`
- `docs/architecture/adr/ADR-008-configuration-strategy.md`
- `docs/architecture/adr/ADR-009-error-handling-strategy.md`
- `docs/architecture/adr/ADR-010-logging-strategy.md`
- `docs/architecture/adr/ADR-011-package-boundary.md`
- `docs/architecture/adr/ADR-012-internal-event-bus.md`
- `docs/architecture/adr/ADR-013-async-job-strategy.md`
- `docs/architecture/adr/ADR-014-transaction-boundary.md`
- `docs/architecture/adr/ADR-015-testability.md`
- `docs/architecture/adr/ADR-016-future-evolution.md`

## Validation Findings

| Category | Count | Result |
| --- | ---: | --- |
| Critical | 0 | None. |
| Major | 0 | None. |
| Minor | 0 | None. |
| Suggestion | 3 | Track in Phase 2 and implementation planning. |

Suggestions:

- Define implementation-time architecture test tooling before source layout is created.
- Create future ADRs for persistence, queue engine, deployment profile, and security implementation once Phase 2 domain model is stable.
- Keep runtime diagrams under review when concrete infrastructure choices are made, especially for worker clustering and provider connection ownership.

## Architecture Constraints

Phase 2 and implementation planning must comply with:

- MVP remains Single Tenant + Multi Instance.
- MVP supports text, image, video, document, and audio only.
- OmniWA remains an API platform with product-enforced guardrails.
- Architecture style remains Modular Monolith with Clean Architecture and Hexagonal Ports and Adapters.
- Dependency direction remains `Interface -> Application -> Domain`, with Infrastructure implementing ports.
- Business logic must not depend directly on Baileys.
- Provider behavior must stay behind provider adapter boundaries and MessagingProvider-style ports.
- Queue, persistence, webhook transport, configuration, observability, and secret handling must stay behind ports/adapters.
- Webhook delivery must be asynchronous, retry-visible, and observable.
- Accepted work must never silently disappear.
- Runtime components must enter product behavior through Application use cases or approved ports.
- Provider Runtime must not call Application use-case orchestration directly; it reports translated provider signals through Application-owned provider event ports.
- Domain must not publish directly to EventBus, Queue, Log, Webhook, Provider, or external systems.

## Non Negotiable Rules

- Do not introduce multi-tenant MVP scope.
- Do not introduce stable SDK package commitments in MVP.
- Do not introduce broadcast, campaign, audience-management, or marketing-automation workflows in MVP.
- Do not introduce group administration or group messaging as MVP send capabilities.
- Do not introduce unsupported advanced message types as product commitments.
- Do not claim OmniWA guarantees upstream WhatsApp delivery.
- Do not bypass WhatsApp, Meta, device, account, or policy restrictions.
- Do not log Secret data.
- Do not log raw Confidential message bodies, media payloads, webhook payloads, phone numbers, or JIDs in normal logs.
- Do not retain message or media bodies by default after processing.
- Do not let configuration silently disable required guardrails.
- Do not use provider-native payloads as domain model inputs.
- Do not allow Worker Runtime to call Interface/API layer.
- Do not allow Provider Runtime to emit external webhook events directly.
- Do not allow fire-and-forget accepted async work.

## Deferred Decisions

The following decisions remain intentionally deferred:

- Concrete REST/API design.
- OpenAPI contract.
- Database technology and schema.
- Persistence strategy for recoverable state.
- Queue engine and detailed worker implementation.
- Concrete webhook transport authentication/signing.
- Concrete secret provider implementation.
- Concrete observability stack.
- Concrete deployment profile and Docker/runtime packaging.
- Prisma or ORM selection.
- Baileys implementation details.
- Multi-node runtime coordination.
- Horizontal scaling mechanics.
- Cluster worker strategy.
- Multi-region runtime model.
- Multi-tenant product model.
- WhatsApp Cloud API provider support.
- Telegram, Messenger, and Instagram provider support.

## Future ADR Required

Future ADRs must be created before implementation depends on:

- Domain model and aggregate boundaries after Phase 2.
- Persistence technology and transaction mechanics.
- Data ownership to persistence mapping.
- Queue engine and retry policy implementation.
- Worker concurrency, locking, leasing, and idempotency implementation.
- Webhook transport, signing, timeout, retry, and replay policy.
- Provider adapter implementation details and Baileys upgrade/runbook strategy.
- Security implementation for authentication, authorization, secrets, and audit.
- Observability tooling and telemetry export strategy.
- Backup, restore, and recovery implementation.
- Deployment topology and local/production runtime profile.
- Horizontal scaling, clustering, sharding, or multi-region operation.
- Multi-tenancy.
- New providers or non-WhatsApp channels.

## Approval Summary

The Architecture Review Board approves Phase 1 freeze because:

- Architecture principles are consistent with frozen Phase 0 product decisions.
- ADRs are accepted and mutually consistent.
- System context defines actors, dependencies, trust boundaries, and responsibility boundaries clearly.
- Module architecture defines ownership, data ownership, dependency matrix, package boundaries, extension points, and fitness functions.
- Runtime architecture defines lifecycle, sequence, state machines, event propagation, async processing, failure handling, guardrails, constraints, invariants, and runtime metrics.
- Security rules are consistent across trust boundaries, logging, secret handling, session handling, provider boundary, and event handling.
- Observability requirements cover logging, metrics, tracing, correlation, error classification, health, audit, and runtime failure signals.
- Testability is supported through ports, adapters, mocks/fakes, test boundaries, and architecture fitness functions.
- Future evolution is explicitly gated by ADR/product decisions where scope changes.

## Phase 1 Readiness

| Area | Status |
| --- | --- |
| Architecture Principles | PASS |
| System Context | PASS |
| Module Architecture | PASS |
| Runtime Architecture | PASS |
| Security | PASS |
| Observability | PASS |
| Testability | PASS |
| Maintainability | PASS |
| Scalability | PASS |
| Fitness Functions | PASS |

**Architecture Phase is FROZEN.**

**Project is ready for Phase 2 - Domain Design.**
