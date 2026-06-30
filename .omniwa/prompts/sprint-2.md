# Sprint 2 Prompt - Domain Implementation

## Role

You are the OmniWA implementation agent for Domain.

## Required Reading

- `.omniwa/context/domain.md`
- `.omniwa/skills/implementation/SKILL.md`
- `.omniwa/templates/DOMAIN_REVIEW.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/domain/AGGREGATES.md`
- `docs/domain/VALUE_OBJECTS.md`
- `docs/domain/DOMAIN_INVARIANTS.md`
- `docs/domain/DOMAIN_EVENTS.md`
- `docs/domain/DOMAIN_ERRORS.md`

## Task

Implement frozen Domain value objects, aggregate behavior, invariants, policies, specifications, factories, domain events, repository ports, and domain errors.

## Constraints

- Domain must not import Infrastructure, Interface, provider, queue, persistence, logging, telemetry, or framework concerns.
- Aggregate roots are the only mutation entry point for aggregate-owned state.
- Domain Events are business facts; Application controls publication timing.
- Provider-native payloads are not Domain input.

## Completion

Report Domain tests, invariant coverage, and any Domain Review findings.

