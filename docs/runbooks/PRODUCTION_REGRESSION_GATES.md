# Production Regression Gates Runbook

## Purpose

This runbook defines the local production regression gate required before
OmniWA moves from implementation work toward production readiness.

It supports Sprint PR-15 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

## Gate Command

Run the targeted production regression gate:

```text
pnpm regression:check
```

Run the full quality gate:

```text
pnpm check
```

`pnpm check` must include `pnpm regression:check` before release readiness.

## Coverage

The gate is intentionally deterministic. It must not call the real WhatsApp
network, external webhook receivers, production databases, or cloud services.

Required coverage:

- REST transport to Application adapter regression.
- Public response and error envelopes.
- API key authentication.
- Scope authorization.
- Resource ownership authorization.
- Rate limiting.
- Runtime composition safety.
- Application command/query boundaries.
- Domain contract regression.
- Durable persistence adapter regression.
- Queue visibility and recovery regression.
- Provider adapter and provider runtime safety.
- Worker runtime regression.
- Webhook signing, replay protection, transport, dispatcher, retry, and dead
  letter regression.
- Redaction and observability readiness.
- Object storage secret-safety regression.

## Security Rules

Regression tests must fail when:

- auth is missing or invalid,
- required scopes are missing,
- resource ownership cannot be proven,
- rate limits are exceeded,
- webhook signatures are invalid or replayed,
- raw API keys, session material, webhook secrets, provider payloads, or
  confidential identifiers leak into public responses, logs, metrics, object
  paths, or errors.

## Evidence

Gate implementation:

- `tooling/regression/check-production-regression.mjs`
- `tooling/regression/check-production-regression.spec.ts`

HTTP E2E/security regression:

- `apps/api/src/platform-regression.spec.ts`

Root script:

- `regression:check`

Release gate:

- `tooling/release/check-readiness.mjs`

## Failure Policy

| Failure                          | Operator Response                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Missing regression script        | Block merge; restore `regression:check`.                                          |
| Missing required test            | Block merge; add or restore the required regression spec.                         |
| `--passWithNoTests` in gate      | Block merge; regression gate must require real tests.                             |
| Auth/security regression failure | Treat as P0 until fixed.                                                          |
| E2E regression failure           | Treat as production blocker for affected capability.                              |
| Redaction regression failure     | Treat as security incident and rotate affected synthetic fixture names if needed. |

## Residual Risk

This gate proves the current deterministic production regression surface. It is
not a substitute for deployment-specific smoke tests, load tests, external
penetration testing, or real backup/restore drills.
