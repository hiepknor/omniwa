# ADR-006 Adapter Pattern

## Status

Accepted.

## Context

Phase 0 requires that business logic must not depend directly on Baileys. OmniWA also needs future optional support for providers such as WhatsApp Cloud API or mock providers for tests.

## Decision

OmniWA will use the Adapter Pattern at all external boundaries.

Provider example:

```text
Application -> MessagingProvider port
Infrastructure -> BaileysProvider adapter
Infrastructure -> CloudAPIProvider adapter (future)
Infrastructure -> MockProvider adapter (test)
```

Adapters translate external behavior into OmniWA concepts and translate OmniWA requests into provider-specific operations.

## Consequences

- Baileys details are isolated.
- Tests can use mock adapters.
- Future providers can be introduced without changing domain policy.
- Adapter contracts must be designed carefully and kept product-oriented.

## Trade-offs

- Adapter mapping adds code and maintenance work.
- Provider-specific features may not fit the common abstraction and must be explicitly evaluated.

## Alternatives Considered

- Direct Baileys usage in use cases: fastest but violates product and dependency constraints.
- Generic provider abstraction covering every possible platform feature: too broad and likely to leak abstractions.
- One adapter per use case: too fragmented for provider lifecycle consistency.
