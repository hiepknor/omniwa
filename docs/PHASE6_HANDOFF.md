# OmniWA Phase 6 Handoff

## Purpose

This document hands OmniWA from Phase 5 - Persistence Design into Phase 6 - Infrastructure Design.

Phase 6 may design infrastructure topology, runtime environment, deployment model, environment configuration, observability plumbing, secret management approach, backup/restore operations, and technology selection boundaries needed to implement the frozen Product, Architecture, Domain, Application, API, and Persistence decisions.

Phase 6 must not change the frozen persistence model or earlier phase decisions.

## Infrastructure Goals

| Goal | Description |
|---|---|
| Operationalize approved architecture | Turn runtime, persistence, and application boundaries into deployable infrastructure design. |
| Preserve dependency boundaries | Ensure API, Worker, Provider, Persistence, Queue, Object Storage, and Observability interactions respect Architecture and Application freezes. |
| Support recoverable state | Provide infrastructure design for PostgreSQL, Redis, Object Storage, backup artifacts, restore validation, and recovery workflows. |
| Protect sensitive data | Define secret handling, encryption boundaries, access controls, redaction paths, and secure environment configuration. |
| Enable observability | Define logs, metrics, traces, health checks, correlation IDs, and alerting boundaries without leaking Secret/raw Confidential data. |
| Support async reliability | Provide infrastructure support for WorkerJob durability, queue support, retry, dead-letter, idempotency, and recovery. |
| Support production operations | Define deployment expectations, process roles, configuration, scaling, health, backup, restore, and incident support. |

## Required Reading

Before Phase 6 starts, read:

- `docs/FREEZE_PHASE_0.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/api/API_FREEZE.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/persistence/PHYSICAL_PERSISTENCE.md`
- `docs/persistence/POSTGRES_ARCHITECTURE.md`
- `docs/persistence/REDIS_ARCHITECTURE.md`
- `docs/persistence/OBJECT_STORAGE_ARCHITECTURE.md`
- `docs/persistence/BACKUP_AND_RECOVERY.md`
- `docs/persistence/ARCHIVE_AND_RETENTION.md`
- `docs/persistence/DATA_LIFECYCLE.md`
- `docs/architecture/RUNTIME_ARCHITECTURE.md`
- `docs/architecture/ASYNC_PROCESSING.md`
- `docs/architecture/TRUST_BOUNDARIES.md`
- `docs/architecture/CROSS_CUTTING_CONCERNS.md`
- `docs/application/TRANSACTION_STRATEGY.md`
- `docs/application/IDEMPOTENCY_STRATEGY.md`
- `docs/api/ASYNC_OPERATION_MODEL.md`
- `docs/api/AUTHENTICATION_MODEL.md`
- `docs/api/AUTHORIZATION_MODEL.md`

## Infrastructure Constraints

| Constraint | Requirement |
|---|---|
| API boundary | API must call Application commands/queries only; no direct database, Redis, Object Storage, provider, queue, or Domain access for product behavior. |
| Worker boundary | Worker Runtime must not call Interface/API layer and must operate through Application-owned workflows and ports. |
| Provider boundary | Provider adapters must not store provider-native payloads as product state or emit external webhooks directly. |
| Persistence boundary | Infrastructure implements repository and storage adapters but cannot change repository port semantics. |
| PostgreSQL boundary | PostgreSQL is the MVP durable source of truth for approved persistence state. |
| Redis boundary | Redis is ephemeral and cannot be backup source, source of truth, or Secret/raw Confidential store. |
| Object Storage boundary | Object Storage stores approved artifacts only and cannot replace PostgreSQL business metadata. |
| Secret boundary | Secret data must never be logged, exposed through API/webhook/error/audit/telemetry, cached in plaintext, or placed in object paths. |
| Retention boundary | Infrastructure must enforce audit, webhook, message, media, queue, session, diagnostic, and backup retention windows. |
| Backup boundary | Encrypted recoverable-state backup at least every 24 hours; backup retention 14 days; RPO 24 hours; RTO 4 hours for P1 OmniWA-controlled service recovery. |
| MVP tenancy | Infrastructure must support Single Tenant + Multi Instance only unless future Product decision and ADR approve Multi Tenant. |

## Technology Decision Scope

Phase 6 may evaluate and choose infrastructure technologies for:

- runtime process topology,
- deployment packaging and runtime environment,
- PostgreSQL deployment topology,
- PostgreSQL connection pooling,
- Redis deployment topology,
- queue-support infrastructure,
- Object Storage provider,
- secret provider,
- configuration delivery,
- logging, metrics, tracing, and alerting stack,
- backup artifact storage,
- backup and restore tooling,
- health check and readiness infrastructure,
- CI/CD and release environment strategy,
- local development and production environment parity.

Phase 6 may not decide:

- Product scope changes,
- new user personas,
- new API resources or endpoints,
- Domain Aggregate changes,
- Repository Port semantic changes,
- Application Command/Query meaning changes,
- physical schema/SQL/migration implementation without a later implementation phase,
- multi-tenant product behavior,
- analytics/search/campaign storage scope,
- provider-native payload contracts.

## Implementation Boundary

Infrastructure Design may define how implementation should be organized and operated, but it must not write code in the design phase unless a later phase explicitly requests implementation.

Implementation boundaries:

- Infrastructure implements adapters for approved ports.
- Infrastructure does not contain business rules.
- Infrastructure does not orchestrate product workflows.
- Infrastructure does not publish Domain Events.
- Infrastructure does not decide message, session, webhook, or worker business outcomes.
- Infrastructure does not change API request/response contracts.
- Infrastructure does not change Repository Port meaning.
- Infrastructure must expose failures as safe Infrastructure/Application error categories.

## Deployment Expectations

Phase 6 should design deployment expectations for:

| Area | Expected Design Output |
|---|---|
| API Runtime | Process responsibility, health checks, readiness, configuration, scaling constraints, and dependency access. |
| Worker Runtime | Async processing responsibility, recovery visibility, retry/dead-letter support, and safe shutdown behavior. |
| Background/Scheduler Runtime | Retention cleanup, projection rebuild, backup validation, and health refresh responsibility. |
| Provider Runtime | Provider connection isolation, session handling, reconnect coordination, and failure propagation. |
| PostgreSQL | Deployment topology, connection strategy, backup/restore approach, read replica candidate, and operational access. |
| Redis | Ephemeral topology, TTL policy, lock safety, cache strategy, queue-support constraints, and failure behavior. |
| Object Storage | Artifact classes, lifecycle policy, encryption boundary, access control, and backup artifact handling. |
| Observability | Structured logging, metrics, tracing, correlation/request IDs, alerting, and redaction rules. |
| Security | Secret provider, key rotation expectations, environment configuration, access controls, and audit boundaries. |
| Recovery | Restore runbooks, restore validation, re-pair/action-required handling, and incident evidence. |

## Infrastructure Must Not Change

- Product MVP: Single Tenant + Multi Instance.
- MVP message types: text, image, video, document, audio.
- Compliance posture: API platform with product-enforced guardrails.
- API as an adapter over Application commands and queries.
- Application command/query separation.
- Domain Aggregate ownership and invariants.
- Repository Port semantics.
- Persistence storage ownership and source-of-truth boundaries.
- PostgreSQL as MVP durable persistence store.
- Redis as ephemeral store only.
- Object Storage as artifact store only.
- Retention windows approved in Phase 0 and frozen in Phase 5.
- Backup baseline: encrypted daily backup, 14-day retention, RPO 24 hours, RTO 4 hours.
- Secret/raw Confidential exclusion from logs, telemetry, audit raw evidence, projections, cache, object paths, and public responses.
- Provider abstraction and Baileys isolation.
- Async work visibility before accepted responses.
- Webhook delivery asynchronous retry/dead-letter model.
- Cursor opacity and no database identifier exposure through API.
- No analytics/search/campaign scope expansion.
- No Multi Tenant behavior without future Product decision and ADR.

## Phase 6 ADR Candidates

Phase 6 should consider ADRs for:

- Infrastructure runtime topology.
- Deployment packaging strategy.
- PostgreSQL deployment and connection pooling.
- Redis deployment and queue-support strategy.
- Object Storage provider strategy.
- Secret management strategy.
- Configuration and environment strategy.
- Observability stack.
- Backup and restore tooling.
- Runtime health and readiness.
- Infrastructure security boundaries.

## Phase 6 Entry Criteria

| Criterion | Status |
|---|---|
| Product frozen | PASS |
| Architecture frozen | PASS |
| Domain frozen | PASS |
| Application frozen | PASS |
| API frozen | PASS |
| Persistence frozen | PASS |
| Infrastructure constraints defined | PASS |
| Required reading defined | PASS |
| Technology decision scope defined | PASS |

**Project is ready for Phase 6 - Infrastructure Design.**
