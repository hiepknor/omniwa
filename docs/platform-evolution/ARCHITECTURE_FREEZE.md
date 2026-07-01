# OmniWA Platform Architecture Freeze

## Freeze Decision

**ARCHITECTURE FROZEN WITH CONDITIONS**

Freeze date: 2026-07-01 Asia/Ho_Chi_Minh.

This freeze is an architecture freeze, not a production readiness approval.

The platform is architecturally ready to move fully into implementation according to `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`. The latest production readiness review remains authoritative that OmniWA is **NOT READY** for production until the implementation blockers in that plan are resolved.

## Scope Reviewed

This freeze decision is based on:

- `docs/platform-evolution/*`
- `docs/reviews/*`
- `docs/adr/*`

No code, API implementation, runtime implementation, schema, or additional roadmap was created as part of this freeze.

## Architecture Completeness Assessment

| Area                      | Status | Decision                                                                                                                                                                                                                                                     |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture completeness | DONE   | Clean Architecture, Hexagonal boundaries, Ports and Adapters, modular monolith rules, dependency direction, and architecture gates are defined.                                                                                                              |
| Domain completeness       | DONE   | Core platform domains are identified and implemented at design/source level, including Instance, Session, Message, Media, Webhook, WorkerJob, ProviderProfile, Group, Chat, Contact, Label, Audit, Health, Configuration, Telemetry, Guardrails, and Access. |
| Platform boundary         | DONE   | Public boundary is fixed as SDK -> REST API -> Interface Adapter -> Application -> Domain. Application command/query names remain internal.                                                                                                                  |
| Public contract           | DONE   | REST/OpenAPI/SDK strategy is fixed. Remaining work is typed DTO and compatibility implementation, not a new architecture decision.                                                                                                                           |
| Runtime strategy          | DONE   | API, worker, provider runtime, webhook dispatcher, projection/event processing, metrics, health, and background runtime responsibilities are defined. Remaining work is execution.                                                                           |
| Persistence strategy      | DONE   | PostgreSQL is the production source-of-truth direction; JSON persistence is a transitional adapter only. Repository ports remain the boundary.                                                                                                               |
| Provider strategy         | DONE   | Baileys remains behind provider ports/adapters. Provider runtime owns socket/session lifecycle and must not leak provider logic.                                                                                                                             |
| Operational strategy      | DONE   | Observability, health, readiness, recovery, backup, load testing, and production gates are defined in the production execution plan.                                                                                                                         |
| Security strategy         | DONE   | API key lifecycle, ownership authorization, rate limiting, secret provider, audit, webhook signing, replay protection, and redaction requirements are defined.                                                                                               |
| Migration strategy        | DONE   | Evolution remains incremental, rollbackable, non-rewrite, and compatibility-preserving.                                                                                                                                                                      |

## Design Gaps

**No remaining architecture-level blockers.**

The open gaps identified by `docs/reviews/PLATFORM_READINESS_REVIEW.md` are implementation and production-readiness gaps, not unresolved architecture choices.

Examples of implementation gaps that must not be reclassified as architecture blockers:

- real Application dispatcher/use-case handlers,
- API runtime dependency composition,
- worker runtime,
- provider runtime,
- PostgreSQL adapter and migrations,
- production queue adapter,
- API key lifecycle,
- rate limiting,
- ownership-aware authorization,
- SecretProvider adapter,
- durable EventLog and SSE replay,
- webhook dispatcher runtime,
- observability exporters and dependency readiness,
- backup/restore drills,
- E2E, security, and load tests,
- typed public DTOs and OpenAPI compatibility gates.

These items are already planned in `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` and should now be implemented rather than redesigned.

## Freeze Checklist

| Item               | Status | Notes                                                                                                                                    |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture       | DONE   | Architecture direction is clear and enforced by package boundary rules.                                                                  |
| ADR                | DONE   | ADR-0001 through ADR-0007 are accepted platform architecture decisions. Architecture ADR-001 through ADR-016 are also accepted.          |
| Platform scope     | DONE   | OmniWA is a backend platform with REST, OpenAPI, SDK, TUI/Web/CLI/MCP/client boundaries, and no client-side business logic.              |
| Public contract    | DONE   | Versioned REST, OpenAPI, SDK, response/error envelopes, authentication boundary, event stream, and compatibility policy are decided.     |
| Evolution roadmap  | DONE   | Phase A through Phase J established the platform foundation.                                                                             |
| Production roadmap | DONE   | `PRODUCTION_EXECUTION_PLAN.md` defines prioritized blockers, dependencies, epics, sprints, production gates, metrics, and exit criteria. |

## Freeze Conditions

The architecture is frozen under these conditions:

1. Implementation must follow `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.
2. No new architecture roadmap, design phase, or design plan should be created before implementation starts.
3. Existing architecture, platform boundary, public contract, domain, persistence, provider, security, and runtime decisions must not be reinterpreted during implementation.
4. Any material architecture change requires a new ADR before implementation.
5. ADR status metadata is aligned with this freeze decision; future ADR metadata changes must not alter accepted design decisions.
6. JSON durable persistence must remain a transitional adapter and must not be promoted to production persistence.
7. Public clients must continue to use SDK over REST; no client may call Application, Domain, Provider, Persistence, or internal command/query contracts directly.
8. Production readiness remains gated by `PRODUCTION_EXECUTION_PLAN.md`; architecture freeze does not imply production readiness.

## Implementation Commitments

From this freeze point:

- Do not create additional design documents for platform architecture.
- Do not change major architecture without a new ADR.
- Do not add client business logic.
- Do not expose Application command/query names as public API.
- Do not bypass the Interface Adapter, Application Layer, Repository Ports, Provider Ports, or approved public contract.
- Do not treat implementation blockers as reasons to reopen architecture unless a concrete architecture contradiction is found.
- Move to implementation using the production execution plan.

## Remaining Architecture Blockers

None.

No remaining architecture-level blockers.

## Final Architecture Status

**ARCHITECTURE FROZEN WITH CONDITIONS**

OmniWA may now move fully into implementation.

The next valid work is implementation of the production execution plan, starting with Application dispatcher and runtime composition. The project must remain at production readiness status **NOT READY** until the production gates in `PRODUCTION_EXECUTION_PLAN.md` are satisfied.
