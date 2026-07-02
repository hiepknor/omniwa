# PR-05 - Worker Runtime Vertical Slice

## Status

Implemented as an incremental worker execution slice.

This is not the final production worker profile. It adds a Worker app boundary, an Application
command handler registry, local/runtime composition, and tests that prove queued work can move
through Worker -> Application -> QueueProvider -> WorkerJobRepository without calling the API layer.

## Scope Implemented

| Area                         | Status   | Notes                                                                                            |
| ---------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Worker app boundary          | Complete | `WorkerRuntimeApp` wraps `WorkerRuntime`, context creation, and queue recovery.                  |
| Application handler registry | Complete | Queue work types map to approved internal Application worker commands.                           |
| Runtime composition          | Complete | Local/test worker composition supports in-memory, durable JSON, and PostgreSQL repository modes. |
| Durable job vertical slice   | Complete | E2E test covers enqueue -> worker -> Application dispatcher -> WorkerJob repository state.       |
| Regression coverage          | Complete | Worker composition and handler registry specs are part of `pnpm regression:check`.               |

## Worker Command Mapping

| Queue Work Type     | Application Command          |
| ------------------- | ---------------------------- |
| `outbound_message`  | `ProcessOutboundMessageWork` |
| `media_processing`  | `ProcessMediaWork`           |
| `webhook_delivery`  | `DeliverWebhookWork`         |
| `reconnect`         | `ReconnectInstance`          |
| `retention_cleanup` | `CleanupMediaRetention`      |
| `health_refresh`    | `RefreshHealthStatus`        |

## Boundary Rules Preserved

- Worker runtime does not call REST, Interface API, or API route handlers.
- Worker handlers call `ApplicationDispatcher` with approved internal commands.
- Queue execution remains behind `QueueProviderPort`.
- Worker job lifecycle remains persisted through `WorkerJobRepositoryPort`.
- Production runtime profile remains blocked until distributed queue, provider, secret, and
  observability adapters are complete.

## Runtime Configuration

Worker profile:

```text
OMNIWA_WORKER_RUNTIME_PROFILE=local|test|production
```

Repository profile:

```text
OMNIWA_WORKER_REPOSITORY_PROFILE=in-memory|durable-json|postgresql
```

For local Docker-style shared configuration, the worker can fall back to:

```text
OMNIWA_API_REPOSITORY_PROFILE
```

Durable JSON requires:

```text
OMNIWA_WORKER_REPOSITORY_STATE_DIR=/path/to/state
```

PostgreSQL requires:

```text
OMNIWA_POSTGRES_DATABASE_URL=postgresql://...
OMNIWA_POSTGRES_AUTO_MIGRATE=false
```

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  apps/worker/src/worker-runtime.spec.ts \
  apps/worker/src/worker-application-handlers.spec.ts \
  apps/worker/src/runtime-composition.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Implement real Application command handlers for worker commands.
- Add distributed production queue adapter with cross-process leasing.
- Add worker runtime process entrypoint and graceful shutdown loop.
- Add production observability for worker attempts, retries, dead letters, and handler latency.
- Keep production worker profile blocked until distributed queue, provider, production secret
  manager, and observability adapters are complete.
