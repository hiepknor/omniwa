# ADR-001 Architecture Style

## Status

Accepted.

## Context

OmniWA Phase 0 is frozen. The product requires a stable platform surface over Baileys, Single Tenant + Multi Instance MVP scope, explicit reliability targets, provider replaceability, strong security boundaries, and low operational burden.

The architecture must not design APIs, databases, deployment topology, or Baileys internals in this phase.

## Decision

OmniWA will use a **Modular Monolith** as the primary architecture style, with **Clean Architecture** and **Hexagonal Ports and Adapters** inside package boundaries.

DDD is used pragmatically for product language and domain ownership. Vertical slices may be used to organize application use cases, but they must obey the dependency rule.

## Consequences

- Business policy is protected from Baileys and infrastructure details.
- MVP remains operationally simple.
- Provider, queue, persistence, logging, and configuration concerns stay behind adapters.
- Future extraction is possible only after boundaries are proven.

## Trade-offs

- More boundary discipline is required than a simple script-like wrapper.
- The modular monolith can degrade if package import rules are not enforced.
- Runtime distribution is deferred.

## Alternatives Considered

- Pure Clean Architecture without modular monolith: good dependency model, but does not define deployable boundary strategy.
- Hexagonal only: strong adapter model, but insufficient by itself for package ownership.
- Onion Architecture: compatible but less explicit about provider adapters.
- Full DDD: too heavy for MVP.
- Microservices: too much operational complexity for Single Tenant + Multi Instance MVP.
- Vertical Slice as primary style: useful for use cases, but risky if it bypasses shared domain rules.
