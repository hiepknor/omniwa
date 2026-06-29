# OmniWA Architecture Style

## Decision

OmniWA adopts a **Modular Monolith** as the primary architecture style for MVP, with **Clean Architecture** and **Hexagonal Ports and Adapters** inside package boundaries.

DDD is used pragmatically to define domain language and aggregate-like ownership where useful. Vertical slice organization may be used inside the application layer for use-case clarity, but it must not violate the dependency rule.

## Style Analysis

### Clean Architecture

Clean Architecture places domain and application policy at the center and directs dependencies inward.

Pros:

- Protects business logic from Baileys, frameworks, queues, persistence, and transport.
- Fits the requirement that business logic must not depend directly on Baileys.
- Keeps future provider support possible.

Cons:

- Requires discipline around ports, adapters, and mapping.
- Can become ceremony-heavy if applied mechanically.

Trade-offs:

- The architecture accepts more explicit boundary work to avoid long-term coupling to Baileys and infrastructure.

### Hexagonal Architecture

Hexagonal architecture models the application as a core surrounded by ports and adapters.

Pros:

- Strong fit for provider abstraction: MessagingProvider, BaileysProvider, future CloudAPIProvider, and MockProvider.
- Makes testing easier because adapters can be replaced.
- Keeps external systems at the edge.

Cons:

- Too many ports can create unnecessary indirection.
- Requires clear ownership of port contracts.

Trade-offs:

- Ports are introduced only where external dependencies or policy boundaries exist.

### Onion Architecture

Onion architecture also protects inner policy from outer technical concerns.

Pros:

- Reinforces dependency direction.
- Useful mental model for domain-centered design.

Cons:

- Less explicit about provider adapters and external integration boundaries than Hexagonal.

Trade-offs:

- Onion concepts are compatible with the selected approach, but not used as the primary language.

### Domain-Driven Design

DDD helps model the product language and boundaries around instances, sessions, messages, webhooks, queues, guardrails, and provider behavior.

Pros:

- Aligns implementation language with glossary and product scope.
- Reduces drift between product, architecture, and code.
- Helps define ownership boundaries.

Cons:

- Full tactical DDD can be too heavy for MVP.
- Over-modeling can slow delivery.

Trade-offs:

- OmniWA uses DDD-lite: ubiquitous language, clear domain concepts, and bounded ownership without forcing unnecessary tactical patterns.

### Modular Monolith

Modular Monolith keeps one deployable system while enforcing internal boundaries.

Pros:

- Lower operational complexity than microservices.
- Strong fit for Single Tenant + Multi Instance MVP.
- Easier local development and onboarding.
- Supports future extraction when boundaries are proven.

Cons:

- Boundary violations can accumulate if import rules are not enforced.
- Scaling is coarser than independently deployable services.

Trade-offs:

- MVP optimizes for reliability, simplicity, and clear boundaries over distributed scalability.

### Vertical Slice

Vertical slice architecture organizes behavior around end-to-end use cases.

Pros:

- Improves feature comprehension.
- Can reduce scattering of use-case logic.
- Fits application-level workflows such as pairing, sending, reconnecting, and webhook delivery.

Cons:

- If misused, it can bypass domain boundaries and duplicate policy.
- Can hide shared business concepts.

Trade-offs:

- Vertical slices are allowed only inside application use-case organization. They do not override package boundaries or dependency direction.

## Final Style

The final style is:

- Primary: Modular Monolith.
- Inner dependency model: Clean Architecture.
- External boundary model: Hexagonal Ports and Adapters.
- Domain modeling: Pragmatic DDD.
- Use-case organization: Vertical slices allowed inside application layer only.

## Why This Fits OmniWA

This style supports frozen Phase 0 constraints:

- Baileys remains replaceable behind provider adapters.
- Business logic stays independent from infrastructure.
- MVP avoids microservice complexity.
- Reliability, security, retention, logging, and upgrade policies can be enforced at architecture boundaries.
- Future providers such as WhatsApp Cloud API, Telegram, Messenger, and Instagram can be added through adapter and provider extension points.

## Non-Goals

This style does not decide:

- API route shape.
- Database technology or schema.
- Queue engine.
- Framework.
- Deployment topology.
- Baileys implementation details.
