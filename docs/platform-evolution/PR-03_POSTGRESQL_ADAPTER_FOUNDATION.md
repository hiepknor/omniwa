# PR-03 - PostgreSQL Adapter Foundation

## Status

Implemented as a narrow production-readiness vertical slice.

This is not full production persistence. It adds the first PostgreSQL-backed repository adapter
behind an existing Domain repository port.

## Scope Implemented

| Area                       | Status   | Notes                                                                             |
| -------------------------- | -------- | --------------------------------------------------------------------------------- |
| PostgreSQL driver boundary | Complete | `pg` is used only inside `@omniwa/infrastructure-persistence`.                    |
| Migration runner           | Complete | Idempotent SQL migration runner with transaction-per-migration behavior.          |
| Instance repository        | Complete | `InstanceRepositoryPort` backed by PostgreSQL source-state storage.               |
| Runtime repository profile | Complete | `OMNIWA_API_REPOSITORY_PROFILE=postgresql` can wire API runtime to PostgreSQL.    |
| Local Docker PostgreSQL    | Complete | Local Compose includes PostgreSQL and defaults API runtime to PostgreSQL profile. |
| Repository contract test   | Complete | PostgreSQL contract test runs when `OMNIWA_POSTGRES_TEST_DATABASE_URL` is set.    |

## Boundary Rules Preserved

- Domain repository ports are unchanged.
- API still reaches persistence only through Interface Adapter -> Application -> Repository Port.
- No Prisma, ORM model, or public database identifier was introduced.
- PostgreSQL stores source state for the implemented aggregate and does not define Domain ownership.
- Durable JSON remains available as a fallback, but it is not a production source of truth.

## Migration Behavior

Local runtime can auto-run the idempotent migration when:

```text
OMNIWA_API_REPOSITORY_PROFILE=postgresql
OMNIWA_POSTGRES_AUTO_MIGRATE=true
```

Production templates keep auto-migration disabled by default:

```text
OMNIWA_POSTGRES_AUTO_MIGRATE=false
```

Production migration execution should be an explicit operational step until the broader migration
and backup process is complete.

## Verification

Targeted tests:

```sh
pnpm exec vitest run packages/infrastructure-persistence/src/postgresql-repositories.spec.ts
```

PostgreSQL-backed integration test with the local Docker stack:

```sh
OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa \
  pnpm exec vitest run packages/infrastructure-persistence/src/postgresql-repositories.spec.ts
```

## Remaining Work

- Add PostgreSQL adapters for the remaining repository ports.
- Add production transaction/unit-of-work boundaries across multi-aggregate workflows.
- Add operational migration command/runbook and backup-aware migration sequencing.
- Add query/index review for each additional repository adapter.
- Keep production runtime profile blocked until the other P0 adapters are complete.
