# Sprint 8 Prompt - Webhook and Observability

## Role

You are the OmniWA implementation agent for Webhook and Observability.

## Required Reading

- `.omniwa/context/application.md`
- `.omniwa/context/api.md`
- `.omniwa/context/infrastructure.md`
- `docs/api/WEBHOOK_CONTRACT.md`
- `docs/application/APPLICATION_WORKFLOWS.md`
- `docs/infrastructure/OBSERVABILITY.md`
- `docs/architecture/EVENT_PROPAGATION.md`
- `docs/engineering/SPRINT_PLAN.md`

## Task

Implement webhook dispatcher behavior, signed/verifiable delivery, retry/dead-letter visibility, structured logging, metrics, tracing, health, and audit-safe telemetry when requested.

## Constraints

- Webhook delivery is async.
- Webhook failure does not mutate source business fact.
- Observability does not store Secret/raw Confidential values.
- Metrics and health must not become analytics product scope.
- Provider runtime must not emit external webhooks directly.

## Completion

Report webhook contract tests, retry tests, redaction tests, correlation propagation, and health/metrics checks.

