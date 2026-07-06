# Target Environment Evidence Collection Runbook

## Purpose

This runbook gives operators a single sequence for collecting sanitized target-environment evidence
before any future production-ready claim.

It does not replace `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` or
`docs/reviews/PRODUCTION_CUT_REVIEW.md`. Those review documents remain the source of the proof
states.

## Preconditions

- A deployed OmniWA target environment is available.
- The operator has an API key for that environment.
- Local repository gates pass before collecting target-environment evidence.
- Evidence artifacts are written outside the source tree or under an ignored operator artifact
  directory such as `artifacts/target-env/`.
- The repository `.gitignore` ignores `artifacts/`, and `pnpm release:check` guards this so
  operator evidence is not accidentally staged.
- Raw target URLs, API keys, response bodies, QR values, JIDs, message text, provider payloads,
  auth state, session material, webhook secrets, and secret-provider values are not committed.

## Collection Sequence

Run the local quality gate first:

```text
pnpm check
```

Create the operator artifact directory:

```text
mkdir -p artifacts/target-env
```

Collect deployed API smoke evidence:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
pnpm target-env:smoke
```

Collect bounded deployed API load evidence:

```text
OMNIWA_TARGET_ENV_BASE_URL=https://api.example.invalid \
OMNIWA_TARGET_ENV_API_KEY=redacted \
OMNIWA_TARGET_ENV_LOAD_REQUESTS=120 \
OMNIWA_TARGET_ENV_LOAD_CONCURRENCY=10 \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
pnpm target-env:load
```

Prepare sanitized runtime evidence input:

```text
cp docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json \
  artifacts/target-env/runtime-evidence-input.json
```

Edit only the copied input file. Replace placeholders with sanitized booleans, safe refs, timestamps,
and safe error codes. Do not write raw deployment values into the copied input.
For provider-command bridge proof, fill only safe evidence refs for startup, worker client
configuration, provider-runtime server configuration, authentication boundary, and command
round-trip checks. Refs that still contain `pending` keep runtime evidence failed by design.

Normalize runtime evidence:

```text
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH=artifacts/target-env/runtime-evidence-input.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
pnpm target-env:runtime
```

Prepare sanitized alert/SLO dry-run input:

```text
cp docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json \
  artifacts/target-env/alert-slo-dry-run-input.json
```

Edit only the copied input file. Replace placeholders with sanitized dashboard ids, alert ids,
receiver classes, SLO areas, booleans, counts, timestamps, and safe error codes. Do not write raw
dashboard URLs, notification destinations, target ids, API keys, or runtime details into the copied
input.

Normalize optional alert/SLO dry-run evidence:

```text
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH=artifacts/target-env/alert-slo-dry-run-input.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
pnpm target-env:alert-slo
```

Validate alert/SLO dry-run evidence if the operator-maintained artifact exists:

```text
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
pnpm target-env:check
```

Create a sanitized evidence bundle:

The bundle command starts from `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json`.

```text
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
OMNIWA_TARGET_ENV_PROVIDER_COMMAND_BRIDGE_EVIDENCE_REF=operator-evidence-provider-command-bridge-reviewed \
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:bundle
```

`OMNIWA_TARGET_ENV_PROVIDER_COMMAND_BRIDGE_EVIDENCE_REF` must be a safe operator reference, not a
URL, raw log path, API key, JID, message text, provider payload, session material, or secret. Leave
it unset to keep the bundle template's pending placeholder.

Validate all collected artifacts together:

```text
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:check
```

Summarize the review state and supplied artifact refs without printing artifact paths or target
secrets:

```text
OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH=artifacts/target-env/smoke-report.json \
OMNIWA_TARGET_ENV_LOAD_REPORT_PATH=artifacts/target-env/load-report.json \
OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH=artifacts/target-env/alert-slo-dry-run.json \
OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH=artifacts/target-env/runtime-evidence.json \
OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH=artifacts/target-env/evidence-bundle.json \
pnpm target-env:summary
```

The summary command emits only safe readiness state, proof booleans, component counts, artifact
presence booleans, finding codes, and next-action codes. It does not include the target URL, API
key, artifact path, response body, raw IDs, JIDs, message text, provider payloads, auth state, or
secret material.

## Review Update

Only after the collected artifacts pass validation should reviewers update
`docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` and `docs/reviews/PRODUCTION_CUT_REVIEW.md`.

Reviewers must keep these states aligned:

- `Target Environment Validation Status`
- `Target Environment Proven`
- `Production Load Proven`
- `SLO Evidence Proven`
- runtime component matrix statuses
- evidence bundle proof states and component statuses

For a future `PROVEN` bundle, every evidence reference and component evidence reference must be a
non-pending safe identifier, and the smoke, load, alert/SLO dry-run, and runtime evidence artifact
entries must all include `passed` summaries. Do not promote a bundle by editing only the proof flags.

If any artifact remains failed, incomplete, unsafe, or unverifiable, keep the proof states as `NO`
and do not claim production readiness.

## Safety Rules

- Do not commit target-environment artifacts unless they have been reviewed as sanitized evidence.
- Do not copy target URLs, credentials, raw logs, response bodies, QR values, JIDs, message text,
  provider payloads, auth state, session material, or secrets into evidence artifacts.
- Do not change proof states based only on local deterministic tests.
- Do not treat `pnpm target-env:bundle` output as proof until the bundle is populated from real
  target-environment evidence and validated against the review document.
