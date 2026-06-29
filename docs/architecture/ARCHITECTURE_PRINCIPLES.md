# OmniWA Architecture Principles

## Purpose

This document defines the architecture principles for OmniWA after Phase 0 freeze.

It does not design APIs, database schemas, modules in implementation detail, Docker, Prisma, or Baileys internals.

## Phase 0 Constraints

Architecture must preserve the frozen product decisions:

- MVP persona: developer-led SaaS builder, with internal technical team as secondary.
- MVP tenancy: Single Tenant + Multi Instance.
- MVP supported message types: text, image, video, document, and audio.
- MVP compliance posture: API platform with product-enforced guardrails.
- MVP reliability targets: explicit targets for availability, webhooks, reconnects, queues, deployment time, and MTTR.
- Data classification: Public, Internal, Confidential, and Secret.
- Retention: message and media bodies are not retained by default after processing.
- Baileys policy: exact version pinning with regression validation and rollback.

## Architecture Principles

### 1. Product Contract Over Library Behavior

OmniWA must expose a stable product model over Baileys behavior.

Baileys is an implementation dependency, not the business boundary. Product concepts such as instance, session, message, webhook, queue, delivery status, and guardrail state must remain stable even when Baileys behavior changes.

Implication:

- Business logic must not depend directly on Baileys types, events, sessions, or lifecycle callbacks.
- Provider-specific details are translated at adapter boundaries.

### 2. Dependency Direction Is Inward

Dependencies point toward policy, not toward technical details.

The stable center is the domain and application policy. Interface and infrastructure code depend inward. Domain policy does not import interface, infrastructure, provider, queue, logging, transport, persistence, or framework concerns.

Implication:

- Interface surfaces call application use cases.
- Application use cases coordinate domain behavior and depend on ports.
- Infrastructure implements ports.
- Provider adapters translate external behavior into OmniWA concepts.

### 3. Modular Monolith First

OmniWA MVP should be built as a modular monolith.

The product needs reliable boundaries and a low operational burden more than distributed-service independence. The architecture must make domain boundaries explicit so future extraction is possible, but extraction is not a Phase 1 goal.

Implication:

- Boundaries are enforced through package rules, dependency direction, tests, and ADRs.
- Runtime distribution is not used as a substitute for clean boundaries.

### 4. Ports And Adapters For External Systems

All external systems must be isolated behind ports and adapters.

This applies to:

- WhatsApp provider implementations.
- Queue engines.
- Persistence engines.
- Logging and telemetry sinks.
- Configuration sources.
- Webhook delivery clients.
- Backup and restore integrations.

Implication:

- Domain and application policy depend on abstractions.
- Infrastructure and provider adapters depend on external libraries.
- Mock or in-memory adapters are first-class testing tools.

### 5. Events Are Product Signals, Not Hidden Coupling

Events are used to communicate facts that already happened or work that must happen asynchronously.

Events must not become an uncontrolled shortcut around use cases, dependency rules, or product ownership.

Implication:

- Domain events represent business facts.
- Integration events represent facts emitted to external systems.
- Async events represent work queued for background processing.
- Sync events are only for local in-process decoupling where immediate consistency is required.

### 6. Reliability Is A Design Constraint

The architecture must make accepted work observable and recoverable.

The product decision requires 0 known silent drops for accepted work. Every accepted work item must be visible as completed, pending, retried, failed, or action-required.

Implication:

- Async jobs need idempotency, retry policy, terminal state, and dead-letter handling.
- Provider failures need categorized errors.
- Reconnect and webhook flows need observable state transitions.

### 7. Security And Privacy By Default

Secret data must never be logged. Confidential data must be redacted from normal logs.

Architecture must treat session material, API keys, webhook secrets, message content, media payloads, phone numbers, JIDs, and webhook payloads according to the frozen data classification.

Implication:

- Logging receives already-redacted context or applies mandatory redaction.
- Diagnostic capture must be explicit, temporary, and operator-visible.
- Provider adapters must not leak provider payloads into general logs.

### 8. Configuration Is Explicit And Validated

Configuration must be explicit, validated at startup, and separated from business policy.

Implication:

- Missing required configuration fails early.
- Secret configuration is handled as Secret data.
- Feature flags and runtime settings must not silently bypass product guardrails.

### 9. Errors Are Classified Before They Cross Boundaries

Errors must be categorized into business, validation, infrastructure, external provider, security, and unknown classes before they leave the application boundary.

Implication:

- External provider failures are translated into product failure categories.
- Future HTTP mapping must be a presentation concern, not a domain concern.
- Unknown errors are observable but sanitized.

### 10. Testability Is An Architecture Requirement

Every architecture boundary must support focused testing without real Baileys sessions, real queues, real persistence, or real external webhook endpoints.

Implication:

- Domain policy is tested without infrastructure.
- Application use cases are tested with fake ports.
- Provider adapters are contract-tested against product expectations.
- Regression tests protect Baileys upgrade decisions.

## Non-Principles

These are explicitly not Phase 1.1 decisions:

- No API endpoint design.
- No database schema design.
- No Prisma design.
- No Docker or deployment implementation.
- No Baileys internal design.
- No microservice extraction.
- No stable SDK package commitment.

## Review Rule

Any future architecture decision that violates these principles must be captured in a new ADR with explicit justification, risk, and mitigation.
