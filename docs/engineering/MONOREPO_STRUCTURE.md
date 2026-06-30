# OmniWA Monorepo Structure

## Purpose

This document designs the future repository structure for OmniWA implementation.

It does not create folders, source code, package manager files, Docker files, GitHub Actions, TypeScript configuration, or implementation artifacts.

## Decision

OmniWA implementation should use a monorepo.

The monorepo supports one modular monolith product with multiple runtime roles and explicit package boundaries.

## Why Monorepo

| Reason | Benefit | Trade-off |
|---|---|---|
| Modular monolith alignment | One repository can preserve one product boundary while separating packages. | Import rules must be enforced by tooling and review. |
| Shared Domain/Application contracts | Inner contracts can evolve with tests across adapters. | Requires disciplined versioning when packages become public later. |
| Runtime role coordination | API, worker, scheduler, provider, webhook, projection, metrics, and health roles can share contracts. | Build/test times need optimization as code grows. |
| Architecture tests | Dependency and boundary rules can scan the full workspace. | Tooling must be selected and maintained. |
| Documentation traceability | Implementation can link directly to frozen docs in the same repo. | Docs drift checks are required. |

## Future Root Layout

The future implementation layout should be planned as:

```text
.
|-- apps/
|   |-- api/
|   |-- worker/
|   |-- scheduler/
|   |-- provider-runtime/
|   |-- webhook-dispatcher/
|   |-- projection-builder/
|   |-- background/
|   |-- metrics/
|   `-- health/
|-- packages/
|   |-- shared/
|   |-- errors/
|   |-- config/
|   |-- observability/
|   |-- domain/
|   |-- application/
|   |-- interface-api/
|   |-- infrastructure/
|   `-- testing/
|-- tooling/
|   |-- architecture/
|   |-- docs/
|   |-- security/
|   `-- release/
|-- scripts/
|-- docker/
|-- .github/
|-- docs/
|-- LICENSE
`-- README.md
```

This is a planned source layout only. Phase 7 does not create these directories.

## Boundary Definitions

| Boundary | Purpose | Production Import Rule |
|---|---|---|
| `apps/` | Runtime composition only. Each app wires packages into one runtime role. | Apps may import Application and Infrastructure adapters needed by their role. |
| `packages/shared/` | Policy-neutral primitives with no OmniWA package dependencies. | Must not import Domain, Application, Interface, or Infrastructure. |
| `packages/domain/` | Frozen bounded contexts, aggregates, value objects, domain events, policies, specifications, factories, and domain errors. | May import `shared` and allowed error primitives only. |
| `packages/application/` | Commands, queries, workflows, services, ports, transaction/idempotency orchestration, event publication timing. | May import Domain and Shared. Must not import concrete Infrastructure. |
| `packages/interface-api/` | Future API adapter mapping transport to Application commands/queries. | May import Application and Shared. Must not import Infrastructure for product behavior. |
| `packages/infrastructure/` | Adapter implementations for persistence, provider, queue, object storage, secret, config, webhook, observability. | May import Application ports and Domain types. Must not import Interface. |
| `packages/testing/` | Fakes, fixtures, contract helpers, architecture-test helpers, deterministic Clock/UUID. | Test scope only. Production packages must not import it. |
| `tooling/` | Build, architecture, documentation, security, release, and quality gate tooling. | Tooling does not define product behavior. |
| `scripts/` | Developer and release helper scripts. | Scripts must not encode business behavior. |
| `docker/` | Future runtime/deployment artifacts. | No Docker artifacts are created in Phase 7. |
| `.github/` | Future CI/CD and repository automation. | No GitHub Actions are created in Phase 7. |
| `docs/` | Frozen design and ongoing engineering documentation. | Source of truth for decisions and traceability. |

## Apps Boundary

`apps/` contains runtime composition, not business logic.

| App | Runtime Role | Owns | Must Not Own |
|---|---|---|---|
| `api` | API Runtime | Public/admin/health/monitoring entry wiring, auth boundary, request mapping. | Domain policy, provider calls, persistence access. |
| `worker` | Worker Runtime | Async job execution wiring, worker lifecycle, shutdown/release. | API handlers, direct provider business calls. |
| `scheduler` | Scheduler Runtime | Scheduled Application signal wiring. | Direct state mutation. |
| `provider-runtime` | Provider Runtime | Provider connection ownership wiring. | Product policy or external webhook emission. |
| `webhook-dispatcher` | Webhook Dispatcher | Outbound webhook delivery runtime. | Source business mutation. |
| `projection-builder` | Projection Builder | Read projection refresh/rebuild runtime. | Source aggregate mutation. |
| `background` | Background Jobs Runtime | Retention, cleanup, backup validation, recovery checks. | Business rule ownership. |
| `metrics` | Metrics Exporter | Safe metrics export. | Business state mutation. |
| `health` | Health Runtime | Liveness/readiness/startup/dependency health checks. | Repairing business state. |

## Packages Boundary

`packages/` contains reusable implementation packages that map to frozen architecture boundaries.

| Package | Boundary | Primary Docs |
|---|---|---|
| `shared` | Shared | `DEPENDENCY_RULES.md`, `PACKAGE_BOUNDARIES.md` |
| `errors` | Shared/Application/Domain classification support | ADR-009, Domain Errors, API Error Model |
| `config` | Configuration provider and validated snapshot boundary | ADR-008, Infrastructure Technology Decisions |
| `observability` | Logging, metrics, tracing, audit-safe telemetry contracts | ADR-010, Observability |
| `domain` | Domain | Domain Freeze |
| `application` | Application | Application Freeze |
| `interface-api` | Interface | API Freeze |
| `infrastructure` | Infrastructure adapters | Persistence Freeze, Infrastructure Freeze |
| `testing` | Test-only support | ADR-015, Testing Strategy |

## Tooling Boundary

`tooling/` should eventually contain:

- architecture dependency checks,
- documentation drift checks,
- security/redaction checks,
- release/changelog helpers,
- local development validation helpers,
- CI command composition helpers.

Tooling must never become product behavior.

## Monorepo Constraints

- Package boundaries must match ADR-003 and ADR-011.
- Source import aliases must not hide forbidden dependencies.
- Runtime apps must compose packages; they must not reimplement product logic.
- Shared must remain policy-neutral.
- Testing package must never be a production dependency.
- Docker and `.github` artifacts are future implementation artifacts, not Phase 7 deliverables.

## Checklist

| Item | Status |
|---|---|
| Monorepo decision documented | PASS |
| Root layout designed | PASS |
| Apps boundary defined | PASS |
| Packages boundary defined | PASS |
| Tooling boundary defined | PASS |
| Constraints defined | PASS |

**Monorepo structure is ready for implementation planning.**
