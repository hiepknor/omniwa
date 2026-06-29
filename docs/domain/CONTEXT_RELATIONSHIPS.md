# OmniWA Context Relationships

## Purpose

This document defines how bounded contexts may interact at strategic level.

It does not define implementation calls, REST endpoints, database joins, queues, topics, or source imports.

## Relationship Principles

- Application orchestration coordinates cross-context workflows.
- A context owns its own business state and rules.
- A context may depend on another context's published product contract, not its internal concepts.
- Provider-specific behavior crosses into product contexts only through the Provider Integration Anti-Corruption Layer.
- Webhook Delivery, Audit, Health, and Observability consume signals; they must not mutate source business state.
- Operations exposes async work lifecycle; it does not decide message, session, or webhook business outcomes.

## Allowed Context Interactions

| Source Context | Target Context | Interaction Style | Allowed Purpose | Forbidden Purpose |
| --- | --- | --- | --- | --- |
| Instance | Session | Partnership through Application | Coordinate lifecycle, pairing, active session, logout, revocation, and action-required state. | Reading or writing Secret session material directly. |
| Session | Instance | Partnership through Application | Report session availability and session action-required state to instance lifecycle. | Owning instance lifecycle or health policy. |
| Messaging | Session | Customer/Supplier through Application | Check product-level session availability before accepting or processing outbound message work. | Mutating session state or reading provider-native session payloads. |
| Messaging | Guardrails | Customer/Supplier through Application | Request allow/block/throttle decision for outbound message intent. | Bypassing guardrails or changing guardrail thresholds directly. |
| Messaging | Media | Partnership through Application | Coordinate media metadata readiness for image, video, document, and audio messages. | Owning media retention or binary storage concerns. |
| Media | Messaging | Partnership through Application | Report media accepted/processed/failed state for message lifecycle decisions. | Changing message delivery state directly. |
| Messaging | Provider Integration | Port and Anti-Corruption Layer | Request supported provider send behavior and consume translated message signals. | Using provider-native message payloads in domain policy. |
| Session | Provider Integration | Port and Anti-Corruption Layer | Consume translated authentication, logout, and invalid-session signals. | Storing provider-native session payload as a domain concept. |
| Instance | Provider Integration | Port and Anti-Corruption Layer | Consume translated connection readiness and disconnect signals. | Treating provider connection object as instance state. |
| Media | Provider Integration | Port and Anti-Corruption Layer | Consume translated media upload/download result signals. | Owning provider media transport implementation. |
| Product Contexts | Webhook Delivery | Published Language | Submit approved product signals for external integration delivery. | Mutating source product state from webhook delivery outcome. |
| Webhook Delivery | Operations | Customer/Supplier through Application | Track delivery jobs, retries, timeouts, and dead-letter visibility. | Owning queue engine or worker implementation. |
| Messaging | Operations | Customer/Supplier through Application | Track outbound message work lifecycle. | Letting Operations decide message business status without Messaging interpretation. |
| Media | Operations | Customer/Supplier through Application | Track media processing work lifecycle. | Letting Operations decide media product policy. |
| Session | Operations | Customer/Supplier through Application | Track recovery/backup work visibility. | Letting Operations own session state. |
| Security and Access | Product Contexts | Customer/Supplier through Application | Provide access decisions for privileged actions. | Owning product lifecycle state. |
| Product Contexts | Audit | Published Language | Provide selected Secret-safe evidence for audit records. | Storing raw Secret or raw Confidential payloads. |
| Product Contexts | Health | Published Language | Provide state changes and failure classifications for health projection. | Letting Health decide product lifecycle transitions. |
| Product Contexts | Observability | Sanitized Published Language | Provide safe telemetry signals and error classifications. | Requiring raw payload, Secret, or Confidential data exposure. |
| Configuration | Product Contexts | Customer/Supplier through Application | Provide validated configuration values and safety classification. | Silently disabling required guardrails or owning business outcomes. |

## Event-Only Relationships

These relationships must be signal-based at strategic level and cannot mutate source context state:

| Consumer Context | Consumed Signals | Rule |
| --- | --- | --- |
| Webhook Delivery | Approved product signals from Instance, Session, Messaging, Media, Guardrails, Health, Audit, and Operations. | May create delivery lifecycle state only. |
| Audit | Security-sensitive or operational evidence signals. | May create audit records only. |
| Health | Sanitized lifecycle/failure/dependency signals. | May create health projection only. |
| Observability | Sanitized telemetry and failure signals. | May create logs, metrics, traces, or projections only through adapters later. |

## Port-Only Relationships

These relationships must cross through Application-defined ports and adapters according to the frozen architecture.

| Boundary | Contexts Protected | Reason |
| --- | --- | --- |
| Provider boundary | Instance, Session, Messaging, Media | Prevent Baileys or future providers from shaping domain policy. |
| Secret boundary | Session, Security and Access, Audit | Prevent Secret leakage and keep secret storage implementation out of domain. |
| Queue boundary | Operations and all async workflows | Keep queue engine and worker implementation out of domain. |
| Webhook transport boundary | Webhook Delivery | Keep HTTP transport, signing, timeout, and external receiver mechanics out of domain. |
| Persistence boundary | All contexts | Keep database schema, ORM, transactions, and repository implementation out of domain. |
| Observability boundary | All contexts | Keep logging, metrics, tracing tooling out of domain. |
| Configuration source boundary | Configuration and product contexts | Keep environment/files/secrets loaders out of domain. |

## Relationship Matrix

| Context | May Depend On Product Contract From | Must Use Events Only For | Must Use Ports/Adapters For |
| --- | --- | --- | --- |
| Instance | Session, Health, Security and Access, Configuration | Webhook, Audit, Observability | Provider, persistence, secrets |
| Session | Instance, Security and Access, Configuration | Webhook, Audit, Observability, Health | Provider, secret storage, persistence |
| Messaging | Session, Guardrails, Media, Operations, Security and Access | Webhook, Audit, Observability, Health | Provider, queue, persistence |
| Media | Messaging, Configuration, Operations | Webhook, Audit, Observability, Health | Provider media, storage, persistence |
| Webhook Delivery | Product published language, Configuration, Operations | Audit, Observability, Health | Webhook transport, queue, persistence |
| Guardrails | Messaging, Configuration, Security and Access | Webhook, Audit, Observability, Health | Persistence if needed later |
| Provider Integration | Application provider ports, Configuration | Health, Observability through translated signals | Provider libraries |
| Operations | Product async work requests, Configuration | Audit, Observability, Health | Queue, workers, locks, persistence |
| Security and Access | Configuration | Audit, Observability, Health | Identity provider, secret provider |
| Audit | Security and Access, product evidence signals, Configuration | Observability, Health | Persistence, audit sink |
| Health | Sanitized product/dependency signals | Observability, Webhook if approved | Dependency probes |
| Configuration | Security and Access | Audit, Observability, Health | Configuration providers, secret providers |
| Observability | Sanitized product/failure language | None | Logging, metrics, tracing exporters |

## Forbidden Context Relationships

- Messaging must not own or mutate Session state.
- Session must not know Message Delivery lifecycle.
- Webhook Delivery must not modify source business state.
- Provider Integration must not contain business rules.
- Observability must not depend on business-context internals.
- Audit must not store raw Secret or raw Confidential payloads.
- Configuration must not act as a bypass path around Guardrails.
- Operations must not decide business meaning of a completed or failed job.
- Health must not trigger lifecycle changes without Application orchestration and owning-context rules.
- Shared Kernel must not contain business logic.
