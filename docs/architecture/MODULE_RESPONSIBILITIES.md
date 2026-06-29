# OmniWA Module Responsibilities

## Purpose

This document defines module ownership for OmniWA Phase 1.3.

For each module it identifies owned data, use cases, business rules, events, interfaces, public/internal contracts, and explicit non-ownership.

This document does not define REST endpoints, database tables, queue implementation, source code, or provider internals.

## Ownership Vocabulary

| Term | Meaning |
| --- | --- |
| Public API | A conceptual module contract available to other modules through Application or approved ports. It is not a REST API. |
| Internal API | A module-local contract used inside the module boundary. |
| Internal Event | An event used inside OmniWA for local coordination or async work. |
| External Event | A product event intended for outbound integration, such as webhook delivery. |
| Data Ownership | Authority over lifecycle, invariants, retention classification, and mutation of a product concept. |

## Module Responsibility Matrix

| Module | Owns | Does Not Own |
| --- | --- | --- |
| Interface | Entry mapping, transport-neutral presentation mapping, request context extraction. | Business policy, provider logic, persistence, queue policy. |
| Application | Use-case orchestration, ports, transaction boundaries, event publication timing. | Domain invariants, adapter implementation, REST shape. |
| Instance | Instance lifecycle, instance health state, instance action-required state. | Session secrets, message delivery, webhook transport. |
| Session | Session status, session retention lifecycle, re-pairing/action-required state. | QR presentation, provider internals, message business rules. |
| Messaging | Supported message workflow, message delivery lifecycle visibility, message metadata policy. | Session storage, webhook delivery, campaign/broadcast. |
| Media | Supported MVP media metadata and processing policy. | Object storage implementation, default binary retention, unsupported message types. |
| Webhook | Integration event preparation and webhook delivery lifecycle. | External receiver uptime, raw provider event ownership, direct message send. |
| Guardrails | Rate-limit, abuse-risk, spam/broadcast prevention policy. | Legal compliance automation, user consent records outside OmniWA. |
| Provider | Provider abstraction implementation and provider event translation. | Product policy, guardrails, direct domain mutation. |
| Worker | Async job execution and lifecycle transitions. | Domain policy, queue engine implementation, external API exposure. |
| Scheduler | Scheduled product signals and maintenance workflows. | Cron/runtime implementation choice, business state mutation outside use cases. |
| Auth | Authentication/authorization concepts and access decision support. | Tenant billing, external identity provider implementation. |
| Configuration | Validated configuration concepts and safe settings access. | Business policy changes by config, secret plaintext exposure. |
| Audit | Audit record semantics for security-sensitive and operational actions. | General debug logging, business event ownership. |
| Observability | Logs, metrics, traces, health telemetry, redaction-safe emission. | Product decisions, raw payload retention. |
| Health | Product/dependency health state aggregation. | Provider reconnection policy, storage implementation. |
| Validation | Boundary validation and normalization rules. | Business invariants that belong to domain modules. |
| Common | Policy-neutral primitives only. | Business logic, provider types, persistence types. |
| Testing | Test fakes, contract fixtures, architecture rule helpers. | Production behavior. |

## Data Ownership Matrix

| Module | Owned Data / State | Not Owned Data / State |
| --- | --- | --- |
| Interface | Request context metadata while crossing the boundary; presentation mapping state. | Product records, provider payloads, queue state, session material. |
| Application | Use-case execution context, transaction boundary intent, port-level state transition commands. | Long-lived product data, adapter-native data, transport payload ownership. |
| Instance | Instance identity, lifecycle status, health summary, action-required state, instance operational metadata. | Session Secret material, message bodies, webhook payloads, provider-native connection state. |
| Session | Session product state, session availability, session action-required status, retention/deletion status. | Provider-native session format, QR presentation, message metadata, webhook state. |
| Messaging | Message metadata, message lifecycle state, inbound/outbound message classification, delivery attempt visibility. | Session state, binary media storage, external CRM records, broadcast/campaign data. |
| Media | Media metadata, media category classification, diagnostic capture state when explicitly enabled. | Default binary media retention, object storage internals, provider media transport details. |
| Webhook | Integration event metadata, delivery attempt metadata, retry/dead-letter/completed state, redacted payload references. | Original business event ownership, external receiver state, message delivery state. |
| Guardrails | Guardrail evaluation result, rate-limit/abuse-risk state, blocked/throttled/action-required classification. | Legal consent evidence outside OmniWA, provider policy state, campaign tooling data. |
| Provider | Provider translation state and compatibility mapping metadata inside adapter boundary. | Domain state, business policy, webhook delivery records, audit evidence. |
| Worker | Job execution context, lifecycle transition intent, retry execution state through queue port. | Queue engine storage internals, domain ownership, public request state. |
| Scheduler | Schedule signal metadata and maintenance trigger context. | Business state, scheduler engine internals, queue storage. |
| Auth | Access context, capability decision metadata, privileged action context. | Identity provider records, product workflow state, raw Secret storage implementation. |
| Configuration | Validated configuration concepts, configuration validation state, Secret-aware setting references. | Raw environment source ownership, product policy, secret plaintext. |
| Audit | Audit record semantics, audit metadata, security-sensitive action evidence. | General logs, raw Secret values, business event lifecycle. |
| Observability | Safe telemetry fields, correlation/request/trace context, redaction status, health signals for telemetry. | Raw payload retention, product decisions, Secret values. |
| Health | Aggregated health state, dependency degradation state, product-vs-external failure classification. | Provider reconnect policy, storage/queue implementation state. |
| Validation | Boundary validation result, normalized input shape metadata. | Domain lifecycle state, guardrail decisions, provider-native payload state. |
| Common | Policy-neutral identifiers and primitive value wrappers. | Product state, business records, technical adapter state. |
| Testing | Test fixture data and fake adapter state in test scope only. | Production data or production state. |

## Interface Module

Owns:

- Entry interaction mapping into application commands/queries.
- Request context extraction, including request ID and correlation ID where present.
- Presentation-safe result mapping.

Use cases:

- Accept product operations from future public/admin/operator surfaces.
- Invoke application use cases after authentication, authorization, and validation gates.

Business rules:

- None, except boundary-level checks delegated to Auth and Validation.

Events:

- Does not publish integration events directly.
- May attach request context to application calls.

Interfaces:

- Public API: external entry contract at conceptual level.
- Internal API: mapping helpers and presentation-safe result mapping.

Not owned:

- Product policy.
- Provider calls.
- Queue lifecycle.
- Storage access.

## Application Module

Owns:

- Use-case orchestration.
- Application ports for providers, stores, queue, event bus, webhook transport, logging, clock, UUID, secrets, and configuration.
- Transaction boundary decisions.
- Event publication timing and async job creation decisions.

Use cases:

- Coordinate instance lifecycle workflows.
- Coordinate supported message send/receive workflows.
- Coordinate webhook preparation and delivery work.
- Coordinate reconnect, recovery, retention, and diagnostic workflows.

Business rules:

- Workflow rules that span multiple domain modules.
- Guardrail enforcement sequencing.

Events:

- Publishes domain events through approved event bus timing.
- Creates async events/jobs for durable work.
- Emits integration events only through Webhook-owned flows.

Interfaces:

- Public API: use-case contracts consumed by Interface, Worker, Scheduler, and Provider event adapters.
- Internal API: transaction/event coordination contracts and port definitions.

Not owned:

- Domain invariants owned by product modules.
- Concrete provider, store, queue, logger, or webhook implementation.

## Instance Module

Owns:

- Instance identity inside one tenant boundary.
- Instance lifecycle state.
- Instance health and action-required product state.
- Instance-level operational metadata.

Use cases:

- Create, activate, suspend, delete, inspect, and recover instances at product level.
- Surface connection and action-required status.

Business rules:

- One deployment owns one tenant boundary with multiple instances.
- Instance deletion triggers retention and session cleanup expectations.
- Instance health must distinguish OmniWA-controlled state from provider/account state.

Events:

- Internal events: instance created, instance activated, instance suspended, instance deleted, instance health changed, instance action required.
- External events: sanitized instance lifecycle/status events when approved for webhook delivery.

Interfaces:

- Public API: instance lifecycle use-case contract through Application.
- Internal API: instance state transition policy.

Not owned:

- Session Secret material.
- Message delivery lifecycle.
- Provider reconnect mechanics.
- Webhook delivery retries.

## Session Module

Owns:

- Session lifecycle state at product level.
- Session action-required classification.
- Session retention and deletion expectations.
- Session backup/recovery product requirements.

Use cases:

- Track session availability.
- Mark session re-pairing required.
- Coordinate session cleanup after instance deletion through Application.

Business rules:

- Session material is Secret data.
- Session data is retained only while the instance is active and deleted within the approved window after instance deletion except encrypted backups.
- Session state must not be exposed in plaintext after capture.

Events:

- Internal events: session available, session disconnected, session action required, session expired, session deleted.
- External events: sanitized session status events only when safe and product-approved.

Interfaces:

- Public API: session status concept through Application.
- Internal API: session state transition and classification policy.

Not owned:

- QR rendering or presentation.
- Provider-native session format.
- Message rules.
- Credential storage implementation.

## Messaging Module

Owns:

- Supported MVP message workflows: text, image, video, document, audio.
- Message metadata lifecycle.
- Message delivery attempt visibility.
- Message status classification at product level.

Use cases:

- Accept supported outbound message intent.
- Classify inbound supported and unsupported message events.
- Track delivery lifecycle as accepted, pending, sent, failed, retried, action-required, or terminal.

Business rules:

- Broadcast and campaign sending are not supported in MVP.
- Unsupported message types are not send capabilities.
- Accepted message work must not silently disappear.
- Message body is not retained by default after processing.

Events:

- Internal events: message accepted, message rejected, message sent, message failed, inbound message received, unsupported message observed, delivery state changed.
- External events: sanitized message lifecycle events prepared through Webhook module.

Interfaces:

- Public API: supported messaging use-case contract through Application.
- Internal API: message type classification, delivery state transition rules.

Not owned:

- Session state or Secret material.
- Webhook transport.
- Provider-native payloads.
- CRM state.

## Media Module

Owns:

- Media metadata for supported MVP media types.
- Media processing policy at product level.
- Diagnostic media capture policy when explicitly enabled.

Use cases:

- Validate supported media category at product level.
- Coordinate media metadata with Messaging workflows.
- Enforce no-default-retention for binary media after processing.

Business rules:

- Image, video, document, and audio are supported MVP media categories.
- Binary media is not retained by default after processing.
- Diagnostic capture is explicit, temporary, and operator-visible.

Events:

- Internal events: media accepted, media rejected, media processed, media diagnostic capture enabled, media diagnostic capture expired.
- External events: sanitized media metadata events only through Webhook module where approved.

Interfaces:

- Public API: media handling contract through Messaging/Application.
- Internal API: media category and retention policy checks.

Not owned:

- Object storage implementation.
- Provider media upload/download internals.
- Message delivery status outside media processing.

## Webhook Module

Owns:

- Integration event preparation.
- Webhook delivery lifecycle.
- Delivery attempts, retry-visible states, failed/dead-letter/action-required classification.
- Webhook delivery retention metadata.

Use cases:

- Convert approved product events into integration events.
- Coordinate async webhook delivery through Application and Worker.
- Track delivery result and terminal state.

Business rules:

- Webhook delivery must be async and observable.
- External receivers are not trusted as part of OmniWA runtime.
- Healthy downstream endpoints are measured against approved success targets.
- Webhook payloads are Confidential and redacted from normal logs.

Events:

- Internal events: webhook delivery scheduled, delivery attempted, delivery succeeded, delivery failed, delivery dead-lettered.
- External events: product integration events delivered to webhook consumers.

Interfaces:

- Public API: webhook configuration/status contract through Application.
- Internal API: integration event preparation and delivery state transition rules.

Not owned:

- External receiver uptime.
- External CRM or automation state.
- Original domain event ownership.
- Direct provider callbacks.

## Guardrails Module

Owns:

- Product-enforced guardrail decisions for spam, broadcast, rate-limit, and abuse-risk states.
- Guardrail status visibility.
- Guardrail failure categories.

Use cases:

- Evaluate outbound message intent against MVP guardrails.
- Mark workflows blocked, throttled, failed, or action-required.
- Surface abuse-risk states to operators.

Business rules:

- Broadcast and campaign sending are not supported in MVP.
- Bulk recipient import for sending is not supported in MVP.
- Guardrails cannot be silently disabled by configuration.
- OmniWA provides guardrails but does not provide legal compliance automation.

Events:

- Internal events: guardrail passed, guardrail blocked, rate limit applied, abuse risk detected.
- External events: sanitized guardrail status events only when approved for webhook delivery.

Interfaces:

- Public API: guardrail evaluation contract through Application.
- Internal API: policy rule evaluation and classification.

Not owned:

- User consent collection outside OmniWA.
- Legal advice.
- Provider policy enforcement.

## Provider Module

Owns:

- MessagingProvider adapter implementation boundary.
- Provider-native event translation into OmniWA concepts.
- Provider error classification mapping.
- Provider compatibility surface for Baileys and future providers.

Use cases:

- Execute provider operations requested through application ports.
- Translate provider events into application-level signals.
- Keep provider-specific types outside domain policy.

Business rules:

- None. Provider must not own product policy.

Events:

- Internal events: provider event translated, provider failure classified, provider connectivity signal received.
- External events: none directly.

Interfaces:

- Public API: application-defined provider port implementation.
- Internal API: provider adapter mapping and compatibility contracts.

Not owned:

- Guardrail decisions.
- Message business invariants.
- Session retention policy.
- Webhook integration contracts.

## Worker Module

Owns:

- Async job execution coordination.
- Retry orchestration according to application-owned policy.
- Job lifecycle state transitions.

Use cases:

- Run webhook delivery jobs.
- Run provider retry/reconnect jobs where approved.
- Run media processing or cleanup jobs where approved.
- Move exhausted work to terminal failed, dead-letter, or action-required states.

Business rules:

- No domain rules; Worker applies application-owned workflow instructions.
- Accepted work must remain observable.

Events:

- Internal events: job started, job retried, job completed, job failed, job dead-lettered, job action required.
- External events: none directly.

Interfaces:

- Public API: worker execution contract through Application.
- Internal API: job lifecycle executor contract.

Not owned:

- Queue engine implementation.
- Product policy.
- Public API entry behavior.

## Scheduler Module

Owns:

- Scheduled application signals.
- Timing of retention checks, retry scans, reconnect checks, and health refresh triggers.

Use cases:

- Trigger retention cleanup.
- Trigger health aggregation refresh.
- Trigger reconnect/recovery checks through Application.

Business rules:

- No domain policy; all state-changing decisions are delegated to Application/domain use cases.

Events:

- Internal events: scheduled retention check, scheduled health check, scheduled reconnect check.
- External events: none directly.

Interfaces:

- Public API: scheduler trigger contract through Application.
- Internal API: schedule signal definitions.

Not owned:

- Runtime scheduler implementation.
- Business state mutation outside approved use cases.

## Auth Module

Owns:

- Authentication and authorization concepts.
- Access context and role/capability checks.
- Admin/operator access boundary classification.

Use cases:

- Validate actor context for public client, operator, and admin surfaces.
- Provide access decisions to Interface and Application.

Business rules:

- Admin actions require higher trust and audit.
- Public API and admin surfaces require authentication boundaries.

Events:

- Internal events: access granted, access denied, privileged action requested.
- External events: none directly.

Interfaces:

- Public API: access decision contract consumed by Interface/Application.
- Internal API: capability evaluation.

Not owned:

- Identity provider implementation.
- API key storage implementation.
- Product workflow policy outside authorization.

## Configuration Module

Owns:

- Validated configuration concepts.
- Safe access to runtime settings.
- Configuration classification, including Secret-aware values.

Use cases:

- Provide validated settings to Application and Infrastructure adapters.
- Fail fast for missing required configuration.

Business rules:

- Configuration cannot silently bypass product guardrails.
- Secret configuration is Secret data.

Events:

- Internal events: configuration loaded, configuration validation failed, unsafe configuration rejected.
- External events: none directly.

Interfaces:

- Public API: configuration provider contract through Application/infrastructure boundary.
- Internal API: configuration validation rules.

Not owned:

- Domain policy.
- Raw environment access in inner layers.
- Secret plaintext exposure.

## Audit Module

Owns:

- Audit event semantics.
- Audit retention classification.
- Security-sensitive and recovery action records.

Use cases:

- Record privileged actions.
- Record recovery and retention actions.
- Record sensitive configuration or diagnostic capture changes.

Business rules:

- Audit logs are retained for the approved retention window.
- Audit must not expose Secret values.

Events:

- Internal events: audit record requested, audit record written, audit record failed.
- External events: none directly unless a future product decision exposes audit integrations.

Interfaces:

- Public API: audit recording contract consumed by Application and platform modules.
- Internal API: audit event classification.

Not owned:

- General debug logs.
- Product domain event ownership.

## Observability Module

Owns:

- Structured logging concepts.
- Metrics and tracing concepts.
- Correlation ID, request ID, trace ID propagation support.
- Redaction-safe telemetry export.

Use cases:

- Emit sanitized logs and metrics.
- Correlate workflows across modules.
- Support health and incident diagnosis.

Business rules:

- Secret data must never be logged.
- Confidential data must be redacted, hashed, truncated, or referenced in normal logs.

Events:

- Internal events: telemetry emitted, redaction violation detected, health signal emitted.
- External events: sanitized telemetry to monitoring systems.

Interfaces:

- Public API: observability port consumed by Application/Infrastructure.
- Internal API: safe field/redaction rules.

Not owned:

- Business policy.
- Raw provider or webhook payload retention.

## Health Module

Owns:

- Health state aggregation.
- Product vs dependency health separation.
- Action-required health classification.

Use cases:

- Aggregate instance, provider, queue, storage, webhook, and observability health signals.
- Expose health summaries to Application/Interface.

Business rules:

- Health must distinguish OmniWA-controlled failures from upstream provider/account/downstream failures.

Events:

- Internal events: health state changed, dependency degraded, action required.
- External events: sanitized health status events where approved.

Interfaces:

- Public API: health summary contract through Application.
- Internal API: health classification.

Not owned:

- Reconnect policy.
- Provider implementation.
- Storage/queue implementation.

## Validation Module

Owns:

- Boundary validation.
- Input normalization.
- Product-scope shape checks before use-case execution.

Use cases:

- Validate message input shape at boundary.
- Validate configuration shape.
- Validate safe identifiers and metadata shape.

Business rules:

- Validation checks malformed or incomplete input.
- Domain invariants remain in domain modules.

Events:

- Internal events: validation failed, validation passed where operationally useful.
- External events: none directly.

Interfaces:

- Public API: validation contract used by Interface/Application.
- Internal API: schema-neutral validation rules.

Not owned:

- Product guardrail decisions.
- Domain lifecycle state.

## Common Module

Owns:

- Policy-neutral primitives.
- Generic identifiers.
- Generic result and error helper concepts.
- Time/UUID abstractions when policy-neutral.

Use cases:

- Provide shared primitives without product policy.

Business rules:

- None.

Events:

- None.

Interfaces:

- Public API: small, stable primitives.
- Internal API: none beyond primitive helpers.

Not owned:

- Product business logic.
- Provider-specific types.
- Persistence-specific types.
- Transport-specific types.

## Testing Module

Owns:

- Fake ports for application tests.
- Contract fixtures for provider/webhook/queue behavior.
- Architecture fitness function support.

Use cases:

- Validate dependency rules.
- Validate redaction and guardrail behavior.
- Support Baileys upgrade regression checklist through provider contracts.

Business rules:

- None in production.

Events:

- Test-only events and fixtures.

Interfaces:

- Public API: test support contracts for implementation-time test suites.
- Internal API: test fixtures.

Not owned:

- Production behavior.
- Product decisions.
