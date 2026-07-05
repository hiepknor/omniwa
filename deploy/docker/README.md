# OmniWA Docker Deployment

This directory contains Docker deployment artifacts for local runtime validation and server
deployment templates.

## Current Runtime Status

The Docker path can run the current local stack and now includes a production deployment template
for the API, worker, webhook dispatcher, provider runtime, PostgreSQL, and Redis. It does not make
OmniWA production-ready by itself.

Important current constraints:

- `apps/api` starts the public HTTP runtime.
- `apps/worker` starts a long-running worker loop entrypoint.
- `apps/webhook-dispatcher` starts a long-running dispatcher loop entrypoint and can compose with
  the production profile when PostgreSQL, durable queue, fetch gateway, signing secret, metrics, and
  audit sinks are configured.
- `apps/provider-runtime` starts the provider supervisor loop and local live helpers. Its production
  profile remains fail-closed; use `local` only for a controlled pilot until production auth-state
  encryption and distributed ownership evidence are complete.
- `apps/worker` production profile remains fail-closed until provider-runtime IPC/shared socket
  ownership is implemented. The production template uses a controlled-pilot profile for the worker.
- `OMNIWA_API_RUNTIME_PROFILE=production` is now composable only when PostgreSQL, Redis rate
  limiting, repository-backed ownership, audit records, durable queue, and metric sinks are
  configured.
- The current API runtime supports `in-memory`, `durable-json`, and `postgresql` repository
  profiles.
- The local Compose stack defaults to the PostgreSQL repository profile for currently implemented
  repositories.
- Durable JSON storage remains a development/bootstrap fallback and is not the approved production
  source of truth.
- PostgreSQL coverage now includes the runtime-exposed repositories and explicit migration commands.
  Some catalog ports and production migration evidence remain follow-up hardening.
- Redis is wired for API rate limiting in the production API profile.
- Object Storage remains an approved future production architecture component, but the current
  runtime does not wire it as a production adapter yet.

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

Run the repeatable local stack smoke check while the stack is running:

```sh
pnpm docker:smoke
```

The smoke check verifies that the API, worker, webhook dispatcher, and PostgreSQL services are
running, that the public health route returns the standard response envelope, that the API can
create an instance through the public contract, and that the created instance is persisted in the
local PostgreSQL database.

Override local values by exporting env vars or using `--env-file deploy/docker/env/local.env`.

The local Compose stack defaults to:

| Variable                                         | Default                              | Purpose                                       |
| ------------------------------------------------ | ------------------------------------ | --------------------------------------------- |
| `OMNIWA_API_REPOSITORY_PROFILE`                  | `postgresql`                         | Use PostgreSQL for implemented repos          |
| `OMNIWA_WORKER_REPOSITORY_PROFILE`               | `postgresql`                         | Use PostgreSQL for local worker recovery      |
| `OMNIWA_WORKER_LOOP_INTERVAL_MS`                 | `5000`                               | Worker polling interval in milliseconds       |
| `OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE`   | `durable-json`                       | Use durable JSON until webhook PG repos exist |
| `OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_STATE_DIR` | `/var/lib/omniwa/webhook-dispatcher` | Local dispatcher state directory              |
| `OMNIWA_WEBHOOK_DISPATCHER_LOOP_INTERVAL_MS`     | `5000`                               | Webhook dispatcher polling interval           |
| `OMNIWA_WEBHOOK_DISPATCHER_RETRY_DELAY_MS`       | `1000`                               | Local dispatcher retry delay                  |
| `OMNIWA_API_REPOSITORY_STATE_DIR`                | `/var/lib/omniwa/repositories`       | Container repository state directory          |
| `OMNIWA_POSTGRES_DATABASE_URL`                   | Compose-internal PostgreSQL URL      | API runtime PostgreSQL connection             |
| `OMNIWA_POSTGRES_AUTO_MIGRATE`                   | `true`                               | Run idempotent local migration on access      |
| `OMNIWA_POSTGRES_PUBLIC_PORT`                    | `55432`                              | Host port for optional integration tests      |
| `OMNIWA_EVENT_LOG_PATH`                          | `/var/lib/omniwa/event-log.json`     | Container realtime event-log path             |
| `OMNIWA_API_RUNTIME_PROFILE`                     | `local`                              | Keep the runtime in non-production mode       |

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
- Run `pnpm db:migrate:status` and `pnpm db:migrate` against the target PostgreSQL database before
  starting production-profile services. Keep `OMNIWA_POSTGRES_AUTO_MIGRATE=false`.
- Keep API EventLog on `OMNIWA_EVENT_LOG_BACKEND=postgresql`; do not use the JSON EventLog path for
  the production API profile.
- Use `OMNIWA_API_KEY_HASH` or a lifecycle store. Do not configure plaintext `OMNIWA_API_KEY` in the
  production template.
- Do not treat `OMNIWA_API_REPOSITORY_PROFILE=durable-json` as a production database substitute.
- Keep `OMNIWA_WORKER_RUNTIME_PROFILE=local` and `OMNIWA_PROVIDER_RUNTIME_PROFILE=local` only for a
  controlled internal pilot. These are not production-ready runtime profiles.
- Do not claim production readiness until `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`
  gates are satisfied.

## Expected Next Hardening

- Add provider-runtime IPC/shared socket ownership so the worker can run a true production profile.
- Add the production EventLog outbox consumer loop and backlog metrics beyond the API PostgreSQL
  EventLog backend.
- Add target-environment migration, backup, restore, load, and SLO evidence.
- Add image signing/SBOM/security scanning in CI.
