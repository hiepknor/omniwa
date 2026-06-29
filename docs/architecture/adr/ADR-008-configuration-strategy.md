# ADR-008 Configuration Strategy

## Status

Accepted.

## Context

OmniWA must be deployable by small teams, protect Secret data, avoid unsafe defaults, and support future environment differences without selecting a deployment platform in Phase 1.1.

## Decision

Configuration will be explicit, validated, typed at the application boundary, and separated from business policy.

Configuration principles:

- Required configuration fails fast when missing or invalid.
- Secret configuration is handled as Secret data.
- Environment-specific values are read by infrastructure configuration adapters.
- Application receives validated configuration concepts, not raw environment access.
- Product guardrails cannot be disabled silently by configuration.

## Consequences

- Startup failures are easier to diagnose.
- Runtime behavior is less surprising.
- Secret handling is consistent with the security classification.
- Additional configuration mapping is required.

## Trade-offs

- Strict validation may slow local setup until defaults and documentation are clear.
- Some settings require product review before becoming configurable.

## Alternatives Considered

- Raw environment access everywhere: simple but unsafe and hard to test.
- Hard-coded defaults: convenient but risky for production behavior.
- Configuration stored in business domain: mixes deployment concerns with product policy.
