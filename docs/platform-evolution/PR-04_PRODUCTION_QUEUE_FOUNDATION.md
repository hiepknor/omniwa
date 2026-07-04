# PR-04 - Production Queue Foundation

## Status

Implemented as a narrow production-readiness foundation.

This is not the final distributed production queue adapter. It hardens the queue path by adding a
durable `WorkerJobRepositoryPort`-backed queue provider that no longer depends on process-local
queue entries for basic reservation, acknowledgement, retry, and dead-letter state. PostgreSQL
WorkerJob remains the approved durable source for exposed runtime paths.

## Scope Implemented

| Area                              | Status   | Notes                                                                                     |
| --------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| WorkerJob PostgreSQL persistence  | Complete | `WorkerJobRepositoryPort` now has a PostgreSQL adapter and migration.                     |
| Queue idempotency persistence     | Complete | Optional `recordIdempotencyKey` can be asynchronous and is awaited by the queue provider. |
| Repository contract coverage      | Complete | WorkerJob repository contract now runs against in-memory, durable JSON, and PostgreSQL.   |
| PostgreSQL integration coverage   | Complete | WorkerJob contract runs against the local PostgreSQL stack when test URL is provided.     |
| Durable queue provider foundation | Complete | `DurableWorkerJobQueueProvider` reserves work directly from `WorkerJobRepositoryPort`.    |
| Queue provider boundary preserved | Complete | `QueueProviderPort` and Worker runtime contracts are unchanged.                           |

## Boundary Rules Preserved

- Queue behavior remains behind `QueueProviderPort`.
- Worker job lifecycle remains a Domain aggregate concern.
- No queue implementation details are exposed through REST, SDK, or Application catalogs.
- No Redis or queue engine dependency was introduced without a new ADR.
- PostgreSQL stores WorkerJob source state but does not own worker orchestration logic.

## Current Runtime Semantics

Two queue providers now exist behind `QueueProviderPort`:

- `InMemoryQueueProvider` for deterministic tests/local behavior.
- `DurableWorkerJobQueueProvider` for the N11 queue foundation.

`DurableWorkerJobQueueProvider` supports:

- enqueue,
- reserve from durable WorkerJob state,
- acknowledge,
- release for retry,
- move to dead letter,
- restart recovery of interrupted reserved/running jobs,
- regression coverage through `pnpm regression:check`.

Worker runtime can select it with:

```text
OMNIWA_WORKER_QUEUE_PROFILE=durable-worker-job
```

Cross-process atomic leasing remains a separate production hardening concern.

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
  packages/infrastructure-queue/src/durable-worker-job-queue-provider.spec.ts \
  packages/infrastructure-queue/src/in-memory-queue-provider.spec.ts
```

PostgreSQL-backed integration test with the local Docker stack:

```sh
OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa \
  pnpm exec vitest run packages/infrastructure-persistence/src/postgresql-repositories.spec.ts
```

## Remaining Work

- Add cross-process atomic leasing for multi-worker production runtime.
- Add queue metrics for reservation age and oldest pending age by work type.
- Add operational dead-letter inspection and replay workflows.
- Keep production runtime profile blocked until distributed queue, provider, production secret
  manager, and observability adapters are complete.
