# Tooling

Tooling contains repository quality gates. It must not encode product behavior.

Current tooling:

- `api/check-openapi.mjs` checks current OpenAPI shape, route coverage, auth,
  response, and pagination contract rules.
- `api/check-openapi-compatibility.mjs` compares the current OpenAPI document
  against the compatibility baseline to block breaking public `/v1` drift.
- `architecture/check-boundaries.mjs` checks high-level package boundary violations.
- `e2e/check-e2e-readiness.mjs` checks deterministic E2E evidence for the
  REST regression and local vertical-slice runtime path.
- `observability/check-observability-readiness.mjs` checks metric catalog,
  alert, dependency readiness, metrics runtime, and health runtime evidence.
- `performance/check-performance-readiness.mjs` checks load baseline evidence,
  root load gate wiring, and root performance gate wiring.
- `production/check-production-cut.mjs` checks production cut evidence, load
  gate wiring, and explicit readiness decision state.
- `recovery/check-recovery-readiness.mjs` checks recovery drill evidence,
  backup/restore validation tests, and root recovery gate wiring.
- `release/check-readiness.mjs` checks release-readiness evidence, freeze documents, root gates, and workspace manifests.
- `regression/check-production-regression.mjs` checks production regression
  gate wiring and required E2E/security regression evidence.
- `security/check-security-readiness.mjs` checks security-control evidence,
  required security tests, and root security gate wiring.
- `sdk/check-rust-sdk.mjs` verifies generated Rust SDK operation metadata stays
  aligned with OpenAPI.

Future tooling may include documentation drift checks and release helpers.
