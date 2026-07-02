# OmniWA Docker Deployment

This directory contains Docker deployment artifacts for local runtime validation and server
deployment templates.

## Current Runtime Status

The Docker path can run the current API runtime. It does not make OmniWA production-ready by itself.

Important current constraints:

- `apps/api` is the only HTTP runtime entrypoint that starts a long-running server today.
- `apps/worker` now has a long-running worker loop entrypoint for local runtime validation.
- `OMNIWA_API_RUNTIME_PROFILE=production` is intentionally blocked by the code until production
  persistence, queue, secret, and observability adapters are wired.
- The current API runtime supports `in-memory`, `durable-json`, and `postgresql` repository
  profiles.
- The local Compose stack defaults to the PostgreSQL repository profile for the current
  `InstanceRepositoryPort` vertical slice.
- Durable JSON storage remains a development/bootstrap fallback and is not the approved production
  source of truth.
- PostgreSQL coverage is still partial: the first implemented source-state adapter is Instance and
  WorkerJob. Health/readiness still uses a local in-memory projection fallback. Additional
  repositories, production queue, secrets, observability, and provider runtime work remain required
  before claiming production readiness.
- PostgreSQL, Redis, and Object Storage remain required production architecture components, but the
  current runtime does not wire them as production adapters yet.

## Local

Run commands from the repository root.

Run the local stack:

```sh
docker compose -f deploy/docker/compose.local.yml up --build
```

Then call:

```sh
curl -H "x-api-key: local-dev-secret-change-me" http://localhost:3000/v1/health
```

Override local values by exporting env vars or using `--env-file deploy/docker/env/local.env`.

The local Compose stack defaults to:

| Variable                           | Default                          | Purpose                                  |
| ---------------------------------- | -------------------------------- | ---------------------------------------- |
| `OMNIWA_API_REPOSITORY_PROFILE`    | `postgresql`                     | Use PostgreSQL for implemented repos     |
| `OMNIWA_WORKER_REPOSITORY_PROFILE` | `postgresql`                     | Use PostgreSQL for local worker recovery |
| `OMNIWA_WORKER_LOOP_INTERVAL_MS`   | `5000`                           | Worker polling interval in milliseconds  |
| `OMNIWA_API_REPOSITORY_STATE_DIR`  | `/var/lib/omniwa/repositories`   | Container repository state directory     |
| `OMNIWA_POSTGRES_DATABASE_URL`     | Compose-internal PostgreSQL URL  | API runtime PostgreSQL connection        |
| `OMNIWA_POSTGRES_AUTO_MIGRATE`     | `true`                           | Run idempotent local migration on access |
| `OMNIWA_POSTGRES_PUBLIC_PORT`      | `55432`                          | Host port for optional integration tests |
| `OMNIWA_EVENT_LOG_PATH`            | `/var/lib/omniwa/event-log.json` | Container realtime event-log path        |
| `OMNIWA_API_RUNTIME_PROFILE`       | `local`                          | Keep the runtime in non-production mode  |

Run PostgreSQL-backed repository integration tests against the local stack:

```sh
OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa \
  pnpm exec vitest run packages/infrastructure-persistence/src/postgresql-repositories.spec.ts
```

## Production Template

Build and tag an image:

```sh
docker build -f deploy/docker/Dockerfile -t ghcr.io/your-org/omniwa:replace-with-version .
```

Deploy with:

```sh
docker compose --env-file deploy/docker/env/production.env -f deploy/docker/compose.production.yml up -d
```

Production template rules:

- Bind the API to `127.0.0.1` and put a reverse proxy/TLS layer in front of it.
- Store real env values outside git.
- Keep PostgreSQL, Redis, Object Storage, and backup storage private.
- Do not set `OMNIWA_API_RUNTIME_PROFILE=production` until the P0 production adapters are complete.
- Do not treat `OMNIWA_API_REPOSITORY_PROFILE=durable-json` as a production database substitute.
- Keep `OMNIWA_POSTGRES_AUTO_MIGRATE=false` unless an explicit migration operation has been
  approved for that environment.
- Do not claim production readiness until `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`
  gates are satisfied.

## Expected Next Hardening

- Add production PostgreSQL repository adapter wiring.
- Add production queue wiring.
- Add runtime-specific containers for worker, scheduler, provider, webhook dispatcher, projection,
  metrics, and health once their entrypoints are long-running processes.
- Add backup and restore automation.
- Add image signing/SBOM/security scanning in CI.
