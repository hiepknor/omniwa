# ADR-002 Modular Monolith

## Status

Accepted.

## Context

OmniWA MVP needs reliable product behavior, fast developer onboarding, and clear internal boundaries. Phase 0 explicitly defers multi-tenancy and stable SDK packages. The architecture must support multiple WhatsApp instances without introducing distributed-system complexity too early.

## Decision

OmniWA MVP will be a **Modular Monolith**.

The system is treated as one deployable product boundary for MVP, with strict internal package boundaries around product domains and technical adapters.

## Consequences

- Local development and deployment stay simpler.
- Cross-cutting requirements such as logging, security, retention, and guardrails can be enforced consistently.
- Internal boundaries must be explicit because process boundaries will not enforce them.
- Future service extraction remains possible but is not assumed.

## Trade-offs

- Independent runtime scaling per product area is deferred.
- Boundary violations are possible without tooling and review.
- Long-term growth requires active modularity governance.

## Alternatives Considered

- Single unstructured monolith: fastest initially, but likely to couple business logic to Baileys and infrastructure.
- Microservices: unnecessary for MVP and harmful to reliability/onboarding targets.
- Plugin-first architecture: too flexible too early and likely to weaken product contracts.
