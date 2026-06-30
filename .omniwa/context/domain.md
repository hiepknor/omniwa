# Domain Context Summary

## Domain Shape

The Domain model follows DDD strategic and tactical design. It defines bounded contexts, aggregates, value objects, domain events, repository ports, domain services, policies, specifications, factories, and domain errors.

Core product behavior belongs in Domain. Infrastructure, API, provider, database, queue, and framework concepts do not belong in Domain.

## Key Bounded Contexts

Important contexts include:

- Instance.
- Session.
- Messaging.
- Media.
- Webhook Delivery.
- Guardrails.
- Provider Integration.
- Operations.
- Security and Access.
- Audit.
- Health.
- Configuration.
- Observability.

Provider Integration is an anti-corruption boundary. It translates provider behavior into OmniWA language but does not own product policy.

## Aggregate Rules

Aggregate roots are the only mutation entry point for aggregate-owned state.

Approved aggregate roots include Instance, Session, Message, MediaAsset, WebhookSubscription, WebhookDelivery, GuardrailDecision, ProviderProfile, WorkerJob, AccessDecision, AuditRecord, HealthStatus, ConfigurationSnapshot, and TelemetrySignal.

Important invariants:

- One Instance has one active Session at a time.
- Session belongs to one Instance.
- Active and Revoked Session states cannot both be true.
- Message has one current lifecycle state.
- Supported MVP outbound message types are text, image, video, document, and audio.
- Guardrails run before outbound acceptance.
- Webhook delivery failure must not mutate the source business fact.
- Provider profile cannot expand Product Scope.
- WorkerJob cannot silently disappear.

## Domain Events

Domain Events represent business facts. Aggregate roots create Domain Events. Application decides publication timing and integration follow-up.

Infrastructure must not create Domain Events. Provider may produce translated signals, but those signals must be routed through Application and owner contexts.

## Repository Ports

Repository ports belong to the Domain model and preserve aggregate semantics. Repository implementations belong to Infrastructure.

Repository ports must not expose database concepts, provider-native payloads, queue-engine identifiers, broad reporting APIs, or Secret/raw Confidential data.

## Domain Escalation

Stop if a task needs to change:

- bounded contexts,
- aggregate boundaries,
- invariants,
- value object meaning,
- domain event meaning,
- repository port semantics,
- domain service or policy ownership.

Use the Domain Review template and propose a follow-up decision rather than implementing around the model.

