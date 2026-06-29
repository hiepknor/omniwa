# OmniWA Domain Boundaries

## Purpose

This document defines where domain behavior belongs and where it must not leak.

It aligns Phase 2.1 domain design with the frozen Phase 1 architecture.

## Boundary Decision

| Concern | Lives In | Does Not Live In | Reason |
| --- | --- | --- | --- |
| Business logic | Owning domain context | Interface, Infrastructure, provider adapter, queue, logger, database, telemetry | Keeps product behavior stable and testable. |
| Business rule | Owning domain context | Provider Integration, Webhook transport, Worker runtime, REST boundary | Prevents technical dependencies from becoming product policy. |
| Workflow orchestration | Application | Domain, Interface, Infrastructure | Application coordinates contexts, publication timing, ports, and transaction boundaries later. |
| Provider translation | Provider Integration / Infrastructure adapter boundary | Domain policy | Protects product language from Baileys and future providers. |
| Validation of input shape | Interface/Application validation boundary | Domain invariants replacement | Shape validation is not a substitute for product rules. |
| Domain invariant | Owning domain context | Database constraint only, queue rule, provider response, API response | Product rules must exist independent of storage and transport choices. |
| Event publication timing | Application | Domain | Domain creates facts; Application controls when and where signals are published. |
| Persistence | Infrastructure through ports | Domain | Database and ORM decisions are deferred. |
| Queue processing | Infrastructure/Worker through ports and Application | Domain | Queue engine and worker implementation are deferred. |
| Logging, metrics, tracing | Observability context and infrastructure adapters | Business contexts as raw payload sinks | Protects Secret and Confidential data. |
| Secret handling implementation | Infrastructure through SecretProvider boundary | Domain policy except data classification rules | Domain names Secret sensitivity, but does not implement secret storage. |

## Business Logic Placement

Business logic belongs in the context that owns the capability:

- Instance lifecycle rules belong to Instance.
- Session state and Secret-sensitive session policy belong to Session.
- Message acceptance, supported type classification, and delivery lifecycle rules belong to Messaging.
- Media metadata, processing status, and retention rules belong to Media.
- Webhook delivery lifecycle and dead-letter policy belong to Webhook Delivery.
- Responsible usage decisions belong to Guardrails.
- Async work lifecycle visibility belongs to Operations.
- Access decisions belong to Security and Access.
- Audit evidence semantics belong to Audit.
- Health classification belongs to Health.
- Configuration safety belongs to Configuration.
- Telemetry safety vocabulary belongs to Observability.

## Infrastructure Placement

Infrastructure later implements ports for:

- Provider adapters.
- Persistence adapters.
- Queue adapters.
- Webhook transport adapters.
- Secret provider adapters.
- Configuration source adapters.
- Logging, metrics, and tracing exporters.
- Dependency health probes.

Infrastructure may translate, persist, send, receive, and observe. It must not decide product policy.

## Provider Boundary

Provider Integration is an Anti-Corruption Layer.

Allowed:

- Translate OmniWA product requests to provider operations.
- Translate provider signals into product-level signals.
- Classify provider failures into product failure categories.
- Hide provider-native payloads from domain contexts.

Forbidden:

- Own business rules.
- Decide guardrail behavior.
- Publish webhook events directly.
- Mutate domain state directly.
- Expose Baileys-native payloads to domain policy.
- Log raw provider payloads.

## Application Boundary

Application owns orchestration, not domain policy.

Allowed:

- Coordinate use cases across contexts.
- Call domain behavior in the correct order.
- Control event publication timing.
- Use ports for provider, queue, persistence, webhook transport, logging, clock, UUID, secrets, and configuration.
- Map domain outcomes to future interface responses later.

Forbidden:

- Put core business rules in orchestration code.
- Depend on concrete provider, queue, persistence, or telemetry libraries.
- Bypass Guardrails for outbound message acceptance.
- Treat provider side effects as local transactions.

## Interface Boundary

Interface is an external entry boundary.

Allowed:

- Authenticate/extract request context through approved Application flow.
- Perform boundary shape validation.
- Map future transport details to Application requests.
- Map Application outcomes to future transport responses.

Forbidden:

- Own business policy.
- Call provider adapters.
- Publish domain or integration events directly.
- Own queue, retry, or persistence policy.
- Use provider-native payloads as domain input.

## Domain Constraints

- Messaging Context must not own Session.
- Session Context must not know Message Delivery lifecycle.
- Webhook Delivery Context must not modify Business State owned by source contexts.
- Provider Integration Context must not have Business Rule.
- Observability Context must not depend on Business Context internals.
- Instance Context must not store Session Secret material.
- Media Context must not retain media bodies by default.
- Guardrails Context must not be disabled silently through Configuration.
- Operations Context must not decide product meaning of async job outcomes.
- Audit Context must not store raw Secret or raw Confidential data.
- Health Context must not trigger product lifecycle changes without owning-context rules and Application orchestration.
- Shared Kernel must not contain Business Logic.
- Domain must not import Interface, Application, Infrastructure, provider, queue, persistence, logging, telemetry, configuration-source, framework, or transport concerns.
- Domain must not open, commit, or roll back transactions.
- Domain must not publish directly to EventBus, Queue, Webhook, Log, Provider, or external systems.
- Domain must not use provider-native payloads as domain inputs.
- Domain must not contain REST/API response concepts.
- Domain must not contain database schema or ORM concepts.
- Domain must not contain queue engine or worker implementation concepts.

## Domain Principles

### High Cohesion

Each context should own a narrow set of related product concepts and rules.

Benefit: behavior is easier to review, test, and change.

Trade-off: cross-context workflows need explicit contracts.

### Low Coupling

Contexts should depend on published product contracts, not internal data structures.

Benefit: future changes to a context are less likely to break unrelated behavior.

Trade-off: more translation and coordination are required at boundaries.

### Single Source Of Truth

Only the owning context may decide the meaning of its state.

Benefit: prevents contradictory lifecycle and status decisions.

Trade-off: downstream contexts must ask for or consume approved signals instead of reading internal state.

### Ownership

Every product capability must have exactly one owning context.

Benefit: review, testing, and future implementation ownership are clear.

Trade-off: shared workflows must be decomposed into owned decisions and Application coordination.

### No Shared Mutable State

Contexts must not share mutable business state.

Benefit: prevents hidden coupling, inconsistent state changes, and accidental bypasses.

Trade-off: state projections are needed for read models, health, audit, and observability later.

### Explicit Contract

Every cross-context interaction must be expressible as a product contract, event signal, or port boundary.

Benefit: boundaries can be tested and evolved.

Trade-off: vague direct access is disallowed even if it appears faster in early implementation.

## Sensitive Data Boundary

| Data Category | Domain Handling Rule |
| --- | --- |
| Public | May appear in documentation and non-sensitive status where appropriate. |
| Internal | May be used for operations but should not be exposed externally unless intentionally mapped. |
| Confidential | Must be redacted in normal logs and telemetry. Message bodies, media payloads, webhook payloads, phone numbers, and JIDs are Confidential. |
| Secret | Must never be logged or exposed in plaintext outside controlled secret-handling flows. API keys, webhook secrets, session/auth material, tokens, and private keys are Secret. |

## Boundary Validation Questions

Before adding a future domain rule, the team must answer:

| Question | Required Answer |
| --- | --- |
| Which context owns this rule? | Exactly one owning context. |
| Does this depend on provider-native data? | If yes, translate through Provider Integration first. |
| Does this require persistence/queue/API concepts? | If yes, move those concerns outside domain. |
| Can this expose Secret or raw Confidential data? | If yes, redesign or add redaction/classification. |
| Is this a product decision or implementation mechanism? | Product decisions belong to domain; mechanisms belong to Application/Infrastructure. |
| Does this change frozen scope? | If yes, require product decision and ADR before proceeding. |
