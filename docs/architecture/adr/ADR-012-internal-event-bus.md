# ADR-012 Internal Event Bus

## Status

Accepted.

## Context

OmniWA needs internal decoupling for domain events, async work, webhook preparation, provider events, logging, and operational state changes. Phase 1.1 must define event bus principles without selecting a library or queue engine.

## Decision

OmniWA will use an internal event bus abstraction for in-process event dispatch and a separate async job abstraction for durable work.

Rules:

- The internal event bus is for local decoupling inside the monolith.
- It is not the external webhook contract.
- It is not a replacement for durable async jobs.
- Domain does not publish directly to the bus.
- Application controls publication timing.
- Infrastructure provides the bus implementation.

## Consequences

- Event dispatch can be tested without external infrastructure.
- Local handlers can be added without direct coupling.
- Durable work still requires async job strategy and terminal state tracking.

## Trade-offs

- Internal events can hide control flow if overused.
- Some handlers may need ordering guarantees, which must be documented in later architecture work.

## Alternatives Considered

- No internal event bus: simpler but increases direct coupling.
- Use queue for all events: durable but too heavy for in-process coordination.
- Domain publishes directly: violates dependency and transaction rules.
