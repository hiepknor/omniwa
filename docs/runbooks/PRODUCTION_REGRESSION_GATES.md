# Production Regression Gates Runbook

## Purpose

This runbook defines the local production regression gate required before
OmniWA moves from implementation work toward production readiness.

It supports Sprint PR-15 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

## Gate Command

Run the deterministic E2E gate:

```text
pnpm e2e:check
```

Run the deterministic security gate:

```text
pnpm security:check
```

Run the targeted production regression gate:

```text
pnpm regression:check
```

Run the full quality gate:

```text
pnpm check
```

`pnpm check` must include `pnpm security:check`, `pnpm e2e:check`, and `pnpm regression:check`
before release readiness.

## Coverage

The gate is intentionally deterministic. It must not call the real WhatsApp
network, external webhook receivers, production databases, or cloud services.

Required coverage:

- Security-control evidence for API auth, API-key lifecycle, rate limiting, security audit
  evidence, resource ownership, webhook signing/replay, redaction, object-path secrecy, and
  Baileys auth-state safety.
- Local vertical slice proof for Application, durable JSON state, queue, worker, provider fake
  socket, and EventLog safety.
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

- `tooling/security/check-security-readiness.mjs`
- `tooling/security/check-security-readiness.spec.ts`
- `tooling/e2e/check-e2e-readiness.mjs`
- `tooling/e2e/check-e2e-readiness.spec.ts`
- `tooling/regression/check-production-regression.mjs`
- `tooling/regression/check-production-regression.spec.ts`

HTTP E2E/security regression:

- `apps/api/src/platform-regression.spec.ts`
- `apps/background/src/local-vertical-slice-demo.spec.ts`

Root script:

- `security:check`
- `e2e:check`
- `regression:check`

Release gate:

- `tooling/release/check-readiness.mjs`

## Failure Policy

| Failure                          | Operator Response                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Missing security script          | Block merge; restore `security:check`.                                            |
| Missing E2E script               | Block merge; restore `e2e:check`.                                                 |
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
