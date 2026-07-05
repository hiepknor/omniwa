# Target Environment Validation

## Review Metadata

| Item                  | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| Review date           | 2026-07-05 Asia/Ho_Chi_Minh                            |
| Review type           | Target-environment production evidence                 |
| Source plan           | `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` |
| Production cut review | `docs/reviews/PRODUCTION_CUT_REVIEW.md`                |

Target Environment Validation Status: NOT_PROVEN

Target Environment Proven: NO

Production Load Proven: NO

SLO Evidence Proven: NO

## Summary

OmniWA has deterministic local quality gates, runtime composition checks, PostgreSQL contract tests,
and local production-cut gates. This document tracks the remaining external proof required before a
future `PRODUCTION_READY` decision.

The current state is intentionally `NOT_PROVEN`. This is not a failure of the local codebase; it is
an explicit statement that the approved production runtime has not yet been exercised in the target
deployment environment.

## Runtime Evidence Matrix

| Component          | Status  | Evidence                                                                                                                                                                                                       |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Runtime        | PENDING | Needs target-environment startup with production API profile, PostgreSQL, Redis rate limiting, AuditRecord security audit, repository ownership, durable queue profile, and API metric recorder configured.    |
| Worker Runtime     | PENDING | Needs target-environment worker startup, durable queue recovery, retry behavior, and shutdown proof.                                                                                                           |
| Provider Runtime   | PENDING | Needs target-environment provider runtime startup, lease ownership, session restore, disconnect handling, and operator-safe signal evidence.                                                                   |
| Webhook Dispatcher | PENDING | Needs target-environment dispatcher startup with PostgreSQL repositories, durable worker-job queue profile, fetch gateway, signing secret, JSONL or approved metric/audit sinks, retry, and dead-letter proof. |
| PostgreSQL         | PENDING | Needs target-environment connectivity, migration/contract verification, backup participation, restore drill reference, and safe credentials.                                                                   |
| Redis              | PENDING | Needs target-environment Redis connectivity for rate limiting and any approved ephemeral coordination path, with no durable-source-of-truth usage.                                                             |
| EventLog           | PENDING | Needs target-environment event replay and SSE cursor proof over the selected durable EventLog backend.                                                                                                         |
| Secret Provider    | PENDING | Needs target-environment secret-provider selection, key rotation path, webhook signing secret access, API key source, and Baileys auth-state encryption key handling.                                          |
| Observability      | PENDING | Needs target-environment metrics/logging/health/alert routing, dashboard access, and redaction review.                                                                                                         |
| Backup/Restore     | PENDING | Needs target-environment backup artifact creation, restore validation, RPO/RTO evidence, and operator runbook drill.                                                                                           |

## Validation Commands

Local gates that must remain green before any target-environment review:

```text
pnpm check
pnpm test:postgres
pnpm production:check
```

Optional target-environment API smoke command for a deployed API:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
pnpm target-env:smoke
```

The smoke runner checks only approved public endpoints and prints a sanitized JSON summary. If
`OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` is configured, it also writes the sanitized summary as a review
artifact. It must not record the base URL, API key, response bodies, raw IDs, QR payloads, JIDs,
message text, provider payloads, session material, webhook secrets, or other sensitive values.

Optional target-environment API load command for a deployed API:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_LOAD_REQUESTS=120 \
OMNIWA_TARGET_ENV_LOAD_CONCURRENCY=10 \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
pnpm target-env:load
```

The load runner performs bounded authenticated GET load against approved public endpoints and prints
a sanitized JSON summary. If `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` is configured, it also writes that
summary as a review artifact. The artifact must not include the base URL, API key, response bodies,
raw IDs, QR payloads, JIDs, message text, provider payloads, session material, webhook secrets, or
other sensitive values. This command is operator-run and does not replace sustained SLO observation.

When `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` or `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` is set while
running `pnpm target-env:check`, the local evidence gate validates the referenced sanitized JSON
artifact schema and blocks unsafe fields. The gate still does not contact a target deployment or
claim production readiness by itself.

Optional target-environment evidence bundle validation:

```text
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:bundle
```

```text
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:check
```

The evidence bundle is an operator-maintained sanitized JSON manifest that references the runtime
evidence matrix, smoke/load artifacts, deployment profile, dependency checks, backup/restore drill,
alert/SLO dry-run, and rollback or forward-fix notes. The checker validates its schema and rejects
unsafe fields, but it does not create target-environment evidence.
Use `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json` as the starting skeleton, copy
it to the operator artifact path, and replace only safe reference values with target-environment
evidence identifiers.
The `target-env:bundle` command creates the initial sanitized bundle from the checked-in template
and can embed already-sanitized smoke/load summaries when their artifact path variables are set.
When a bundle path is supplied to `target-env:check`, the bundle status, proof states, and component
statuses must match this review file. This keeps the review document as the authoritative readiness
state and blocks artifact/review drift.

Target-environment evidence must additionally record:

- deployment profile and runtime versions,
- sanitized startup command summaries,
- health/readiness results,
- dependency connectivity results,
- backup/restore drill identifier,
- production-like load test summary,
- alert/SLO dry-run summary,
- rollback or forward-fix notes.

## Known Constraints

- This file must not include raw API keys, database passwords, Redis credentials, QR payloads, JIDs,
  message text, provider-native payloads, session material, webhook secrets, or unredacted URLs.
- `PRODUCTION_READY` cannot be claimed until all proof states above are `YES` and every runtime
  evidence row is `PASS`.
- Real WhatsApp/Baileys validation must remain operator-controlled and cannot become mandatory for
  normal PR validation.
- JSONL observability evidence is acceptable for the current gate, but target-environment rotation,
  retention, and exporter decisions remain required operational evidence before broad production use.
