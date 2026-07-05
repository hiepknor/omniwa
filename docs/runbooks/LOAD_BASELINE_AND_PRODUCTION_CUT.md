# Load Baseline And Production Cut Runbook

## Purpose

This runbook defines the local load baseline and production cut gate for
OmniWA.

It supports Sprint PR-16 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

## Commands

Run the load baseline:

```text
pnpm load:check
```

Run the performance readiness gate:

```text
pnpm performance:check
```

Run the production cut gate:

```text
pnpm production:check
```

Run the target-environment evidence gate:

```text
pnpm target-env:check
```

Run the full quality gate:

```text
pnpm check
```

`pnpm check` must include `pnpm performance:check` before production and release readiness.

## Load Baseline

The load baseline is implemented in `apps/api/src/load-baseline.spec.ts`.

Scope:

- in-process API REST adapter,
- authenticated public requests,
- deterministic Application dispatcher,
- no external network,
- no real WhatsApp provider,
- no external database,
- no cloud dependency.

Budgets:

| Metric                   | Budget                 |
| ------------------------ | ---------------------- |
| Request count            | 400                    |
| P95 REST adapter latency | <= 50 ms               |
| Throughput               | >= 250 requests/second |
| 5xx error rate           | 0                      |

Failure means the local API adapter regression floor has degraded and the
change must not be merged until the regression is explained or the budget is
updated with review.

## Production Cut Gate

The production cut gate is implemented in
`tooling/production/check-production-cut.mjs`.

The target-environment evidence gate is implemented in
`tooling/production/check-target-environment-evidence.mjs`.

It verifies:

- `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` exists,
- target-environment proof state is explicit,
- every required runtime/dependency component has an evidence row,
- `docs/reviews/PRODUCTION_CUT_REVIEW.md` exists,
- final readiness decision is explicit,
- Production Ready state is explicit,
- target environment proof state is explicit,
- production load proof state is explicit,
- SLO evidence proof state is explicit,
- `PRODUCTION_READY` requires target environment, production load, and SLO
  evidence to be proven,
- load baseline summary exists,
- known constraints are documented,
- `performance:check` is wired through the root quality gate,
- `load:check` and `production:check` are wired in `package.json`,
- load tests cannot pass with no tests.

## Decision Semantics

Allowed final decisions:

- `NOT_READY`
- `CONDITIONALLY_READY`
- `PRODUCTION_READY`

Current decision:

- `CONDITIONALLY_READY`

This means OmniWA may proceed to controlled internal pilot hardening under the
constraints in `docs/reviews/PRODUCTION_CUT_REVIEW.md`.

It does not mean broad public production readiness.

Current target-environment evidence:

- `Target Environment Validation Status: NOT_PROVEN`
- `Target Environment Proven: NO`
- `Production Load Proven: NO`
- `SLO Evidence Proven: NO`

## Operator Checklist

Before promoting beyond the current conditional state:

- run `pnpm check`,
- review `docs/reviews/PRODUCTION_CUT_REVIEW.md`,
- confirm no critical security or reliability findings are open,
- confirm deployment-specific adapters and secrets are configured,
- confirm backup/restore drill evidence is fresh,
- confirm observability and dependency readiness are green,
- record any material change as an ADR before implementation.

## Failure Policy

| Failure                          | Response                                                   |
| -------------------------------- | ---------------------------------------------------------- |
| Load baseline regression         | Block merge and inspect API adapter or dispatcher changes. |
| Missing production decision      | Block release and complete production cut review.          |
| Missing known constraints        | Block release; production status must not be ambiguous.    |
| Missing load/production script   | Block release; restore root script wiring.                 |
| `--passWithNoTests` in load gate | Block release; load gate must run concrete tests.          |

## Residual Risk

The baseline is local and deterministic. It does not replace deployment load
testing, chaos testing, provider account health validation, external database
capacity testing, or sustained SLO observation.
