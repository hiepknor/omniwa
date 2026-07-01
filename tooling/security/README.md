# Security Tooling

Security regression coverage is enforced through:

- `pnpm regression:check`
- `tooling/regression/check-production-regression.mjs`
- `docs/runbooks/PRODUCTION_REGRESSION_GATES.md`

Rules:

- Secret/raw Confidential fixtures must be synthetic.
- Checks must fail on unsafe logging, tracing, metrics labels, cache keys, object paths, or public exposure.
- Security tooling must not store sensitive data.
