# ADR-009 Error Handling Strategy

## Status

Accepted.

## Context

OmniWA must categorize failures from business rules, validation, infrastructure, external providers, guardrails, and unknown faults. Future HTTP mapping must be possible without making HTTP concerns part of the domain.

## Decision

OmniWA will classify errors before they cross application boundaries.

Error categories:

- Business Error: valid request conflicts with product policy or state.
- Validation Error: malformed or incomplete input at a boundary.
- Infrastructure Error: technical failure inside persistence, queue, logging, configuration, or internal adapters.
- External Provider Error: failure from Baileys or any future messaging provider.
- Security Error: authentication, authorization, secret handling, or policy guardrail failure.
- Unknown Error: unexpected failure that must be sanitized and observable.

Future HTTP mapping belongs to Interface, not Domain.

## Consequences

- Operators receive clearer failure categories.
- Unknown errors can be logged safely without exposing sensitive data.
- Provider-specific errors become product-level failure categories.
- Interface mapping can evolve without changing domain errors.

## Trade-offs

- Error classification requires discipline at every boundary.
- Overly broad categories can hide important operational detail.

## Alternatives Considered

- Throw raw provider/framework errors: easier but leaks implementation details.
- HTTP status-first errors: couples domain to future API design.
- Single generic error type: too weak for observability and recovery.
