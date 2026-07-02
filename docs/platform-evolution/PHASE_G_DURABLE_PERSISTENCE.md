# Phase G - Durable Persistence Review And Adapter

## Purpose

Phase G adds a durable persistence adapter without changing Domain,
Application, API, repository ports, physical schema decisions, or migration
strategy.

The implementation is intentionally incremental: it provides a file-backed JSON
adapter that preserves existing repository port semantics and projection store
semantics. It is a platform stepping stone and contract test target before a
future PostgreSQL implementation.

## Required Context

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/persistence/REPOSITORY_MAPPING.md`
- `docs/persistence/PHYSICAL_PERSISTENCE.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`

## Deliverables

| Deliverable                         | Status   | Notes                                                      |
| ----------------------------------- | -------- | ---------------------------------------------------------- |
| Physical model review preserved     | Complete | No schema, SQL, Prisma, migration, or database table added |
| Durable repository adapter          | Complete | Added file-backed JSON repository set for existing ports   |
| Durable projection store            | Complete | Added file-backed JSON read projection store               |
| Local runtime repository profile    | Complete | `apps/api` can opt into durable JSON repositories by env   |
| Repository port semantics preserved | Complete | Adapter implements existing repository ports               |
| Rollback strategy                   | Complete | Adapter is additive; in-memory adapters remain available   |
| Contract tests                      | Complete | Restart tests cover aggregate/index/projection restoration |

## Implementation Scope

Added implementation:

- `DurableJsonAggregateRepository`
- `createDurableJsonRepositorySet`
- `DurableJsonReadProjectionStore`
- `createDurableJsonReadProjectionStore`
- shared `DurableJsonStateStore`
- `OMNIWA_API_REPOSITORY_PROFILE=durable-json` runtime composition support
- `OMNIWA_API_REPOSITORY_STATE_DIR` for local or controlled pilot state paths

No implementation was added for:

- PostgreSQL schema,
- SQL migrations,
- Prisma models,
- Redis permanent storage,
- object storage business metadata,
- repository query expansion beyond approved ports.

## Adapter Boundary

The durable JSON adapter:

- persists aggregate state by repository ownership,
- persists implementation-only indexes required by existing repository methods,
- persists read projections as derived state,
- writes state atomically through temporary-file replace,
- stays inside `packages/infrastructure-persistence`,
- does not contain business rules,
- does not mutate Domain behavior,
- does not leak persistence model into Domain or Application.

## Rollback

Rollback is adapter-level:

1. Stop wiring runtime to `createDurableJsonRepositorySet`.
2. Set `OMNIWA_API_REPOSITORY_PROFILE=in-memory`.
3. Remove or archive the JSON state directory.
4. No Domain/Application/API migration is required.

## Risks

| Risk                                      | Mitigation                                                         |
| ----------------------------------------- | ------------------------------------------------------------------ |
| JSON adapter is not production PostgreSQL | Treat as durable contract adapter, not final physical data layer   |
| Concurrent writes can serialize poorly    | Future PostgreSQL adapter remains required for production scaling  |
| File storage lacks query/index tuning     | Approved repository methods are narrow; future DB indexes are next |
| Sensitive data persistence                | Adapter stores only what repositories receive; freeze rules remain |

## Exit Criteria

| Criteria                                   | Status |
| ------------------------------------------ | ------ |
| No schema/migration created                | PASS   |
| Repository ports still unchanged           | PASS   |
| Durable aggregate repository adapter added | PASS   |
| Local runtime can select durable JSON      | PASS   |
| Durable read projection store added        | PASS   |
| Implementation-only indexes persist        | PASS   |
| Restart/re-instantiation behavior tested   | PASS   |
| In-memory adapter remains available        | PASS   |

**Phase G is complete.**

Recommended next phase: Phase H - Groups Domain Addendum.
