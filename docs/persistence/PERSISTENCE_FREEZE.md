# OmniWA Persistence Freeze

## Freeze Date

2026-06-30

## Freeze Decision

**APPROVED**

**Persistence Phase is FROZEN.**

**Project is ready for Phase 6 - Infrastructure Design.**

## Persistence Version

Persistence Design Version: **v1.0**

Scope:

- Phase 5.1 Logical Persistence.
- Phase 5.2 Repository Mapping and Query Model.
- Phase 5.3 Physical Persistence Architecture.

## Reviewer Summary

Persistence Review Board reviewed:

- Persistence Boundary.
- Repository Mapping.
- Read Model and Projection Model.
- Storage Ownership.
- PostgreSQL Architecture.
- Redis Architecture.
- Object Storage Architecture.
- Index and Partition Strategy.
- Archive, Retention, Backup, Recovery, and Data Lifecycle.
- Traceability from Product Capability to physical storage.

The review found no Critical or Major findings. The persistence design preserves frozen Product, Architecture, Domain, Application, and API decisions and is ready to hand off to Infrastructure Design.

## Approved Documents

| Area | Approved Documents |
|---|---|
| Logical Persistence | `PERSISTENCE_OVERVIEW.md`, `PERSISTENCE_BOUNDARIES.md`, `STORAGE_MODEL.md`, `AGGREGATE_PERSISTENCE.md`, `READ_WRITE_MODEL.md`, `STORAGE_OWNERSHIP.md`, `PERSISTENCE_CONSTRAINTS.md` |
| Repository Mapping and Query Model | `REPOSITORY_MAPPING.md`, `QUERY_ACCESS_PATTERNS.md`, `READ_PROJECTIONS.md`, `PROJECTION_STRATEGY.md`, `PERSISTENCE_MAPPING_RULES.md`, `QUERY_CONSISTENCY.md` |
| Physical Persistence | `PHYSICAL_PERSISTENCE.md`, `POSTGRES_ARCHITECTURE.md`, `REDIS_ARCHITECTURE.md`, `OBJECT_STORAGE_ARCHITECTURE.md`, `INDEX_STRATEGY.md`, `PARTITION_STRATEGY.md`, `ARCHIVE_AND_RETENTION.md`, `BACKUP_AND_RECOVERY.md`, `DATA_LIFECYCLE.md` |

## Approved Repository Model

| Review Area | Result | Notes |
|---|---|---|
| Repository boundary | PASS | Repositories persist and rehydrate Aggregate Roots only. |
| Aggregate ownership | PASS | Every repository maps to a single approved Aggregate Root boundary. |
| Query responsibility | PASS | Repository ports do not become broad reporting/search/analytics services. |
| Infrastructure leakage | PASS | Repository ports remain Domain contracts; implementations remain Infrastructure. |
| Sensitive data handling | PASS | Repository rules reject Secret, raw Confidential, provider-native payload, raw phone/JID, raw media, and message body leakage. |
| Coupling | PASS | Cross-aggregate state changes remain Application-coordinated. |

Approved repository principle:

> Repository implementations may choose physical persistence mechanics later, but they must preserve Domain repository port semantics and Aggregate ownership.

## Approved Storage Model

| Storage Area | Approved Decision |
|---|---|
| Source-of-truth durable state | PostgreSQL stores approved Aggregate Root persistence units, repository state, audit-safe evidence, idempotency state, retention markers, WorkerJob state, and read projections. |
| Ephemeral operational state | Redis is allowed for cache, coordination locks, rate/guardrail windows, queue-support mechanics, and runtime hints only. |
| Binary and artifact state | Object Storage is allowed for temporary media artifacts, diagnostic artifacts, import/export artifacts, encrypted backup artifacts, and approved archive artifacts. |
| Audit and retention state | PostgreSQL remains the source for Secret-safe audit metadata and retention markers. |
| Backup artifacts | Encrypted backup artifacts are stored outside the primary PostgreSQL runtime boundary and retained for 14 days. |
| Archive | Archive remains source-owner governed and cannot become a new source of truth. |

## Approved Projection Model

| Review Area | Result | Notes |
|---|---|---|
| Projection ownership | PASS | Projections have explicit source facts and owners. |
| Source of truth | PASS | Projections are derived read models and cannot mutate source Aggregates. |
| Consistency | PASS | Strong owner reads, eventual reads, snapshot reads, cached reads, and realtime-style near-current reads are clearly classified. |
| Freshness | PASS | Eventual projections require stale/freshness markers where externally visible. |
| Rebuild | PASS | Projection rebuild reads retained source state and cannot reconstruct expired data. |
| Security | PASS | Projection safety rules exclude Secret and raw Confidential payloads. |

Approved projection principle:

> Projections exist to serve approved Application queries and API read contracts; they do not enforce business rules or replace the Aggregate write model.

## Approved Physical Architecture

| Component | Approved Responsibility | Non-Responsibility |
|---|---|---|
| PostgreSQL | Durable transactional store for Aggregate state, read projections, audit-safe evidence, idempotency, retention markers, WorkerJob state, and recovery-visible state | Does not define Domain ownership; schemas and physical identifiers do not leak into Domain/API |
| Redis | Ephemeral cache, lock, rate window, queue-support, and runtime hint store | Not permanent storage; not backup source; not source of truth |
| Object Storage | Binary/artifact storage for temporary media, diagnostics, import/export, encrypted backups, and approved archives | Not business metadata source; not query model; not public identity source |
| Archive boundary | Source-owner governed retained summaries and approved archive artifacts | Cannot resurrect expired sensitive data into normal API responses |
| Backup boundary | Encrypted daily recoverable-state backup with 14-day retention | Does not guarantee upstream WhatsApp/provider state |

## Boundary Validation

| Question | Result | Evidence |
|---|---|---|
| Does Persistence leak business logic? | PASS | Business rules remain in Domain/Application; persistence stores state and supports ports. |
| Do repositories leak infrastructure? | PASS | Repository ports are Domain contracts; PostgreSQL/Redis/Object Storage are Infrastructure decisions. |
| Do projections become source of truth? | PASS | Projection docs repeatedly state read-only, derived, rebuildable, and non-mutating behavior. |
| Does Redis overlap durable state? | PASS | Redis is explicitly ephemeral and rebuildable/reconcilable from PostgreSQL. |
| Does Object Storage overlap business metadata? | PASS | Object Storage stores artifacts only; PostgreSQL stores queryable metadata and retention markers. |

## Repository Validation

| Question | Result |
|---|---|
| Repository maps to the correct Aggregate boundary | PASS |
| Repository query scope stays within responsibility | PASS |
| Repository avoids cross-context mutation | PASS |
| Repository avoids provider-native payloads | PASS |
| Repository supports recovery and idempotency visibility | PASS |

## Projection Validation

| Question | Result |
|---|---|
| Projection avoids duplicated business logic | PASS |
| Projection consistency is explicit | PASS |
| Projection ownership is clear | PASS |
| Projection rebuild respects retention | PASS |
| Projection cannot repair or mutate source state | PASS |

## Physical Storage Validation

| Component | Result | Notes |
|---|---|---|
| PostgreSQL | PASS | Correctly selected as MVP durable store. |
| Redis | PASS | Correctly limited to ephemeral roles. |
| Object Storage | PASS | Correctly limited to binary/artifact roles. |
| Index Strategy | PASS | Access-pattern level only; no DDL created. |
| Partition Strategy | PASS | Conceptual and retention-driven; no DDL created. |
| Backup and Recovery | PASS | Matches Phase 0 RPO/RTO/retention decisions. |
| Data Lifecycle | PASS | Covers required data categories and retention windows. |

## Retention Validation

| Data Category | Result | Approved Constraint |
|---|---|---|
| Audit | PASS | 180 days, Secret-safe evidence only. |
| Webhook metadata | PASS | 30 days, raw payload excluded by default. |
| Message metadata | PASS | 30 days, body excluded by default. |
| Diagnostic message content | PASS | Explicit capture only, maximum 7 days. |
| Media metadata | PASS | 30 days. |
| Media binary | PASS | Not retained by default after processing; diagnostic maximum 7 days. |
| Queue/WorkerJob | PASS | Completed 7 days; failed/action-required 30 days. |
| Session | PASS | Retained while active; deleted within 24 hours after instance deletion except backup retention. |
| Backup | PASS | Encrypted backup retained 14 days. |

## Scalability Validation

| Evolution Area | Result | Notes |
|---|---|---|
| Read replica | PASS | Supported for projections/eventual reads; strong owner reads stay authoritative. |
| Archive database | PASS | Future candidate without changing source ownership. |
| Partitioning | PASS | Time/retention-driven candidates identified. |
| Sharding | PASS | Deferred; does not break MVP design. |
| Analytics | PASS | Deferred; cannot become source of truth or scope expansion. |
| Future Multi Tenant | PASS | Requires future Product decision and ADR. MVP remains Single Tenant + Multi Instance. |

## Security Validation

| Area | Result | Notes |
|---|---|---|
| Storage isolation | PASS | Source state, projections, audit/security, config, and retention areas are separated conceptually. |
| Secret handling | PASS | Secret values are excluded from queryable/cache/loggable storage. |
| Sensitive data | PASS | Raw Confidential data is excluded by default from projections, audit, telemetry, and object artifacts. |
| Encryption boundary | PASS | Confidential/Secret data requires encryption in transit and at rest; encrypted backup required. |
| Backup security | PASS | Encrypted backup artifacts with 14-day retention and restore validation. |
| Redis safety | PASS | Redis cannot store Secret/raw Confidential values and is not backup source. |
| Object safety | PASS | Object paths/references cannot contain raw phone, JID, secrets, or provider identifiers. |

## Traceability Validation

Traceability is present across the required chain:

Product Capability -> API Resource -> Application Use Case / Query -> Repository Port -> Aggregate -> Storage Unit -> Physical Storage.

| Evidence | Result |
|---|---|
| `STORAGE_MODEL.md` maps Logical Storage to Aggregate, Repository Port, Application Use Case, API Resource, and Product Capability. | PASS |
| `AGGREGATE_PERSISTENCE.md` maps Persistence Unit to Aggregate, Repository Port, Application Use Case, API Resource, and Product Capability. | PASS |
| `REPOSITORY_MAPPING.md` maps Persistence Unit to Aggregate, Repository Port, Application Query, API Resource, and Product Capability. | PASS |
| `PHYSICAL_PERSISTENCE.md` maps Physical Storage Area to Repository Port, Aggregate, Application Service/Query, API Resource, and Product Capability. | PASS |
| `DATA_LIFECYCLE.md` maps data lifecycle to Repository Port, Aggregate/Projection, Application Service/Query, API Resource, and Product Capability. | PASS |

## Quality Review

| Category | Score | Rationale |
|---|---:|---|
| Logical Design | 9 | Clear boundary, ownership, consistency, and no business leakage. |
| Repository Design | 9 | Repository ports align with Aggregate Roots and avoid reporting leakage. |
| Projection Design | 9 | Projection ownership, consistency, rebuild, and safety rules are explicit. |
| Storage Design | 9 | PostgreSQL/Redis/Object Storage responsibilities are well separated. |
| Scalability | 8 | Read replica, partition, archive, sharding, analytics, and multi-tenant evolution are addressed without premature implementation. |
| Security | 9 | Strong Secret/raw Confidential restrictions, backup security, cache constraints, and object safety. |
| Maintainability | 9 | Traceability and constraints make later implementation reviewable. |
| Performance | 8 | Access-pattern index strategy and read projection model are sufficient for design phase. |
| Recoverability | 9 | Backup frequency, RPO/RTO, restore validation, WorkerJob and webhook recovery are covered. |
| Documentation | 9 | Complete document set with diagrams, constraints, traceability, and readiness checklists. |

Overall Score: **8.8 / 10**

## Findings

| Severity | Finding | Impact | Disposition |
|---|---|---|---|
| Critical | None | None | Not blocking |
| Major | None | None | Not blocking |
| Minor | Future implementation must provide a reviewed physical data model before creating tables, indexes, migrations, or ORM models. | Prevents implementation drift from the approved design. | Deferred to Phase 6/implementation planning |
| Suggestion | Add restore drill cadence and operational runbook details when infrastructure design selects backup tooling. | Improves operational readiness. | Deferred to Phase 6 |
| Suggestion | Add implementation-time architecture tests or lint rules for no direct DB/API/Domain boundary violations. | Improves maintainability and safety. | Deferred to Phase 6/implementation planning |

## Deferred Decisions

| Decision | Status | Required Future Action |
|---|---|---|
| Concrete PostgreSQL physical schema | Deferred | Requires implementation-phase data model review. |
| Concrete index DDL | Deferred | Requires access-pattern validation and performance review. |
| Concrete partition DDL | Deferred | Requires data volume and retention implementation plan. |
| PostgreSQL extension selection | Deferred | Requires specific implementation justification. |
| Redis deployment topology and queue library | Deferred | Requires Infrastructure/Implementation decision and ADR if it changes architecture constraints. |
| Object Storage provider | Deferred | Requires Infrastructure decision. |
| Backup product/tooling | Deferred | Requires Infrastructure decision and restore drill plan. |
| Archive database/cold storage | Deferred | Requires retention volume and operational need. |
| Analytics/search/warehouse storage | Deferred | Requires Product decision and ADR. |
| Multi Tenant storage strategy | Deferred | Requires future Product decision, Domain update, API update, and ADR. |

## Storage Constraints

- PostgreSQL is the MVP durable source of truth for approved persistence state.
- Redis is ephemeral and must never be required to restore durable product state.
- Object Storage stores binary/artifact data, not business metadata.
- Repository implementations must preserve Domain repository port semantics.
- Repository ports must not become broad reporting, analytics, campaign, or search surfaces.
- Projection storage must remain derived, read-only, and non-mutating.
- Read projections must not contain business rules.
- Application commands and queries remain the only approved access path from Interface to persistence behavior.
- API must not access PostgreSQL, Redis, Object Storage, queue, or provider directly.
- Domain must not depend on physical persistence models.
- Physical identifiers must not leak into API, Domain, Application messages, webhook payloads, audit events, or telemetry.
- Secret data must not be logged, cached, projected, exposed, or archived in plaintext.
- Raw Confidential payloads, raw message bodies, raw media binary, raw webhook payloads, raw phone numbers, raw JIDs, and provider-native payloads are excluded by default.
- Backup and recovery must preserve product identity, idempotency, lifecycle, retry/dead-letter state, retention markers, and audit continuity where available.
- Recovery must not resurrect expired data.

## Phase 5 Readiness

| Area | Status |
|---|---|
| Persistence Boundary | PASS |
| Repository Mapping | PASS |
| Projection | PASS |
| Physical Storage | PASS |
| Backup | PASS |
| Recovery | PASS |
| Lifecycle | PASS |
| Security | PASS |
| Traceability | PASS |
| Documentation | PASS |

**Persistence Phase is FROZEN.**

**Project is ready for Phase 6 - Infrastructure Design.**

## Summary

OmniWA Persistence Design is approved and frozen.

The approved persistence architecture is sufficient for Phase 6 Infrastructure Design because it defines logical boundaries, repository-to-storage mapping, query/projection model, physical storage responsibilities, retention, backup/recovery, lifecycle, scalability constraints, and traceability without prematurely creating schema, SQL, Prisma, migration, or implementation artifacts.
