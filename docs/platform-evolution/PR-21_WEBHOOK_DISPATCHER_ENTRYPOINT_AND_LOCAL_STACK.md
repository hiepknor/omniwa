# PR-21 Webhook Dispatcher Entrypoint And Local Stack

## Status

Implemented.

## Scope

PR-21 turns the existing Webhook Dispatcher runtime composition into a runnable
local process and wires it into the Docker local stack.

Implemented capabilities:

- `apps/webhook-dispatcher` exposes a direct Node entrypoint.
- `WebhookDispatcherLoop` recovers visible persisted webhook delivery jobs
  before each dispatch tick when the queue provider supports recovery.
- The dispatcher loop supports clean `SIGINT` and `SIGTERM` shutdown.
- Local Docker Compose now starts API, Worker, and Webhook Dispatcher services
  from the shared `omniwa:local` image.
- Regression and release gates require webhook dispatcher loop and composition
  test evidence.

## Runtime Boundary

The dispatcher loop keeps the approved platform boundary:

```text
Webhook Dispatcher Process
  -> WebhookDispatcherApp
  -> WebhookDispatcherRuntime
  -> QueueProviderPort
  -> WebhookTransportPort
```

The dispatcher does not call API routes and does not contain business logic.

## Local Docker Runtime

The local Compose stack now runs:

- API service on `apps/api/dist/index.js`.
- Worker service on `apps/worker/dist/index.js`.
- Webhook Dispatcher service on `apps/webhook-dispatcher/dist/index.js`.
- PostgreSQL for implemented source-state slices.

Webhook Dispatcher local state uses durable JSON because PostgreSQL
`WebhookSubscriptionRepositoryPort` and `WebhookDeliveryRepositoryPort` adapters
are not implemented yet.

## Production Constraint

This slice does not unlock
`OMNIWA_WEBHOOK_DISPATCHER_RUNTIME_PROFILE=production`.

The local dispatcher composition uses a fail-closed webhook transport until the
real outbound HTTP gateway, secret wiring, production queue, and observability
adapters are complete.

Production readiness remains constrained by
`docs/platform-evolution/PR-19_PRODUCTION_READY_GATE_REVIEW.md`.

## Verification

Targeted checks:

```text
pnpm exec vitest run apps/webhook-dispatcher/src/webhook-dispatcher-loop.spec.ts apps/webhook-dispatcher/src/runtime-composition.spec.ts apps/webhook-dispatcher/src/webhook-dispatcher-app.spec.ts packages/infrastructure-webhook/src/webhook-dispatcher-runtime.spec.ts
```

Full gate:

```text
pnpm check
```
