# ADR-013 Async Job Strategy

## Status

Accepted.

## Context

OmniWA reliability targets require accepted work to be observable as completed, pending, retried, failed, or action-required. Webhooks, provider retries, media operations, reconnect handling, and recovery workflows need asynchronous processing.

## Decision

OmniWA will define async jobs as application-owned work with explicit lifecycle state.

Async job principles:

- Queue engine is hidden behind an application port.
- Jobs require idempotency strategy.
- Retries are bounded and categorized.
- Exhausted retries move to terminal failed or dead-letter state.
- Operators can observe pending, retrying, failed, dead-letter, and action-required states.
- Job payloads must follow data classification and retention rules.

This ADR does not select BullMQ, Redis, database-backed jobs, or any queue engine.

## Consequences

- Async work supports reliability targets.
- Queue implementation can change later.
- Each async workflow must define idempotency and terminal states.

## Trade-offs

- More state modeling is required.
- Some simple operations may need explicit job lifecycle handling.

## Alternatives Considered

- Fire-and-forget async work: violates 0 silent-drop target.
- Direct queue engine coupling: weakens testability and future replacement.
- Synchronous-only processing: insufficient for webhooks, media, reconnects, and retries.
