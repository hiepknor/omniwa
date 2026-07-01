# Release Tooling

Release tooling validates whether the repository has the minimum evidence required before a release candidate or production-readiness review.

Current tooling:

- `check-readiness.mjs` checks freeze documents, release evidence files,
  release evidence tests, root quality-gate scripts, OpenAPI compatibility gate
  wiring, SDK test gate wiring, production regression gate wiring, and workspace
  package manifests.

Rules:

- Release tooling must not bypass quality gates.
- Release tooling must not change runtime topology.
- Rollback and recovery evidence must remain explicit.
