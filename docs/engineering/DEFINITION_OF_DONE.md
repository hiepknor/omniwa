# OmniWA Definition of Done

## Purpose

This document defines what "done" means for OmniWA implementation work.

It does not create tests, CI workflows, source code, package files, or implementation artifacts.

## Universal Definition of Done

A change is done only when:

- build succeeds,
- formatting and lint checks pass,
- type checks pass,
- relevant unit tests pass,
- relevant contract/integration tests pass,
- architecture fitness checks pass,
- security and redaction checks pass where applicable,
- documentation is updated or explicitly confirmed unchanged,
- traceability is documented,
- review is complete,
- no frozen decision is violated.

## Module Definition of Done

| Requirement | Done Criteria |
|---|---|
| Build | Module builds without errors in the workspace. |
| Tests | Unit tests cover critical behavior; contract/integration tests exist when module crosses a port. |
| Architecture | No dependency rule or package boundary violation. |
| ADR Compliance | No ADR violation; exceptions have approved ADR. |
| Freeze Compliance | Product, Architecture, Domain, Application, API, Persistence, and Infrastructure freezes are preserved. |
| Data Safety | Secret/raw Confidential values are not logged, exposed, cached, traced, projected, or placed in object paths. |
| Observability | Important failures are classified and correlated safely. |
| Documentation | Implementation notes, docs, or ADRs are updated when behavior/decision changes. |
| Review | Required role reviews are complete. |

## Layer-Specific Done Criteria

### Shared

- Contains no product policy.
- Imports no OmniWA package.
- Has tests for primitives where behavior exists.
- Does not create hidden global state.

### Domain

- Preserves frozen bounded contexts and aggregate boundaries.
- Business invariants are tested.
- Domain does not import Application, Infrastructure, Interface, provider, persistence, queue, framework, or logging sinks.
- Domain events are facts created by aggregate roots, not published directly.

### Application

- Commands map to approved use cases.
- Queries are side-effect free.
- Workflows do not redefine Domain business rules.
- Ports are used for external dependencies.
- Accepted async work is visible before accepted outcomes.
- Application does not import concrete Infrastructure.

### Infrastructure

- Implements approved ports without changing semantics.
- Does not own business policy.
- Does not call Interface.
- Translates external errors and provider signals into safe product categories.
- Protects secrets and raw Confidential data.

### Interface/API

- Calls Application commands/queries only.
- Does not call Domain, Provider, Baileys, persistence, queue, Redis, Object Storage, or Infrastructure directly for product behavior.
- Maps errors safely.
- Does not expose Secret/raw Confidential/provider-native payloads.
- Async responses distinguish accepted/queued/waiting from final external completion.

### Runtime Apps

- Compose approved packages only.
- Do not implement business policy.
- Preserve runtime role boundaries.
- Worker does not call API.
- Provider runtime does not emit external webhook events.
- Projection builder does not mutate source aggregates.

## Pull Request Definition of Done

Every PR must include:

- scope statement,
- traceability links to approved docs,
- tests added or rationale for no tests,
- architecture impact statement,
- security/data-safety impact statement,
- documentation impact statement,
- rollback or operational note when runtime/persistence behavior changes.

## Sprint Definition of Done

A sprint is done when:

- all sprint exit criteria are met,
- all merged work passes CI gates,
- unresolved blockers are documented,
- open risks are updated,
- docs reflect actual implementation behavior,
- demo/review artifacts are available,
- next sprint dependencies are clear.

## Release Candidate Definition of Done

A release candidate is done when:

- all required tests pass,
- E2E smoke tests pass,
- performance targets are evaluated,
- backup/restore validation is complete for production candidates,
- security review is complete,
- release notes are drafted,
- rollback plan exists,
- no Critical or Major open findings remain.

## Not Done Examples

| Example | Why Not Done |
|---|---|
| Feature works manually but has no architecture test coverage. | Boundary drift may be hidden. |
| API handler calls persistence adapter directly. | Violates API and Architecture Freeze. |
| Worker job is queued but not persisted/visible. | Violates async durability rule. |
| Provider adapter handles guardrail policy internally. | Violates provider boundary. |
| Logs include raw JID or session material. | Violates security and logging rules. |
| Repository exposes database IDs as product identity. | Violates persistence/API identity constraints. |

## Merge Quality Gates

| Gate | Criteria |
|---|---|
| Architecture check | No AFF blocker violation. |
| Dependency check | Import graph follows allowed boundaries. |
| Test check | Required unit/contract/integration tests pass. |
| Documentation check | Traceability and docs updates complete. |
| Security check | No secret leakage, redaction failures, or critical dependency issues. |
| Performance check | Critical paths have no known regression beyond target budget. |

## Checklist

| Item | Status |
|---|---|
| Universal DoD defined | PASS |
| Module DoD defined | PASS |
| Layer-specific DoD defined | PASS |
| PR DoD defined | PASS |
| Sprint DoD defined | PASS |
| Release candidate DoD defined | PASS |
| Quality gates defined | PASS |

**Definition of Done is ready.**
