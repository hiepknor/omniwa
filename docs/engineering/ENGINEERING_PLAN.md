# OmniWA Engineering Plan

## Purpose

This document defines the Phase 7 engineering plan for OmniWA.

Phase 7 prepares implementation work without writing business code, creating runtime configuration, creating package manager files, implementing APIs, implementing persistence, creating Prisma schema, or integrating Baileys.

## Reviewed Inputs

Phase 7 planning is based on:

- `README.md`
- `docs/FREEZE_PHASE_0.md`
- `docs/PHASE7_HANDOFF.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/api/API_FREEZE.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/infrastructure/INFRASTRUCTURE_FREEZE.md`
- all ADRs in `docs/architecture/adr/`
- supporting documents under `docs/architecture/`, `docs/domain/`, `docs/application/`, `docs/api/`, `docs/persistence/`, and `docs/infrastructure/`

`AGENTS.md` is not present in the repository at the time of this planning document. No assumptions are made from a missing agent instruction file.

## Implementation Goals

| Goal | Description | Source Constraint |
|---|---|---|
| Preserve frozen design | Implementation must follow Product, Architecture, Domain, Application, API, Persistence, and Infrastructure freezes. | All freeze documents |
| Build incrementally | Implement small vertical slices that prove boundaries before adding feature breadth. | `PHASE7_HANDOFF.md` |
| Keep boundaries enforceable | Package layout, import rules, and architecture tests must enforce dependency direction. | ADR-003, ADR-011 |
| Protect async durability early | Accepted work must have visible WorkerJob/idempotency lifecycle before broad workflow expansion. | ADR-013, Application Freeze |
| Protect sensitive data from first implementation | Redaction, SecretProvider boundaries, and safe telemetry must exist before handling real secrets or payloads. | NFR, ADR-010, Infrastructure Freeze |
| Keep provider replaceability | Baileys must remain behind provider adapters and MessagingProvider-style ports. | ADR-006, ADR-007 |
| Keep implementation reviewable | Every task must trace to approved product, use case, workflow, command/query, aggregate, repository, API resource, and runtime/storage component. | Phase 7 traceability rule |

## Engineering Principles

- Implement from approved Domain and Application contracts, not from database or provider convenience.
- Use TypeScript on Node.js LTS for implementation planning because Phase 6 selected the Node.js runtime family for Baileys-compatible runtime roles.
- Treat the monorepo as one deployable modular product boundary for MVP.
- Keep `shared` small and policy-neutral.
- Keep Domain testable without infrastructure.
- Keep Application testable with fake ports.
- Keep Infrastructure replaceable through ports.
- Keep Interface as a transport adapter over Application commands and queries.
- Keep runtime roles isolated even when they are implemented in one repository.
- Prefer explicit mapping over leaking provider, persistence, queue, or HTTP concepts into inner layers.

## Team Organization

| Role | Primary Responsibility | Required Review Focus |
|---|---|---|
| Technical Lead | Owns implementation sequencing, boundary governance, merge readiness, and ADR escalation. | Traceability, architecture fitness, scope control |
| Domain/Application Lead | Owns domain model implementation, use-case orchestration, commands, queries, and policies. | Invariants, application workflow correctness |
| Platform/Infrastructure Lead | Owns persistence adapters, queue/provider adapters, runtime wiring, observability, and operational readiness. | Adapter boundaries, recovery, security |
| API/Interface Lead | Owns API adapter mapping, auth boundary, response/error mapping, and contract tests. | No API bypass of Application |
| SRE/Security Reviewer | Owns secret handling, redaction, health, logging, metrics, tracing, backup/recovery, and incident readiness. | Data safety and runtime controls |
| QA/Test Owner | Owns test pyramid, test fixtures, contract tests, architecture tests, and release confidence. | Coverage and gate completeness |
| Documentation Owner | Owns implementation notes, ADR updates, drift checks, and developer onboarding docs. | Frozen doc alignment |

Small teams may combine roles, but the review responsibilities remain required.

## Module Strategy

Implementation should be organized by architecture boundary first, then product capability inside each boundary.

| Boundary | Strategy |
|---|---|
| Shared | Implement only policy-neutral primitives needed by other packages. |
| Domain | Implement frozen bounded contexts and aggregates with no infrastructure dependency. |
| Application | Implement commands, queries, workflows, services, ports, idempotency, transaction orchestration, and event publication timing. |
| Infrastructure | Implement persistence, provider, queue, object storage, secret, configuration, webhook, and observability adapters behind ports. |
| Interface | Implement API/admin/health/metrics entry adapters over Application. |
| Runtime Apps | Compose packages into API, worker, scheduler, provider, webhook, projection, background, metrics, and health runtime roles. |
| Testing | Provide fakes, fixtures, architecture tests, contract tests, and deterministic Clock/UUID providers. |

## Review Strategy

| Review Type | Required For | Reviewer |
|---|---|---|
| Architecture review | New package boundary, new dependency, or exception to dependency rules. | Technical Lead |
| Domain review | Aggregate, policy, specification, factory, domain event, or domain error implementation. | Domain/Application Lead |
| Application review | Command, query, workflow, transaction, idempotency, mapper, or error mapping. | Domain/Application Lead |
| Infrastructure review | Adapter implementation, storage access, queue handling, provider integration, secrets, runtime wiring. | Platform/Infrastructure Lead |
| API review | Transport mapping, auth/authz boundary, error mapping, request/response behavior, pagination/filtering. | API/Interface Lead |
| Security review | Secrets, credentials, session material, webhook signing, audit, logging, redaction, dependency changes. | SRE/Security Reviewer |
| Test review | New critical behavior or boundary rule. | QA/Test Owner |
| Documentation review | Any implementation that changes developer behavior, operational behavior, or creates a new decision. | Documentation Owner |

## ADR Escalation

Create or update an ADR before implementation depends on:

- a dependency rule exception,
- a concrete queue library choice that changes runtime or persistence behavior,
- a concrete secret provider or object storage provider,
- a concrete observability backend coupling,
- a provider adapter behavior that changes product semantics,
- a persistence implementation decision that changes repository semantics,
- a runtime topology change that changes ownership or scaling assumptions,
- any scope change to Product, Domain, API, or Infrastructure freeze.

Tooling choices that do not change frozen semantics may be documented in engineering notes, but must still be reviewed when they affect security, release, or CI/CD gates.

## Traceability Requirement

No implementation task may be accepted unless it can trace through this chain:

```text
Product Feature
  -> Use Case
  -> Workflow
  -> Command / Query
  -> Aggregate
  -> Repository Port
  -> API Resource
  -> Infrastructure Component
  -> Runtime Process
```

When a link is not applicable, the task must state why. Example: pure architecture-test tooling may trace to ADR-003, ADR-011, and Architecture Fitness Functions instead of a product API resource.

## Engineering Constraints

- Do not change Product Freeze.
- Do not change Architecture Freeze.
- Do not change Domain Freeze.
- Do not change Application Freeze.
- Do not change API Freeze.
- Do not change Persistence Freeze.
- Do not change Infrastructure Freeze.
- Do not bypass Repository Ports.
- Do not move business rules outside Domain.
- Do not let API call Provider, Baileys, queue, database, Object Storage, Redis, or Domain directly for product behavior.
- Do not let Worker call Interface/API.
- Do not let Provider emit external webhooks directly.
- Do not allow accepted async work without visible lifecycle state.
- Do not log, cache, project, trace, expose, or place Secret/raw Confidential data in object paths.

## Implementation Readiness

| Readiness Area | Score | Assessment |
|---|---:|---|
| Team Readiness | 8 | Roles, review responsibilities, and sprint ownership are defined. Dedicated contributor docs are still future work. |
| Architecture Stability | 9 | Phase 1 is frozen with ADRs, dependency rules, module boundaries, runtime flows, and fitness functions. |
| Domain Stability | 9 | Phase 2 is frozen with bounded contexts, aggregates, invariants, events, repository ports, policies, and errors. |
| API Stability | 9 | Phase 4 is frozen at conceptual contract level with resources, auth, versioning, errors, async, and webhook model. |
| Persistence Stability | 9 | Phase 5 is frozen with storage ownership, repository mapping, projections, retention, backup, and physical roles. |
| Infrastructure Stability | 9 | Phase 6 is frozen with runtime roles, process model, technology decisions, observability, security, operations, and DR. |

## Blockers

No blocker prevents implementation planning freeze.

## Phase 7 Checklist

| Item | Status |
|---|---|
| Implementation goals defined | PASS |
| Engineering principles defined | PASS |
| Team organization defined | PASS |
| Module strategy defined | PASS |
| Review strategy defined | PASS |
| ADR escalation defined | PASS |
| Traceability requirement defined | PASS |
| Engineering constraints defined | PASS |

**Phase 7 engineering plan is ready for implementation freeze.**
