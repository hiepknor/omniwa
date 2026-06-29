# ADR-015 Testability

## Status

Accepted.

## Context

OmniWA must support Baileys upgrade regression validation, provider abstraction, queue behavior, redaction, guardrails, and recovery workflows. Testability cannot be added after implementation without weakening architecture.

## Decision

Testability is an architecture requirement.

Required testability properties:

- Domain policy can be tested without infrastructure.
- Application use cases can be tested with fake ports.
- Provider adapters can be contract-tested against product expectations.
- Async jobs can be tested with fake queue adapters.
- Logging redaction can be tested without real log sinks.
- Baileys upgrade validation has a regression checklist aligned with `docs/DECISIONS.md`.

## Consequences

- Ports and adapters must be designed for replacement in tests.
- Business logic cannot hide inside provider adapters.
- Regression testing becomes part of upgrade governance.

## Trade-offs

- Test seams require more explicit architecture boundaries.
- Some provider behaviors may need simulation rather than direct unit tests.

## Alternatives Considered

- End-to-end tests only: too slow and brittle for provider and queue logic.
- Manual Baileys validation only: insufficient for upgrade policy.
- Test through real infrastructure by default: expensive and hard to isolate.
