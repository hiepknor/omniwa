# OmniWA Implementation Planning Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Decision

**APPROVED**

**Engineering Planning is complete.**

**Project is ready for Phase 8 - Implementation.**

## Scope

This freeze approves Phase 7 Engineering Planning and Repository Bootstrap design.

It does not approve or create:

- business code,
- source packages,
- `package.json`,
- workspace configuration,
- TypeScript configuration,
- Docker Compose,
- GitHub Actions,
- Prisma schema,
- SQL migrations,
- REST API implementation,
- Baileys implementation.

## Approved Documents

| Area | Approved Document |
|---|---|
| Engineering Plan | `docs/engineering/ENGINEERING_PLAN.md` |
| Implementation Roadmap | `docs/engineering/IMPLEMENTATION_ROADMAP.md` |
| Module Implementation Order | `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md` |
| Monorepo Structure | `docs/engineering/MONOREPO_STRUCTURE.md` |
| Package Layout | `docs/engineering/PACKAGE_LAYOUT.md` |
| Coding Standard | `docs/engineering/CODING_STANDARD.md` |
| Testing Strategy | `docs/engineering/TESTING_STRATEGY.md` |
| CI/CD Strategy | `docs/engineering/CI_CD_STRATEGY.md` |
| Release Strategy | `docs/engineering/RELEASE_STRATEGY.md` |
| Sprint Plan | `docs/engineering/SPRINT_PLAN.md` |
| Definition of Done | `docs/engineering/DEFINITION_OF_DONE.md` |
| Implementation Freeze | `docs/engineering/IMPLEMENTATION_FREEZE.md` |

## Approved Engineering Decisions

| Decision | Approved Position |
|---|---|
| Repository style | Monorepo for one modular monolith product boundary. |
| Runtime language family | TypeScript on Node.js LTS for implementation planning, consistent with Phase 6 Node.js runtime decision. |
| Source organization | Future `apps/`, `packages/`, `tooling/`, `scripts/`, `docker/`, `.github/`, and `docs/` layout. |
| Runtime apps | API, Worker, Scheduler, Provider Runtime, Webhook Dispatcher, Projection Builder, Background Jobs, Metrics, Health. |
| Package boundaries | Shared, Errors, Config, Observability, Domain, Application, Interface API, Infrastructure adapters, Testing. |
| Implementation sequence | Foundation -> Domain -> Application -> Persistence -> Async -> API -> Provider/Media -> Webhook/Observability -> Production readiness. |
| Testing posture | Domain/Application-heavy pyramid with mandatory contract, architecture, redaction, integration, E2E, and performance gates. |
| CI/CD posture | Build, lint, type, test, architecture, security, documentation, and release gates planned but not implemented in Phase 7. |
| Release posture | SemVer after public release, `0.x` before stability, release candidates gated by architecture/security/recovery readiness. |
| Definition of Done | Build, tests, architecture fitness, ADR/freeze compliance, docs, traceability, and review required. |

## Non-Negotiable Engineering Rules

- Product behavior enters through Application commands, queries, workflows, or approved ports.
- Domain owns business rules, invariants, policies, specifications, factories, and domain event facts.
- Application owns orchestration, transaction timing, idempotency, and event publication timing.
- API is an Interface adapter over Application only.
- Infrastructure implements ports and owns technical integration only.
- Provider/Baileys remains behind provider adapters and approved provider ports.
- Repository implementations preserve Domain repository port semantics.
- PostgreSQL is the MVP durable source of truth.
- Redis remains ephemeral.
- Object Storage remains artifact-only.
- Accepted async work must have visible lifecycle state.
- Secret/raw Confidential values must not be logged, cached, projected, traced, exposed, or placed in object paths.
- Any exception to package, dependency, runtime, storage, or provider rules requires ADR and affected-phase review.

## Implementation Constraints

Implementation must not change:

- MVP persona, scope, tenancy, out-of-scope rules, compliance guardrails, and message type scope.
- Architecture style, Modular Monolith decision, dependency rules, ports/adapters, runtime boundaries, and ADRs.
- Domain bounded contexts, aggregates, invariants, repository ports, events, services, policies, specifications, factories, and errors.
- Application use cases, workflows, commands, queries, idempotency, transaction, authorization, validation, mapper, and error strategies.
- API surface, resource model, auth/authz model, versioning, request/response/error model, async model, webhook contract, pagination/filtering strategy.
- Persistence boundaries, repository mapping, projection model, storage ownership, PostgreSQL/Redis/Object Storage responsibilities, retention, backup, recovery.
- Infrastructure runtime roles, process boundaries, technology decisions, security, observability, operations, scalability, disaster recovery.

## Traceability Gate

Every implementation task must trace to:

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

Tasks that cannot trace to approved documents must not be implemented until the missing decision is approved.

## Engineering Quality Gates

| Gate | Merge Criteria |
|---|---|
| Architecture Check | AFF blocker rules pass; no forbidden dependency path. |
| Dependency Check | Package imports follow approved matrix. |
| Test Check | Required unit, contract, integration, E2E, and performance tests pass for the change scope. |
| Documentation Check | Docs and traceability updated; freeze docs not changed without review. |
| Security Check | No Secret/raw Confidential leakage; dependency and redaction checks pass. |
| Performance Check | Critical path has no known regression beyond target budget. |
| Review Check | Required role reviews complete. |

## Implementation Readiness Review

| Area | Score | Result |
|---|---:|---|
| Team Readiness | 8 | PASS |
| Architecture Stability | 9 | PASS |
| Domain Stability | 9 | PASS |
| API Stability | 9 | PASS |
| Persistence Stability | 9 | PASS |
| Infrastructure Stability | 9 | PASS |
| Testing Readiness | 9 | PASS |
| CI/CD Readiness | 8 | PASS |
| Release Readiness Planning | 8 | PASS |
| Documentation Quality | 9 | PASS |

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| Critical | None | Not blocking |
| Major | None | Not blocking |
| Minor | `AGENTS.md` is not present in the repository. | Not blocking for implementation planning; create later only if the project wants repo-local agent instructions. |
| Minor | `CONTRIBUTING.md` is not present. | Not blocking; contribution rules are summarized in README and should be formalized during implementation. |
| Suggestion | Add implementation-time docs index under `docs/engineering/` if the document set grows. | Deferred. |

## Deferred Items

| Item | Status | Constraint |
|---|---|---|
| Concrete package manager files | Deferred to implementation | Must not weaken package boundaries. |
| Concrete TypeScript/lint/test config | Deferred to implementation | Must enforce coding and architecture rules. |
| Concrete API framework | Deferred to implementation | API must remain Interface adapter over Application. |
| Concrete ORM or migration tooling | Deferred to implementation data model review | Must preserve repository port semantics. |
| Concrete queue library | Deferred to implementation ADR if architecture-affecting | Must stay behind QueueProvider and preserve WorkerJob durability. |
| Concrete reverse proxy, secret provider, object storage provider, observability backend | Deferred to implementation/ADR as required | Must preserve Infrastructure Freeze constraints. |
| Concrete GitHub Actions | Deferred to implementation | Must enforce approved CI/CD gates. |

## Phase 7 Readiness Checklist

| Item | Status |
|---|---|
| Engineering plan completed | PASS |
| Implementation roadmap completed | PASS |
| Module implementation order completed | PASS |
| Monorepo structure completed | PASS |
| Package layout completed | PASS |
| Coding standard completed | PASS |
| Testing strategy completed | PASS |
| CI/CD strategy completed | PASS |
| Release strategy completed | PASS |
| Sprint plan completed | PASS |
| Definition of Done completed | PASS |
| Engineering constraints defined | PASS |
| Traceability rule defined | PASS |
| Quality gates defined | PASS |
| Implementation readiness reviewed | PASS |

**Engineering Planning is complete.**

**Project is ready for Phase 8 - Implementation.**
