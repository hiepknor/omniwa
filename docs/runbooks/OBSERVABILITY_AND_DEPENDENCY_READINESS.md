# Observability And Dependency Readiness Runbook

## Purpose

This runbook defines the first production-ready smoke path for OmniWA
observability and dependency readiness.

It supports Sprint PR-13 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

## Runtime Scope

Covered runtime roles:

- API Runtime
- Worker Runtime
- Provider Runtime
- Webhook Runtime
- Metrics Runtime
- Health Runtime

Covered dependency probes:

- `postgres`
- `queue`
- `provider`
- `event_log`
- `webhook_dispatcher`

Critical probes:

- `postgres`
- `queue`
- `event_log`
- `webhook_dispatcher`

Provider is non-critical for global health readiness because provider/account
failure can be isolated to affected instances, but it still marks the health
runtime degraded.

## Metrics

The approved PR-13 metric catalog is implemented in
`packages/observability/src/metric-catalog.ts`.

| Metric                           | Runtime  | Purpose                                                   | Alert                                               |
| -------------------------------- | -------- | --------------------------------------------------------- | --------------------------------------------------- |
| `api.request.latency`            | API      | API latency and error/availability grouping               | `api_availability_degraded`, `api_latency_degraded` |
| `queue.work.latency`             | Worker   | Queue work latency and backlog signal                     | `queue_backlog`                                     |
| `provider.connection.state`      | Provider | Provider connection state without raw account identifiers | `provider_connection_degraded`                      |
| `webhook.delivery.success.total` | Webhook  | Webhook success/failure signal                            | `webhook_success_degraded`                          |
| `worker.utilization.ratio`       | Worker   | Worker saturation signal                                  | `worker_utilization_saturated`                      |
| `event_stream.errors.total`      | API      | SSE/event stream failure signal                           | `event_stream_errors`                               |

Metric labels must use the approved low-cardinality label allowlist from the
metric catalog. Raw instance IDs, phone numbers, JIDs, message bodies, webhook
URLs, provider payload IDs, session material, API keys, and secrets are not
valid metric labels.

## Alerts

Alert definitions are implemented in `packages/observability/src/alerts.ts`.

### API Availability

Alert id:

- `api_availability_degraded`

Operator response:

1. Check `/v1/health/readiness`.
2. Check API 5xx/error category trend.
3. Confirm PostgreSQL and auth boundary readiness.
4. Apply rollback if the issue started after a deploy.

### API Latency

Alert id:

- `api_latency_degraded`

Operator response:

1. Check `api.request.latency` by normalized route and outcome.
2. Separate OmniWA-controlled latency from provider/downstream behavior.
3. Check queue pressure and persistence readiness.

### Queue Backlog

Alert id:

- `queue_backlog`

Operator response:

1. Check queue readiness and worker readiness.
2. Check `queue.work.latency` and queue depth snapshots.
3. Scale worker capacity or apply backpressure.
4. Confirm accepted work remains visible.

### Webhook Success

Alert id:

- `webhook_success_degraded`

Operator response:

1. Separate receiver failures from OmniWA transport failures.
2. Check webhook dispatcher readiness.
3. Inspect retry and dead-letter growth.
4. Confirm webhook signing/replay verification remains enabled.

### Provider Connection

Alert id:

- `provider_connection_degraded`

Operator response:

1. Identify affected instances through safe status projections.
2. Avoid aggressive reconnect loops.
3. Mark action-required where provider/account health requires operator input.
4. Preserve session secrecy in all logs.

### Worker Utilization

Alert id:

- `worker_utilization_saturated`

Operator response:

1. Check worker process readiness.
2. Review utilization by approved worker type only.
3. Increase worker capacity or reduce intake.
4. Watch retry and dead-letter metrics.

### Event Stream Errors

Alert id:

- `event_stream_errors`

Operator response:

1. Check SSE/event stream API errors.
2. Confirm event log readiness.
3. Verify clients are not reconnecting excessively.
4. Preserve cursor/correlation diagnostics without logging payloads.

### Dependency Readiness

Alert id:

- `dependency_not_ready`

Operator response:

1. Inspect health checks for the unavailable critical dependency.
2. Keep readiness `not_ready` until dependency safety is restored.
3. Do not accept work that depends on unavailable durable state or queue
   visibility.
4. Record incident evidence without logging secrets.

## Smoke Checks

Run:

```text
pnpm exec vitest run packages/observability/src/metric-catalog.spec.ts packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts apps/metrics/src/index.spec.ts apps/health/src/index.spec.ts
pnpm release:check
```

Full gate:

```text
pnpm check
```

## Failure Policy

- Liveness remains shallow and local.
- Readiness must fail closed when critical dependencies are unavailable.
- Non-critical provider degradation can degrade global health without blocking
  all platform traffic.
- Observability failure must be visible but must not mutate product state.
- Any suspected telemetry redaction failure is a production incident.
