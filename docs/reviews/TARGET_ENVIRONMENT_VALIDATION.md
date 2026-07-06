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
| Worker Runtime     | PENDING | Needs target-environment worker startup, durable queue recovery, retry behavior, provider-command bridge client configuration, and shutdown proof.                                                             |
| Provider Runtime   | PENDING | Needs target-environment provider runtime startup, internal provider-command bridge server configuration, lease ownership, session restore, disconnect handling, and operator-safe signal evidence.            |
| Background Runtime | PENDING | Needs target-environment background runtime startup, PostgreSQL EventLog outbox drain loop proof, JSONL or approved outbox publisher evidence, backlog metric evidence, and shutdown proof.                    |
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

The smoke runner checks only approved public endpoints, verifies that successful responses preserve
the standard public response envelope and request/correlation metadata, and prints a sanitized JSON
summary. If `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` is configured, it also writes the sanitized summary
as a review artifact. It must not record the base URL, API key, response bodies, raw IDs, QR
payloads, JIDs, message text, provider payloads, session material, webhook secrets, or other
sensitive values.

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

Optional target-environment alert/SLO dry-run normalization and validation:

Start from the checked-in safe skeleton at
`docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json`, copy it to the operator
artifact path, and replace only sanitized dashboard ids, alert ids, receiver classes, SLO areas,
booleans, counts, timestamps, and safe error codes.

```text
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH=artifacts/target-env/alert-slo-dry-run-input.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
pnpm target-env:alert-slo
```

```text
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
pnpm target-env:check
```

The alert/SLO dry-run command normalizes an operator-maintained sanitized input file into a canonical
artifact. If no input is supplied, it emits a failed safe skeleton instead of claiming proof. The
generated artifact records sanitized dashboard access checks, alert-route dry-runs, and SLO window
or error-budget policy checks. It must not contain dashboard URLs, notification destinations, raw
instance IDs, JIDs, message text, provider payloads, API keys, session material, or secrets. This
artifact is reviewed alongside the evidence bundle and does not replace sustained SLO observation.

Optional target-environment runtime evidence artifact validation:

Start from the checked-in safe skeleton at
`docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json`, copy it to the operator
artifact path, and replace only sanitized booleans, safe refs, timestamps, and safe error codes.

```text
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH=artifacts/target-env/runtime-evidence-input.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
pnpm target-env:runtime
```

```text
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
pnpm target-env:check
```

The runtime evidence command normalizes an operator-maintained sanitized input file into a canonical
runtime evidence artifact. If no input is supplied, it emits a failed safe skeleton instead of
claiming proof. The checked-in input template is validated by `pnpm target-env:check` and must remain
a failed safe skeleton. The generated artifact records startup, readiness, shutdown, dependency
connectivity, migration-status, provider-command bridge configuration/auth/round-trip proof, queue
runtime proof, observability signal proof, and backup/restore drill checks. Provider-command bridge
proof must include safe refs for startup, worker client configuration, provider-runtime server
configuration, authentication boundary, and a command round trip; refs that still contain `pending`
keep the artifact failed even if booleans are set. Queue runtime proof must include safe refs for
the durable queue profile, atomic reservation, retry recovery, dead-letter behavior, and expired
lease recovery; refs that still contain `pending` keep the artifact failed even if booleans are set.
Observability signal proof must include safe refs for the metrics exporter, structured logging,
queue backlog metrics, EventLog outbox metrics, and redaction review; refs that still contain
`pending` keep the artifact failed. It must not contain target URLs,
database or Redis connection strings, API keys, raw runtime logs, raw instance IDs, QR payloads,
JIDs, message text, provider payloads, session material, webhook secrets, or secret-provider values.
This artifact provides operator evidence for the runtime matrix, dependency connectivity, bridge
behavior, queue runtime behavior, observability signals, and recovery drill references, but it does
not by itself change the proof states above.

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
alert/SLO dry-run artifact, runtime evidence artifact, and rollback or forward-fix notes. The checker
validates its schema and rejects unsafe fields, but it does not create target-environment evidence.
Use `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json` as the starting skeleton, copy
it to the operator artifact path, and replace only safe reference values with target-environment
evidence identifiers.
The `target-env:bundle` command creates the initial sanitized bundle from the checked-in template
and can embed already-sanitized smoke/load/alert-SLO/runtime summaries when their artifact path
variables are set. Operators may also set `OMNIWA_TARGET_ENV_PROVIDER_COMMAND_BRIDGE_EVIDENCE_REF`
to replace the bundle's provider-command bridge pending placeholder with a safe evidence reference.
When a bundle path is supplied to `target-env:check`, the bundle status, proof states, and component
statuses must match this review file. This keeps the review document as the authoritative readiness
state and blocks artifact/review drift.
If a future bundle claims `PROVEN`, every evidence reference and component reference must be
non-pending, and the smoke, load, alert/SLO dry-run, and runtime evidence artifact entries must all
include `passed` summaries.

Optional target-environment readiness summary:

```text
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:summary
```

The summary command emits safe readiness state, proof booleans, component counts, artifact presence
booleans, finding codes, and next-action codes. It must not print target URLs, API keys, artifact
paths, response bodies, raw IDs, QR payloads, JIDs, message text, provider payloads, session
material, webhook secrets, or secret-provider values.

Target-environment evidence must additionally record:

- deployment profile and runtime versions,
- sanitized startup command summaries,
- health/readiness results,
- dependency connectivity results,
- provider-command bridge startup/client/server/auth/round-trip evidence reference,
- durable queue profile, atomic reservation, retry recovery, dead-letter behavior, and expired
  lease recovery evidence references,
- metrics exporter, structured logging, queue backlog metric, EventLog outbox metric, and redaction
  evidence references,
- backup/restore drill identifier,
- production-like load test summary,
- alert/SLO dry-run summary,
- runtime startup/dependency/backup evidence summary,
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
