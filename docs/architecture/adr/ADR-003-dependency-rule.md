# ADR-003 Dependency Rule

## Status

Accepted.

## Context

Phase 0 requires Baileys to be an implementation dependency rather than the business boundary. OmniWA must remain extensible for future providers and protect domain policy from infrastructure churn.

## Decision

Dependencies must point inward:

```text
Interface -> Application -> Domain
Infrastructure -> Application ports and Domain types
Shared -> no OmniWA package
```

Domain must not depend on Application, Interface, Infrastructure, Baileys, queues, persistence, logging, telemetry, configuration, or transport.

Application must not depend on concrete infrastructure implementations.

Infrastructure implements ports and translates external behavior into OmniWA concepts.

## Consequences

- Business logic remains testable without external systems.
- Provider and infrastructure changes do not directly rewrite domain policy.
- More mapping is required at boundaries.
- Architecture tests or import rules become necessary.

## Trade-offs

- The rule adds ceremony to simple flows.
- Direct calls to technical libraries may seem faster, but they would violate frozen product constraints.

## Alternatives Considered

- Framework-centric dependency direction: faster initially but couples policy to frameworks and providers.
- Domain directly calls infrastructure: simpler to write but blocks provider replaceability.
- Shared everything: convenient but likely to become a hidden coupling layer.
