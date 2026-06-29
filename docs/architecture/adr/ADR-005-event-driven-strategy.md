# ADR-005 Event Driven Strategy

## Status

Accepted.

## Context

OmniWA must handle provider events, reconnects, message status, webhook delivery, queues, retries, dead-letter states, and operator visibility. Events are necessary, but uncontrolled event usage can hide coupling and failure.

## Decision

OmniWA will use event-driven behavior selectively.

Event categories:

- Domain Event: a business fact created by domain policy.
- Application Event: a workflow fact or command-like internal signal coordinated by application logic.
- Integration Event: a product event intended for external systems, including future webhook delivery.
- Async Event: a durable work signal for background processing.
- Sync Event: an in-process event used only for immediate local coordination.

Domain creates domain events but does not publish directly to event buses, queues, logs, or webhooks. Application decides when events are published, persisted, queued, or ignored.

## Consequences

- Product facts become observable and testable.
- Async work can support retry and terminal states.
- Event taxonomy prevents every event from becoming an integration contract.
- Event handlers must not bypass use cases or guardrails.

## Trade-offs

- Events improve decoupling but can obscure flow if not documented.
- Durable async events require idempotency and operational visibility.

## Alternatives Considered

- Pure synchronous workflow: simpler but insufficient for webhooks, retries, and queue visibility.
- Everything as an event: too hard to reason about and debug.
- Direct provider callback handling in business logic: couples product policy to Baileys.
