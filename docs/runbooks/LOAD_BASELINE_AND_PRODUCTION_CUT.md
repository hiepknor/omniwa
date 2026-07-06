# Load Baseline And Production Cut Runbook

## Purpose

This runbook defines the local load baseline and production cut gate for
OmniWA.

It supports Sprint PR-16 from
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md`.

For the complete operator sequence, use
`docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md`.

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

Run the optional target-environment API smoke against a deployed API:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
pnpm target-env:smoke
```

Run the optional target-environment API load probe against a deployed API:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_LOAD_REQUESTS=120 \
OMNIWA_TARGET_ENV_LOAD_CONCURRENCY=10 \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
pnpm target-env:load
```

Normalize optional target-environment runtime evidence from a sanitized operator-maintained input:

```text
mkdir -p artifacts/target-env

cp docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json \
  artifacts/target-env/runtime-evidence-input.json

OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH=artifacts/target-env/runtime-evidence-input.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
pnpm target-env:runtime
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

The optional target-environment smoke runner is implemented in
`tooling/production/run-target-environment-smoke.mjs`. It checks `/v1/health`,
`/v1/health/readiness`, and `/v1/instances`, verifies that successful responses preserve the public
response envelope and request/correlation metadata, then writes a sanitized JSON summary to stdout.
When `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` is set, it also writes the same sanitized JSON to that
artifact path for review evidence. The summary intentionally excludes the base URL, API key,
response bodies, raw IDs, provider payloads, and secrets.

The optional target-environment load runner is implemented in
`tooling/performance/run-target-environment-load.mjs`. It performs bounded authenticated GET load
against the same approved public endpoint set and writes a sanitized summary to stdout. When
`OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` is set, it writes the same sanitized JSON to that artifact path
for review evidence. The summary includes aggregate counts and latency budgets only; it excludes the
base URL, API key, response bodies, raw IDs, query strings, provider payloads, and secrets.

The optional target-environment runtime evidence runner is implemented in
`tooling/production/run-target-environment-runtime-evidence.mjs`. Start from
`docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json`, copy it to an external
operator artifact path, and populate only sanitized booleans, safe refs, timestamps, and safe error
codes. The runner normalizes that input into `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH` and
keeps status failed unless every runtime, dependency, and backup/restore check passes without
blocker findings. The input and report must not contain target URLs, database or Redis connection
strings, API keys, raw runtime logs, QR payloads, JIDs, message text, provider payloads, auth state,
session material, webhook secrets, or secret-provider values.

When any target-environment artifact path environment variable is present, `pnpm target-env:check`
also validates the referenced smoke/load/runtime artifact JSON shape and rejects unsafe fields such
as URLs, API keys, raw payloads, QR values, JIDs, text, auth state, and session material. This
validation is local-only; it does not run target-environment traffic.

Operators can also provide `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH` to validate a sanitized evidence
bundle manifest. The bundle records references to deployment profile, runtime versions, startup
summary, health/readiness, dependency connectivity, backup/restore drill, production-load summary,
alert/SLO dry-run, rollback or forward-fix notes, and smoke/load artifacts without storing raw
environment values. Start from
`docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json` and write the populated copy outside
the design/review source tree before passing its path to the gate. The helper command below creates
that initial copy and can embed sanitized smoke/load summaries if their report path variables are
also set:

```text
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:bundle
```

When validating a populated bundle with `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`, the bundle status,
proof flags, and component statuses must match `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md`.
Update both together during a target-environment review; do not let an external bundle claim a
readiness state that the review document does not claim.

It verifies:

- `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` exists,
- `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json` remains a safe `NOT_PROVEN`
  skeleton,
- `docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json` remains a safe failed
  skeleton,
- target-environment proof state is explicit,
- every required runtime/dependency component has an evidence row,
- optional target-environment smoke artifacts are schema-valid, sanitized, and produced by a runner
  that validates public response envelope/request metadata on successful responses,
- optional target-environment runtime evidence artifacts are schema-valid and sanitized,
- optional target-environment evidence bundle artifacts are schema-valid and sanitized,
- optional target-environment evidence bundle status matches the review document,
- `docs/reviews/PRODUCTION_CUT_REVIEW.md` exists,
- final readiness decision is explicit,
- Production Ready state is explicit,
- target environment proof state is explicit,
- production-cut review acknowledges the target-environment smoke workflow,
- production load proof state is explicit,
- SLO evidence proof state is explicit,
- production-cut review acknowledges the target-environment bundle workflow,
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

The optional target-environment load runner also does not replace sustained SLO
observation. It provides a bounded operator-run evidence artifact for a selected
deployment; operators still need production-like load duration, capacity notes,
alert evidence, and rollback readiness before claiming `PRODUCTION_READY`.
