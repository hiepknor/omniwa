# OmniWA Phase 7 Handoff

## Purpose

This document hands OmniWA from Phase 6 - Infrastructure Design into Phase 7 - Implementation Planning.

Phase 7 may plan source structure, coding standards, implementation order, testing strategy, CI/CD expectations, and execution sequencing.

Phase 7 must not change frozen Product, Architecture, Domain, Application, API, Persistence, or Infrastructure decisions without a new ADR and affected-phase review.

## Implementation Goals

| Goal | Description |
|---|---|
| Implement frozen design incrementally | Build in slices that preserve phase freezes and traceability. |
| Keep boundaries testable | Enforce Interface -> Application -> Domain and Infrastructure adapter rules. |
| Deliver durable async safety early | Implement WorkerJob visibility, idempotency, retry/dead-letter, and no silent drops before broad feature work. |
| Protect sensitive data from first commit | Redaction, SecretProvider, logging, and audit rules must be built before handling real credentials or payloads. |
| Make recovery operable | Backup/restore, retention, health, and recovery state must be planned before production use. |
| Keep implementation reviewable | Every implementation task should trace to approved docs and should not introduce hidden product scope. |

## Required Reading

Before Phase 7 planning starts, read:

- `docs/FREEZE_PHASE_0.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/api/API_FREEZE.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/infrastructure/INFRASTRUCTURE_FREEZE.md`
- `docs/PHASE6_HANDOFF.md`
- `docs/infrastructure/RUNTIME_PLATFORM.md`
- `docs/infrastructure/PROCESS_MODEL.md`
- `docs/infrastructure/INFRASTRUCTURE_ARCHITECTURE.md`
- `docs/infrastructure/TECHNOLOGY_DECISIONS.md`
- `docs/infrastructure/OBSERVABILITY.md`
- `docs/infrastructure/SECURITY_RUNTIME.md`
- `docs/infrastructure/OPERATIONS.md`
- `docs/infrastructure/DISASTER_RECOVERY.md`

## Repository Structure

Phase 7 should design a repository/source structure that reflects:

- `interface` or equivalent entry adapters for API/admin/health surfaces,
- `application` for commands, queries, workflows, services, transaction/idempotency orchestration,
- `domain` for aggregates, value objects, policies, specifications, factories, domain errors, and event facts,
- `infrastructure` for persistence, provider, queue, object storage, secret, configuration, observability, and webhook adapters,
- `shared` for policy-neutral primitives only,
- `testing` for fakes, fixtures, architecture tests, contract tests, and deterministic clock/UUID providers,
- `docs` as the frozen design reference.

Phase 7 may refine this into concrete folders, but source layout must preserve frozen dependency rules.

## Coding Principles

- Implement from Domain/Application contracts, not from database or provider convenience.
- Keep business logic out of Infrastructure and Interface.
- Keep API request/response mapping outside Domain.
- Keep provider-native payloads behind provider adapters.
- Keep Repository Port semantics unchanged.
- Keep Query side-effect free.
- Keep accepted async work durable and visible before returning accepted/queued state.
- Keep Secret and raw Confidential values out of logs, metrics, traces, audit raw evidence, projections, cache, object paths, and public responses.
- Use deterministic Clock/UUID abstractions in tests.
- Prefer focused vertical slices that prove boundaries before expanding features.

## Module Implementation Order

Recommended order:

1. Project skeleton and architecture fitness checks.
2. Shared primitives, error taxonomy, Clock, UUID, correlation/request context.
3. Domain model implementation for frozen Aggregates, Value Objects, policies, specifications, factories, and domain errors.
4. Application command/query and service skeletons with idempotency and transaction boundaries.
5. Infrastructure ports and fakes for tests.
6. Persistence adapter planning and reviewed physical data model before migrations or ORM models.
7. WorkerJob, QueueProvider, retry/dead-letter, and async visibility.
8. API interface adapter over Application commands/queries.
9. Auth, authorization, API key/admin key handling, and audit safety.
10. Provider adapter boundary and Baileys integration behind MessagingProvider.
11. Webhook Dispatcher and signed/verifiable delivery boundary.
12. Media/Object Storage adapter and retention cleanup.
13. Observability, health, metrics, tracing, and alerting.
14. Backup/restore, recovery validation, and operational runbooks.
15. Production hardening and release readiness review.

## Testing Strategy

Phase 7 should plan:

| Test Area | Purpose |
|---|---|
| Domain tests | Verify invariants, lifecycle rules, policies, specifications, and domain errors. |
| Application tests | Verify command/query orchestration, idempotency, transaction boundaries, auth decisions, async visibility. |
| Repository contract tests | Verify repository behavior without leaking physical storage semantics. |
| API contract tests | Verify Application mapping, auth, idempotency, async accepted semantics, redaction, query side effects. |
| Worker tests | Verify reservation, retry, dead-letter, shutdown/release, duplicate prevention. |
| Provider adapter tests | Verify provider payload translation and no business dependency on Baileys internals. |
| Webhook tests | Verify async delivery, retry, dead-letter, signing boundary, idempotency. |
| Persistence tests | Verify retention markers, backup/recovery state, projection rebuild, no raw payload retention. |
| Observability tests | Verify correlation propagation, redaction, metrics labels, trace safety. |
| Architecture tests | Enforce dependency direction, no Infrastructure import into Domain/Application where forbidden, no direct DB access from API, no Worker-to-API calls. |
| Recovery tests | Verify restore validation, WorkerJob reconciliation, projection rebuild, action-required marking. |

## CI/CD Expectations

Phase 7 may plan CI/CD, but implementation must not be created until requested.

Expected checks:

- formatting,
- linting,
- unit tests,
- architecture boundary tests,
- type checks,
- API contract tests,
- repository contract tests,
- security/redaction checks,
- dependency vulnerability checks,
- migration review gates when persistence implementation begins,
- build artifact verification,
- documentation drift checks against frozen docs.

Expected deployment controls:

- environment-specific configuration validation,
- secret presence checks without secret logging,
- health/readiness gates,
- rollback plan,
- backup status verification before risky production changes,
- post-deploy smoke checks.

## Implementation Must Not Change Without New ADR

- Product MVP, personas, out-of-scope rules, compliance guardrails.
- Architecture style, dependency rules, modular monolith, ports/adapters boundaries.
- Domain bounded contexts, aggregates, invariants, repository ports, domain events, policies.
- Application commands, queries, use cases, workflow boundaries, idempotency and transaction strategy.
- API surface, resource model, auth/authz model, versioning, error model, async contract, webhook contract.
- Persistence source-of-truth decisions, repository mapping, projections, PostgreSQL/Redis/Object Storage roles.
- Runtime process boundaries and infrastructure constraints.
- Redis ephemeral-only rule.
- Object Storage artifact-only rule.
- PostgreSQL durable source-of-truth rule.
- Secret/raw Confidential handling.
- Retention windows, RPO/RTO, backup retention.
- No Multi Tenant, multi-region, analytics/search/campaign/group/unsupported message scope expansion.

## Phase 7 Entry Criteria

| Criterion | Status |
|---|---|
| Product frozen | PASS |
| Architecture frozen | PASS |
| Domain frozen | PASS |
| Application frozen | PASS |
| API frozen | PASS |
| Persistence frozen | PASS |
| Infrastructure frozen | PASS |
| Implementation goals defined | PASS |
| Repository structure guidance defined | PASS |
| Coding principles defined | PASS |
| Module implementation order defined | PASS |
| Testing strategy defined | PASS |
| CI/CD expectations defined | PASS |

**Project is ready for Phase 7 - Implementation Planning.**
