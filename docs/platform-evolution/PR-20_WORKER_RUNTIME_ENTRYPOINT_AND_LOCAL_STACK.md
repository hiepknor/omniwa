# PR-20 Worker Runtime Entrypoint And Local Stack

## Status

Implemented.

## Scope

PR-20 turns the existing Worker runtime composition into a runnable local process
and wires it into the Docker local stack.

Implemented capabilities:

- `apps/worker` exposes a direct Node entrypoint.
- `WorkerRuntimeLoop` repeatedly recovers visible persisted jobs before each
  runtime tick.
- The worker loop supports clean `SIGINT` and `SIGTERM` shutdown.
- Local Docker Compose now starts both API and Worker services from the shared
  `omniwa:local` image.
- Regression and release gates require the worker loop test evidence.

## Runtime Boundary

The worker loop keeps the approved platform boundary:

```text
Worker Process
  -> WorkerRuntimeApp
  -> WorkerRuntime
  -> QueueProviderPort
  -> ApplicationDispatcher
  -> Application Commands
```

The worker does not call API routes and does not contain business logic.

## Local Docker Runtime

The local Compose stack now runs:

- API service on `apps/api/dist/index.js`.
- Worker service on `apps/worker/dist/index.js`.
- PostgreSQL for implemented repository slices.

The worker service uses the local runtime profile and a configurable polling
interval:

```text
OMNIWA_WORKER_RUNTIME_PROFILE=local
OMNIWA_WORKER_REPOSITORY_PROFILE=postgresql
OMNIWA_WORKER_LOOP_INTERVAL_MS=5000
```

## Production Constraint

This slice does not unlock `OMNIWA_WORKER_RUNTIME_PROFILE=production`.

Production readiness still requires the remaining production adapter evidence
tracked by `docs/platform-evolution/PR-19_PRODUCTION_READY_GATE_REVIEW.md`.

## Verification

Targeted checks:

```text
pnpm exec vitest run apps/worker/src/worker-loop.spec.ts apps/worker/src/runtime-composition.spec.ts apps/worker/src/worker-runtime.spec.ts apps/worker/src/worker-application-handlers.spec.ts
```

Full gate:

```text
pnpm check
```
