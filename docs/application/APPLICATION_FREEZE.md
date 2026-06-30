# OmniWA Application Freeze

## Freeze Date

2026-06-30 Asia/Ho_Chi_Minh.

## Freeze Decision

**APPROVED**

**Application Phase is FROZEN.**

**Project is ready for Phase 4 - API Contract.**

## Application Version

Phase 3 Application v1.0.

This version freezes:

- Phase 3.1 Use Case Inventory.
- Phase 3.2 Application Workflows.
- Phase 3.3 Command & Query Model.
- Phase 3.4 Application Services, boundaries, strategies, review, and handoff.

## Approved Documents

The following documents are approved as the Phase 3 Application baseline:

- `docs/application/APPLICATION_OVERVIEW.md`
- `docs/application/APPLICATION_BOUNDARIES.md`
- `docs/application/USE_CASE_CATALOG.md`
- `docs/application/USE_CASE_GROUPS.md`
- `docs/application/USE_CASE_DEPENDENCIES.md`
- `docs/application/APPLICATION_WORKFLOWS.md`
- `docs/application/WORKFLOW_CATALOG.md`
- `docs/application/WORKFLOW_STATES.md`
- `docs/application/WORKFLOW_DEPENDENCIES.md`
- `docs/application/SAGA_CANDIDATES.md`
- `docs/application/COMPENSATION_STRATEGIES.md`
- `docs/application/COMMAND_MODEL.md`
- `docs/application/QUERY_MODEL.md`
- `docs/application/COMMAND_CATALOG.md`
- `docs/application/QUERY_CATALOG.md`
- `docs/application/COMMAND_QUERY_BOUNDARIES.md`
- `docs/application/APPLICATION_MESSAGES.md`
- `docs/application/APPLICATION_SERVICES.md`
- `docs/application/TRANSACTION_STRATEGY.md`
- `docs/application/IDEMPOTENCY_STRATEGY.md`
- `docs/application/VALIDATION_STRATEGY.md`
- `docs/application/AUTHORIZATION_BOUNDARIES.md`
- `docs/application/MAPPER_STRATEGY.md`
- `docs/application/APPLICATION_ERRORS.md`

## Review Summary

| Review Area | Result | Notes |
| --- | --- | --- |
| Use Cases | PASS | Use cases cover Instance, Messaging, Media, Webhook, Provider, Operations, Administration, Monitoring, and Queries. |
| Workflows | PASS | Workflows define orchestration, long-running behavior, dependencies, saga candidates, and compensation without implementation leakage. |
| Commands | PASS | Commands map to approved Phase 3.1 use cases and reference approved workflows or workflow patterns. |
| Queries | PASS | Queries are side-effect free and trace to approved query use cases, Product Scope, NFRs, Success Metrics, or Monitoring requirements. |
| Application Services | PASS | Service ownership is clear and does not redefine Domain business rules. |
| Boundaries | PASS | Interface, Application, Domain, and Infrastructure responsibilities remain aligned with Architecture Freeze. |
| Transaction Strategy | PASS | Application owns conceptual Unit of Work and commit timing without ORM/database design. |
| Validation Strategy | PASS | Validation responsibilities are separated by layer. |
| Authorization Boundaries | PASS | Application invokes AccessDecision; Interface/Domain/Infrastructure do not bypass it. |
| Idempotency Strategy | PASS | Duplicate-prone commands, provider signals, worker work, retries, and async acceptance are covered. |
| Mapper Strategy | PASS | Mapping remains conceptual and does not introduce DTO/API/provider/database leakage. |
| Error Strategy | PASS | Domain, Infrastructure, Provider, and Unknown errors map to safe Application outcomes without HTTP design. |

## Findings

| Severity | Count | Result |
| --- | ---: | --- |
| Critical | 0 | None. |
| Major | 0 | None. |
| Minor | 0 | None. |
| Suggestions | 3 | Track in Phase 4 and implementation planning. |

Suggestions:

- Phase 4 should keep DTO/API naming mapped to Application commands and queries without renaming product intent.
- Phase 4 should explicitly document how transport authentication maps into safe actor context without becoming product authorization owner.
- Implementation planning should add architecture tests for command/query side effects, dependency direction, and Secret/raw Confidential redaction.

## Approved Application Constraints

- Application remains the orchestration boundary.
- Application Services do not own business rules.
- Every command maps to an approved use case.
- Every query is side-effect free.
- Queries do not repair stale projections.
- Accepted async work must be visible before accepted outcome is reported.
- Worker Runtime enters through Application commands and never Interface.
- Provider signals must be translated before Application consumption.
- Webhook delivery is asynchronous and must not mutate source business facts.
- Application owns conceptual transaction boundaries.
- Domain owns aggregate invariants, policies, specifications, factories, and event facts.
- Infrastructure implements ports and must not orchestrate product behavior.
- Interface may map transport to Application messages but must not call Domain/Infrastructure directly for product behavior.
- Secret and raw Confidential data must not cross normal response, audit, telemetry, webhook, or log boundaries.

## Non Negotiable Application Rules

- Do not create REST/API behavior that bypasses Application commands or queries.
- Do not introduce DTOs that change product meaning.
- Do not place business policy in Application Services.
- Do not let Application depend on Baileys, database, Prisma, queue engine, HTTP framework, or concrete logging/telemetry/secret implementations.
- Do not let Query mutate Domain, publish events, enqueue work, call provider, or repair projections.
- Do not report async acceptance when WorkerJob or owner lifecycle is not visible.
- Do not publish Domain Events from Interface, Infrastructure, Repository, Provider adapter, or Mapper.
- Do not expose Secret, raw Confidential data, provider-native payloads, raw phone numbers, or raw JIDs.

## Deferred Decisions

The following decisions are intentionally deferred to later phases:

- REST resource design.
- OpenAPI contract.
- DTO shape and naming.
- Transport authentication and API key design.
- HTTP status/error mapping.
- Pagination/filtering/sorting model for API reads.
- Webhook signing contract.
- Concrete persistence implementation and transaction mechanics.
- Concrete queue engine and worker implementation.
- Concrete event bus implementation.
- Concrete observability, logging, tracing, and metrics stack.
- Concrete deployment, Docker, Prisma, or ORM choices.

## Phase 3.4 Checklist

| Item | Status |
| --- | --- |
| Services defined | PASS |
| Boundaries defined | PASS |
| Validation defined | PASS |
| Transaction strategy defined | PASS |
| Idempotency defined | PASS |
| Error mapping defined | PASS |
| Application review passed | PASS |

**Application Phase is FROZEN.**

**Project is ready for Phase 4 - API Contract.**
