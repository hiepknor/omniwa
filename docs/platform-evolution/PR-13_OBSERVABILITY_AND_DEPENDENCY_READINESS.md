# PR-13 Observability And Dependency Readiness

## Status

Implemented.

## Scope

PR-13 makes the runtime platform more visible and operable without adding a
vendor-specific telemetry backend.

Implemented capabilities:

- Production metric catalog for PR-13 required runtime signals.
- Production alert definitions with runbook references.
- JSON-line structured log backend adapter.
- Text metrics exporter.
- Dependency health probe registration for:
  - PostgreSQL,
  - queue,
  - provider,
  - event log,
  - webhook dispatcher.
- Metrics Runtime smoke helper.
- Health Runtime readiness evaluator.
- Release readiness evidence for observability files and tests.
- Operational runbook.

## Metric Coverage

| Required Area             | Metric                           |
| ------------------------- | -------------------------------- |
| API latency               | `api.request.latency`            |
| Queue latency             | `queue.work.latency`             |
| Provider connection state | `provider.connection.state`      |
| Webhook success           | `webhook.delivery.success.total` |
| Worker utilization        | `worker.utilization.ratio`       |
| Event stream errors       | `event_stream.errors.total`      |

Metric labels are whitelist-based to avoid high-cardinality raw identifiers.

## Readiness Behavior

Critical dependency probes cause readiness to become `not_ready` when
unavailable.

Critical dependencies:

- `postgres`
- `queue`
- `event_log`
- `webhook_dispatcher`

Provider degradation marks global health as `degraded` because provider/account
failure can be scoped to affected instances.

## Alert Coverage

Alert definitions live in `packages/observability/src/alerts.ts`.

P0/P1 alert ids:

- `api_availability_degraded`
- `api_latency_degraded`
- `queue_backlog`
- `webhook_success_degraded`
- `provider_connection_degraded`
- `worker_utilization_saturated`
- `event_stream_errors`
- `dependency_not_ready`

Runbook:

- `docs/runbooks/OBSERVABILITY_AND_DEPENDENCY_READINESS.md`

## Validation

Targeted checks:

```text
pnpm exec vitest run packages/observability/src/metric-catalog.spec.ts packages/infrastructure-observability/src/observability-runtime-readiness.spec.ts apps/metrics/src/index.spec.ts apps/health/src/index.spec.ts
pnpm release:check
```

Full gate:

```text
pnpm check
```

## Residual Risk

This slice defines and tests the local runtime observability contracts. It does
not deploy Prometheus, OpenTelemetry, alert manager, or a centralized logging
backend. Those remain deployment/runtime integration work and must preserve the
same redaction, low-cardinality, and readiness rules.
