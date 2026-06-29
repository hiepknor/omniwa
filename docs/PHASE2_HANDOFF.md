# OmniWA Phase 2 Handoff

## Purpose

This document hands the frozen Phase 1 Architecture to Phase 2 - Domain Design.

It does not design APIs, databases, source code, Prisma, Docker, queue implementation, provider implementation, or detailed domain models.

## Phase 2 Goal

Design OmniWA's domain model so implementation planning can begin without violating the frozen product and architecture constraints.

Phase 2 should define:

- Domain language.
- Bounded contexts.
- Aggregate candidates and ownership.
- Entities and value objects.
- Domain events.
- Domain errors.
- Invariants.
- State transitions.
- Domain services where genuinely needed.
- Domain test strategy.

Phase 2 must not re-open Phase 0 product scope or Phase 1 architecture decisions unless a new ADR and product decision are approved.

## Required Reading

Read these documents before Phase 2 domain design:

1. `docs/FREEZE_PHASE_0.md`
2. `docs/DECISIONS.md`
3. `docs/PRODUCT_SCOPE.md`
4. `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
5. `docs/SUCCESS_METRICS.md`
6. `docs/GLOSSARY.md`
7. `docs/architecture/ARCHITECTURE_FREEZE.md`
8. `docs/architecture/ARCHITECTURE_PRINCIPLES.md`
9. `docs/architecture/ARCHITECTURE_STYLE.md`
10. `docs/architecture/DEPENDENCY_RULES.md`
11. `docs/architecture/MODULE_ARCHITECTURE.md`
12. `docs/architecture/MODULE_RESPONSIBILITIES.md`
13. `docs/architecture/MODULE_DEPENDENCY_MATRIX.md`
14. `docs/architecture/PACKAGE_BOUNDARIES.md`
15. `docs/architecture/EXTENSION_POINTS.md`
16. `docs/architecture/RUNTIME_ARCHITECTURE.md`
17. `docs/architecture/RUNTIME_LIFECYCLE.md`
18. `docs/architecture/STATE_MACHINES.md`
19. `docs/architecture/EVENT_PROPAGATION.md`
20. `docs/architecture/FAILURE_HANDLING.md`
21. `docs/architecture/ASYNC_PROCESSING.md`
22. `docs/architecture/LIFECYCLE_GUARDRAILS.md`
23. `docs/architecture/ARCHITECTURE_FITNESS_FUNCTIONS.md`
24. `docs/architecture/adr/`

## Domain Design Principles

Phase 2 domain design must follow:

- Use product language from `docs/GLOSSARY.md`.
- Model OmniWA product concepts, not Baileys-native concepts.
- Keep domain policy independent from Interface, Infrastructure, provider, queue, persistence, logging, telemetry, and framework concerns.
- Keep domain events as facts; Application controls publication timing.
- Keep Secret and Confidential handling rules visible in domain decisions.
- Model lifecycle states explicitly where they affect reliability, observability, or operator action.
- Prefer small aggregates with clear invariants over large shared objects.
- Avoid speculative domain abstractions for future providers unless the frozen architecture requires an extension point.
- Treat provider uncertainty honestly through classified product states.
- Preserve MVP scope: text, image, video, document, and audio only.

## Domain Constraints

Domain design must comply with:

- Domain package depends only on shared/policy-neutral primitives.
- Domain must not import Application, Interface, Infrastructure, Baileys, queue, persistence, logging, telemetry, configuration, or transport concerns.
- Domain must not open, commit, or roll back transactions.
- Domain must not publish directly to EventBus, Queue, Webhook, Log, Provider, or external systems.
- Domain must not use provider-native payloads as entity/value object inputs.
- Domain must not contain REST/API response concepts.
- Domain must not contain database schema or ORM concepts.
- Domain must not contain queue engine or worker implementation concepts.
- Domain must not log Secret or Confidential payloads.
- Domain must expose enough state and events for accepted work to be observable.

## Aggregate Candidates To Design

The following are Phase 2 aggregate candidates. They are not final aggregate designs.

| Candidate | Expected Ownership Area | Reason To Design |
| --- | --- | --- |
| Instance | Instance lifecycle and health state. | Primary product unit for multi-instance operation. |
| Session | Session lifecycle and action-required state. | Secret-backed connection/auth state must be protected and explicit. |
| Message | Supported message lifecycle and delivery visibility. | Core product workflow and reliability surface. |
| MediaAsset | Supported media metadata and retention policy. | Media has separate validation, processing, and cleanup concerns. |
| WebhookDelivery | Integration event delivery lifecycle. | Webhook reliability, retry, and dead-letter state need explicit ownership. |
| WorkerJob | Queue-visible async work lifecycle. | Accepted work must not silently disappear. |
| GuardrailDecision | Rate-limit, abuse-risk, spam/broadcast prevention outcome. | Product-enforced guardrails are MVP constraints. |
| AuditRecord | Security-sensitive and operational evidence. | Audit retention and Secret-safe evidence are required. |
| HealthStatus | Product/dependency health classification. | Operators need clear platform vs provider/downstream state. |
| ConfigurationSnapshot | Validated runtime configuration concept. | Configuration must be explicit and cannot bypass guardrails silently. |

## Expected Bounded Contexts

The following bounded contexts are expected candidates for Phase 2. They are not final domain designs.

| Bounded Context Candidate | Primary Concepts | Notes |
| --- | --- | --- |
| Instance And Session | Instance, Session, provider connection state, pairing/reconnect lifecycle. | Must keep provider-native details behind adapter boundaries. |
| Messaging | Message, delivery state, supported type classification, inbound/outbound lifecycle. | Must preserve MVP message type scope. |
| Media | Media metadata, media validation, diagnostic capture state, cleanup policy. | Must preserve no-default-binary-retention rule. |
| Webhook Integration | Integration event, webhook delivery, retry, failure, dead letter. | Owns external event delivery lifecycle only. |
| Guardrails | Guardrail policy, rate-limit state, abuse-risk state, blocked/throttled/action-required outcomes. | Does not provide legal compliance automation. |
| Operations | Worker job, retry state, scheduler signal, recovery signal, health state. | Must avoid owning product policy that belongs to domain modules. |
| Security And Audit | Access context, privileged action evidence, audit record semantics, secret-safe handling. | Must not expose Secret data. |
| Observability | Safe telemetry event, correlation context, failure classification, health signal. | Must remain sanitized and not become a raw payload sink. |

## Domain Events To Consider

Phase 2 should evaluate domain events for:

- `instance.created`
- `instance.connected`
- `instance.disconnected`
- `instance.logged_out`
- `session.pending`
- `session.active`
- `session.expired`
- `session.revoked`
- `message.accepted`
- `message.queued`
- `message.processing`
- `message.sent`
- `message.delivered`
- `message.read`
- `message.failed`
- `media.accepted`
- `media.processed`
- `media.failed`
- `webhook.delivery.scheduled`
- `webhook.delivery.delivered`
- `webhook.delivery.failed`
- `webhook.delivery.dead_lettered`
- `guardrail.blocked`
- `guardrail.throttled`
- `worker.job.completed`
- `worker.job.dead`
- `health.state_changed`
- `audit.record_requested`

These event names are conceptual and must be refined during Phase 2.

## Domain Invariants To Preserve

Phase 2 must preserve:

- One Instance has at most one active Session.
- One Instance has at most one active provider connection at runtime.
- One Session cannot be both Active and Revoked.
- A Message has exactly one current lifecycle state.
- Accepted async work has visible lifecycle state.
- Webhook Delivered is terminal.
- Dead Letter is operator-visible.
- Provider-native payloads are translated before product modules consume them.
- Message and media bodies are not retained by default after processing.
- Secret data is never logged or exposed in plaintext outside controlled secret-handling flows.
- Configuration cannot silently disable product guardrails.

## Things Domain Must Not Change

Phase 2 must not change:

- Phase 0 product vision, scope, MVP persona, or tenancy.
- Single Tenant + Multi Instance MVP.
- MVP supported message types.
- Compliance posture as API platform with product-enforced guardrails.
- Out-of-scope boundaries for broadcast/campaign/group messaging/advanced message types.
- Modular Monolith architecture style.
- Dependency direction and package boundaries.
- Provider abstraction and Baileys isolation.
- Internal event publication rule: Domain creates facts, Application controls publication timing.
- Async job lifecycle visibility requirement.
- Webhook async/retry-visible requirement.
- Secret and Confidential handling rules.
- Baileys exact-version pinning and regression validation policy.

## Phase 2 Exit Criteria

Phase 2 should be considered complete only when:

- Bounded contexts are reviewed and accepted.
- Aggregate boundaries are documented.
- Entity/value object candidates are documented.
- Domain events and domain errors are documented.
- State transitions and invariants are documented.
- Domain responsibilities trace back to Phase 1 module ownership.
- Domain model avoids API/database/provider/queue/framework coupling.
- Testability expectations are defined for domain behavior.
- Open questions for Phase 3 implementation planning are recorded.

## Handoff Status

Phase 1 Architecture is frozen and handed off to Phase 2 - Domain Design.
