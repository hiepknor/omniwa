# OmniWA Dependency Rules

## Purpose

This document defines allowed dependency direction and package boundary rules for OmniWA.

It is conceptual and architectural. It does not create code packages, modules, APIs, database schemas, or implementation details.

## Package Boundary Vocabulary

OmniWA uses these architecture boundaries:

- Interface: external entry surfaces such as future HTTP controllers, dashboard handlers, CLI handlers, or webhook receivers.
- Application: use cases, orchestration, command/query handling, transaction coordination, and port definitions.
- Domain: product policy, entities/value concepts, business rules, domain errors, and domain events.
- Infrastructure: technical implementations such as persistence adapters, queue adapters, logging adapters, configuration loaders, and external provider adapters.
- Shared: small cross-cutting primitives that are stable, dependency-light, and policy-neutral.

## Dependency Direction

Allowed dependency direction:

```text
Interface -> Application -> Domain
Infrastructure -> Application ports and Domain types
Shared -> no OmniWA package
```

The rule means:

- Interface calls application use cases.
- Application coordinates domain behavior and calls ports.
- Domain has no dependency on Interface, Infrastructure, or Application.
- Infrastructure implements application-defined or domain-defined ports.
- Shared does not depend on OmniWA packages.

## What Must Never Happen

These dependency paths are forbidden:

- Domain -> Infrastructure.
- Domain -> Interface.
- Domain -> framework, queue, persistence, provider, logger, or transport library.
- Application -> concrete Baileys provider.
- Application -> concrete persistence engine.
- Application -> concrete queue engine.
- Interface -> Infrastructure for business behavior.
- Infrastructure -> Interface.
- Provider adapter -> application use case orchestration.
- Shared -> Domain, Application, Interface, or Infrastructure.

## Provider Dependency Rule

Business logic must not depend directly on Baileys.

Allowed:

```text
Application -> MessagingProvider port
Infrastructure provider adapter -> Baileys
Infrastructure provider adapter -> MessagingProvider port implementation
```

Forbidden:

```text
Application -> Baileys
Domain -> Baileys
Interface -> Baileys for business behavior
```

## Adapter Rule

Adapters translate between external systems and OmniWA product concepts.

Adapters may:

- Depend on external libraries.
- Map provider events into product events.
- Map provider failures into product error categories.
- Implement ports defined by inner layers.

Adapters must not:

- Own product policy.
- Decide compliance guardrail behavior.
- Skip application use cases.
- Leak provider payloads into domain policy.
- Log Secret or unredacted Confidential data.

## Interface Rule

Interface code is a delivery mechanism.

Interface may:

- Validate transport-level shape.
- Authenticate or authorize entry where appropriate.
- Call application use cases.
- Map application results to future presentation-specific responses.

Interface must not:

- Call infrastructure adapters directly for product behavior.
- Implement business decisions.
- Depend on Baileys.
- Own retry, queue, provider, or persistence policy.

## Application Rule

Application code owns orchestration.

Application may:

- Coordinate use cases.
- Enforce workflow sequencing.
- Call domain policy.
- Define ports for providers, persistence, queues, logging, configuration, event bus, and clock-like time sources.
- Define transaction boundaries conceptually.

Application must not:

- Depend on concrete infrastructure implementations.
- Use provider-specific types as use-case inputs or outputs.
- Contain framework-specific HTTP, queue engine, or persistence details.

## Domain Rule

Domain code owns business policy.

Domain may:

- Define product concepts.
- Validate business invariants.
- Create domain events.
- Define domain errors.

Domain must not:

- Know how data is stored.
- Know how events are transported.
- Know how Baileys works.
- Know how logs are written.
- Know how jobs are queued.

## Infrastructure Rule

Infrastructure code owns technical integration.

Infrastructure may:

- Implement ports.
- Translate external data into product concepts.
- Call Baileys, queue engines, persistence engines, log sinks, telemetry sinks, and configuration sources.

Infrastructure must not:

- Define core business policy.
- Call Interface.
- Orchestrate application workflows.
- Bypass application-level guardrails.

## Shared Rule

Shared is intentionally small.

Allowed shared content:

- Generic result helpers.
- Generic identifiers.
- Generic time abstractions.
- Generic primitive types that carry no product policy.

Forbidden shared content:

- Product business rules.
- Provider-specific types.
- Persistence-specific types.
- Transport-specific types.
- Anything that becomes a dumping ground for unrelated utilities.

## Internal Event Dependency Rule

Event publishing follows dependency direction:

- Domain creates domain events as facts.
- Application decides whether and when to publish or persist events.
- Infrastructure transports events.

Domain must not publish directly to an event bus, queue, webhook, log sink, or external provider.

## Enforcement Expectations

Phase 1 implementation planning must define how dependency rules will be checked.

Acceptable enforcement categories:

- Package import rules.
- Lint rules.
- Build-time dependency checks.
- Architecture tests.
- ADR review for exceptions.

No exception is allowed without an ADR.
