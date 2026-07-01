# Tooling

Tooling contains repository quality gates. It must not encode product behavior.

Current tooling:

- `api/check-openapi.mjs` checks current OpenAPI shape, route coverage, auth,
  response, and pagination contract rules.
- `api/check-openapi-compatibility.mjs` compares the current OpenAPI document
  against the compatibility baseline to block breaking public `/v1` drift.
- `architecture/check-boundaries.mjs` checks high-level package boundary violations.
- `release/check-readiness.mjs` checks release-readiness evidence, freeze documents, root gates, and workspace manifests.
- `sdk/check-rust-sdk.mjs` verifies generated Rust SDK operation metadata stays
  aligned with OpenAPI.

Future tooling may include documentation drift checks, security/redaction checks, and release helpers.
