# PR-04 - Production Queue Foundation

## Status

Implemented as a narrow production-readiness foundation.

This is not the final distributed production queue adapter. It hardens the queue path by adding a
PostgreSQL-backed `WorkerJobRepositoryPort` source of truth and making queue idempotency recording
safe for asynchronous repository adapters.

## Scope Implemented

| Area                              | Status   | Notes                                                                                     |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| WorkerJob PostgreSQL persistence  | Complete | `WorkerJobRepositoryPort` now has a PostgreSQL adapter and migration.                     |
| Queue idempotency persistence     | Complete | Optional `recordIdempotencyKey` can be asynchronous and is awaited by the queue provider. |
| Repository contract coverage      | Complete | WorkerJob repository contract now runs against in-memory, durable JSON, and PostgreSQL.   |
| PostgreSQL integration coverage   | Complete | WorkerJob contract runs against the local PostgreSQL stack when test URL is provided.     |
| Queue provider boundary preserved | Complete | `QueueProviderPort` and Worker runtime contracts are unchanged.                           |

## Boundary Rules Preserved

- Queue behavior remains behind `QueueProviderPort`.
- Worker job lifecycle remains a Domain aggregate concern.
- No queue implementation details are exposed through REST, SDK, or Application catalogs.
- No Redis or queue engine dependency was introduced without a new ADR.
- PostgreSQL stores WorkerJob source state but does not own worker orchestration logic.

## Current Runtime Semantics

The existing in-memory queue provider still owns process-local reservation state:

- enqueue,
- reserve,
- acknowledge,
- release for retry,
- move to dead letter,
- recover visible queued/retrying jobs from `WorkerJobRepositoryPort`.

With `PostgresqlWorkerJobRepository`, queued and retrying jobs can be recovered from PostgreSQL
after runtime restart through the existing queue recovery path. Cross-process leasing remains a
separate production adapter concern.

## Migration Behavior

The default PostgreSQL migration runner now includes:

```text
pgm_20260702_0001_instance_repository
pgm_20260702_0002_worker_job_repository
```

Local runtime can auto-run both migrations when:

```text
OMNIWA_API_REPOSITORY_PROFILE=postgresql
OMNIWA_POSTGRES_AUTO_MIGRATE=true
```

Production templates should keep auto-migration disabled and run migrations as an explicit
operational step.

## Verification

Targeted queue and repository tests:

```sh
pnpm exec vitest run \
  packages/infrastructure-persistence/src/postgresql-repositories.spec.ts \
  packages/infrastructure-persistence/src/in-memory-repositories.spec.ts \
  packages/infrastructure-persistence/src/durable-json-repositories.spec.ts \
  packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts
```

PostgreSQL-backed integration test with the local Docker stack:

```sh
OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa \
  pnpm exec vitest run packages/infrastructure-persistence/src/postgresql-repositories.spec.ts
```

## Remaining Work

- Add a distributed production queue adapter with cross-process leasing.
- Add queue metrics for reservation age, retries, dead letters, and depth by work type.
- Add operational dead-letter inspection and replay workflows.
- Keep production runtime profile blocked until distributed queue, provider, production secret
  manager, and observability adapters are complete.
