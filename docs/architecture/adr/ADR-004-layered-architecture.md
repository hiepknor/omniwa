# ADR-004 Layered Architecture

## Status

Accepted.

## Context

OmniWA needs clear separation between product policy, orchestration, external delivery mechanisms, and technical adapters. The layers must support future HTTP, dashboard, webhook, worker, and CLI interfaces without designing those interfaces now.

## Decision

OmniWA uses four primary layers:

- Interface: external entry surfaces and presentation mapping.
- Application: use cases, orchestration, ports, workflow coordination, and transaction boundary ownership.
- Domain: business policy, product concepts, invariants, domain errors, and domain events.
- Infrastructure: technical adapters for providers, queue, persistence, logging, configuration, telemetry, and external delivery.

Shared primitives are allowed only when they are dependency-light and policy-neutral.

## Consequences

- Interface concerns do not leak into use cases.
- Domain stays stable and independent.
- Infrastructure is replaceable through ports.
- Some data translation between layers is required.

## Trade-offs

- Layering can create boilerplate if applied to trivial behavior.
- Layer boundaries must not hide poor product modeling.

## Alternatives Considered

- Two-layer controller/service model: too weak for provider abstraction and long-term extension.
- Strict Onion layering only: compatible but less explicit about adapter ownership.
- Feature folders without layers: easy to navigate but can mix policy and infrastructure.
