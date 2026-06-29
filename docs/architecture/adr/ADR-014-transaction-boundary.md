# ADR-014 Transaction Boundary

## Status

Accepted.

## Context

OmniWA must coordinate state changes, domain events, async jobs, provider calls, and integration events without designing a database in Phase 1.1. Transaction boundaries need to be owned by application workflows, not hidden in infrastructure.

## Decision

Application use cases own transaction boundaries conceptually.

Rules:

- Domain does not open, commit, or roll back transactions.
- Interface does not own transaction policy.
- Infrastructure executes persistence-related transaction mechanics behind ports.
- Application decides which state changes and events belong to one consistency boundary.
- External provider calls are not assumed to be transactional with OmniWA-owned state.
- Async jobs and integration events must avoid silent loss when state changes are accepted.

## Consequences

- Consistency decisions are explicit.
- Provider side effects are not incorrectly treated as local transactions.
- Later persistence design must support application-owned consistency needs.

## Trade-offs

- Use cases must be precise about state and event ordering.
- Some workflows require compensation or action-required states rather than atomic rollback.

## Alternatives Considered

- Infrastructure-owned implicit transactions: hides consistency decisions.
- Domain-owned transactions: couples domain to persistence.
- Distributed transactions with providers: unrealistic and outside product control.
