# OmniWA Cross-Cutting Concerns

## Purpose

This document defines cross-cutting concerns for OmniWA Phase 1.3 module architecture.

It identifies which modules provide each concern, which modules consume it, and the architectural rules that prevent hidden coupling.

This document does not choose concrete libraries, middleware, API formats, database schemas, queue engines, Docker, or source code.

## Cross-Cutting Concern Matrix

| Concern | Provided By | Consumed By | Rule |
| --- | --- | --- | --- |
| Logging | Observability | All modules through ports/context | Structured, redacted, no Secret values. |
| Metrics | Observability, Health | Application, Worker, Scheduler, Provider, Webhook | Measure product and dependency behavior separately. |
| Tracing | Observability | Interface, Application, Worker, Provider, WebhookTransport | Use trace/correlation context without exposing payloads. |
| Validation | Validation, Domain modules | Interface, Application, product modules | Boundary shape validation is separate from domain invariants. |
| Authorization | Auth | Interface, Application, Admin/operator workflows | Auth decisions precede privileged use cases. |
| Configuration | Configuration | Application, Infrastructure adapters, platform modules | Validated, explicit, cannot silently bypass guardrails. |
| Serialization | Application/Webhook/Observability codecs | Webhook, EventBus, QueueProvider, Observability | Safe, version-aware where needed, no raw Secret serialization. |
| Clock | Clock extension point | Application, Worker, Scheduler, domain policy that needs time | Use abstraction for deterministic tests. |
| UUID | UUIDGenerator extension point | Application, product modules through Application | Deterministic in tests; safe as identifiers. |
| Error Mapping | Application, Interface, Provider adapter, Validation | All boundary-crossing modules | Classify before crossing boundaries. |
| Audit | Audit | Auth, Application, Admin workflows, recovery/retention/diagnostic flows | Evidence records, not debug logs; no Secret values. |
| Retry | Application, Worker, Webhook, Provider workflows | Worker, Webhook, Messaging, Instance/Session reconnect flows | Bounded, observable, terminal states required. |
| Correlation ID | Observability/Application context | Interface, Application, Worker, Provider, Webhook | Follows business workflow across boundaries. |
| Request ID | Interface/Application context | Interface, Application, Observability | Identifies one external entry interaction. |
| Secret Management | SecretProvider, Configuration, Auth, Session | Provider, Session, Auth, Configuration | Secret values never logged or exposed after capture. |

## Logging

Provider:

- Observability module provides structured logging contracts and redaction rules.

Consumers:

- Interface, Application, product modules, Provider, Worker, Scheduler, Webhook, Auth, Audit, Health.

Rules:

- Secret data must never be logged.
- Confidential data must be redacted, hashed, truncated, or replaced with references in normal logs.
- Provider-native payloads are not logged raw.
- Logging must include correlation ID where available.

## Metrics

Provider:

- Observability and Health modules provide metric concepts and safe emission.

Consumers:

- Application, Worker, Scheduler, Provider, Messaging, Webhook, Health.

Rules:

- Metrics must distinguish OmniWA-controlled behavior from provider/downstream failures.
- Metrics must support reliability targets for API availability, webhook success, reconnect success, queue success, MTTR, and accepted work visibility.
- Metrics must not include raw phone numbers, JIDs, message bodies, media payloads, webhook payloads, or Secret data.

## Tracing

Provider:

- Observability module provides trace context propagation concepts.

Consumers:

- Interface, Application, Worker, Provider, WebhookTransport, QueueProvider.

Rules:

- Trace IDs are operational identifiers, not product identifiers.
- Trace metadata must be safe for observability sinks.
- Tracing cannot become a dependency path that bypasses application use cases.

## Validation

Provider:

- Validation module provides boundary validation.
- Domain modules provide business invariant validation.

Consumers:

- Interface and Application before invoking workflows.
- Product modules during state transitions.

Rules:

- Validation module checks shape, required fields, supported scope, and normalization.
- Domain modules own lifecycle and business invariants.
- Guardrails module owns abuse, spam, rate-limit, and broadcast policy.

## Authorization

Provider:

- Auth module provides access context and access decision contracts.

Consumers:

- Interface and Application.

Rules:

- Public client, operator, and admin interactions must be separated.
- Privileged actions require audit.
- Authorization cannot be hidden inside provider, queue, or persistence adapters.

## Configuration

Provider:

- Configuration module and ConfigurationProvider extension point.

Consumers:

- Application, Infrastructure adapters, Auth, Observability, Provider, Worker, Scheduler.

Rules:

- Required configuration fails fast when missing or invalid.
- Secret configuration is Secret data.
- Product guardrails cannot be silently disabled through configuration.
- Domain modules must not read raw environment/config sources.

## Serialization

Provider:

- Application/Webhook/Observability define serialization safety requirements.
- SerializationCodec extension point supplies encoding/decoding behavior later.

Consumers:

- EventBus, QueueProvider, Webhook, Observability, Audit where records are emitted.

Rules:

- Serialized events must avoid raw Secret values.
- Confidential payloads must follow retention and redaction rules.
- External integration event formats are owned by Webhook, not by product modules directly.

## Clock

Provider:

- Clock extension point.

Consumers:

- Application, Worker, Scheduler, retention logic, retry logic, audit timestamps, health freshness checks.

Rules:

- Time-dependent logic uses Clock abstraction.
- Tests use deterministic clock.
- Domain time rules may use time values but must not read system time directly.

## UUID

Provider:

- UUIDGenerator extension point.

Consumers:

- Application workflows, job/event creation, correlation-related records.

Rules:

- ID generation must be replaceable for tests.
- IDs must not encode Secret or Confidential payloads.

## Error Mapping

Provider:

- Application owns product-level error classification.
- Interface maps classified errors to future presentation responses.
- Provider maps provider errors to External Provider Error categories.

Consumers:

- All modules crossing boundaries.

Rules:

- Error categories: Business, Validation, Infrastructure, External Provider, Security, Unknown.
- Unknown errors must be sanitized.
- Future HTTP mapping belongs to Interface.

## Audit

Provider:

- Audit module and AuditSink extension point.

Consumers:

- Auth, Application, Admin workflows, retention, diagnostic capture, recovery, secret/config changes.

Rules:

- Audit records must not expose Secret values.
- Audit is evidence for security-sensitive and operational actions.
- Debug logging cannot replace audit.

## Retry

Provider:

- Application defines retry policy ownership.
- Worker executes retry lifecycle.
- Webhook and provider workflows own domain-specific retry classification.

Consumers:

- Worker, Webhook, Messaging, Instance, Session, Provider.

Rules:

- Retries are bounded and observable.
- Exhausted work moves to terminal failed, dead-letter, or action-required state.
- Retried work requires idempotency strategy.

## Correlation ID

Provider:

- Observability/Application context.

Consumers:

- Interface, Application, Worker, Provider, Webhook, Audit, Health.

Rules:

- Correlation ID follows a business workflow across boundaries.
- It must be safe for logs and telemetry.
- It must not contain Secret or Confidential payloads.

## Request ID

Provider:

- Interface/Application context.

Consumers:

- Interface, Application, Observability.

Rules:

- Request ID identifies one external entry interaction.
- Async workflows should preserve correlation ID even when request ID no longer applies.

## Secret Management

Provider:

- SecretProvider, Configuration, Auth, Session.

Consumers:

- Provider, Session, Auth, Configuration, WebhookTransport where secrets are needed.

Rules:

- Secret values are encrypted in transit and at rest.
- Secret values are never logged.
- Secret values are never exposed in plaintext after creation or capture except through controlled secret-handling flows.
- Diagnostic capture must not bypass secret handling rules.

## Cross-Cutting Ownership Risks

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Observability becomes global side-channel | Sensitive data leakage and hidden coupling | Redaction tests, safe-field contracts, no raw payload logging. |
| Configuration controls product policy silently | Guardrails can be bypassed | Guardrail settings require product review and explicit validation. |
| Retry logic duplicated per module | Inconsistent terminal states | Application-owned retry policy and Worker execution boundary. |
| Validation absorbs domain rules | Weak domain ownership | Separate shape validation from business invariants. |
| Common becomes utility dumping ground | Hidden dependencies and business leakage | Fitness function: Shared/Common cannot contain business logic. |
