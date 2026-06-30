# Tooling

Tooling contains repository quality gates. It must not encode product behavior.

Current tooling:

- `architecture/check-boundaries.mjs` checks high-level package boundary violations.
- `release/check-readiness.mjs` checks release-readiness evidence, freeze documents, root gates, and workspace manifests.

Future tooling may include documentation drift checks, security/redaction checks, and release helpers.
