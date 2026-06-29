# ADR-011 Package Boundary

## Status

Accepted.

## Context

The Modular Monolith needs enforceable internal boundaries. Phase 1.1 must define package concepts without creating implementation modules or code.

## Decision

OmniWA will use these conceptual package boundaries:

- Shared: policy-neutral primitives only.
- Domain: product policy and domain concepts.
- Application: use cases, orchestration, and ports.
- Infrastructure: technical adapter implementations.
- Interface: entry surfaces and presentation mapping.

Package imports must follow `docs/architecture/DEPENDENCY_RULES.md`.

## Consequences

- Boundaries are clear before implementation starts.
- Future teams can map source layout to architectural intent.
- Shared must be kept intentionally small.

## Trade-offs

- Some behavior may require more explicit mapping between packages.
- Boundary reviews are needed as the product grows.

## Alternatives Considered

- Framework-driven package structure: risks leaking framework concepts into architecture.
- Feature-only packages: can blur domain and infrastructure boundaries.
- Technical-only packages: can scatter product behavior.
