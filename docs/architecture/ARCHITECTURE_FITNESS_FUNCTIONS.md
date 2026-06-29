# OmniWA Architecture Fitness Functions

## Purpose

This document defines architecture rules that should be checked during implementation planning and development.

Fitness functions are not source code in this phase. They describe rules, reasons, violation examples, and validation approaches.

## Fitness Function Summary

| Rule ID | Description | Severity |
| --- | --- | --- |
| AFF-001 | Domain must not import Infrastructure. | Blocker |
| AFF-002 | Application must not import concrete Infrastructure implementations. | Blocker |
| AFF-003 | Business logic must not import Baileys. | Blocker |
| AFF-004 | Interface must not call Infrastructure directly for product behavior. | Blocker |
| AFF-005 | Worker must not call Interface. | Blocker |
| AFF-006 | API/Interface must not publish Integration Events directly. | Blocker |
| AFF-007 | Messaging must not write Session state. | Blocker |
| AFF-008 | Session must not apply message business rules. | Blocker |
| AFF-009 | Provider must not own product policy. | Blocker |
| AFF-010 | Shared/Common must not contain business logic. | Blocker |
| AFF-011 | Secret data must never be logged. | Blocker |
| AFF-012 | Confidential payloads must be redacted from normal logs. | Blocker |
| AFF-013 | Accepted async work must have observable lifecycle state. | Blocker |
| AFF-014 | Webhook delivery must be async and retry-visible. | Blocker |
| AFF-015 | External provider failures must be classified. | Major |
| AFF-016 | Guardrails must not be silently bypassed by configuration. | Blocker |
| AFF-017 | Testing package must not be imported by production packages. | Major |
| AFF-018 | Provider adapter must not emit external webhook events directly. | Major |
| AFF-019 | Domain must not publish directly to EventBus, Queue, Log, or Webhook. | Blocker |
| AFF-020 | Runtime components must enter product behavior through Application use cases. | Major |

## AFF-001 - Domain Must Not Import Infrastructure

Description:

- Domain modules must not depend on infrastructure adapters, provider libraries, queue engines, persistence, log sinks, telemetry, or configuration loaders.

Reason:

- Protects product policy from technical churn and preserves Clean Architecture.

Violation Example:

- Messaging domain code imports a provider adapter to send a message.

How To Validate:

- Static import rules.
- Architecture tests.
- Code review checklist for domain packages.

## AFF-002 - Application Must Not Import Concrete Infrastructure

Description:

- Application may define and consume ports, but must not depend on concrete adapters.

Reason:

- Keeps use cases testable and replacement-friendly.

Violation Example:

- Application use case imports a concrete queue adapter instead of QueueProvider port.

How To Validate:

- Dependency graph check from application packages to infrastructure packages.
- Unit tests using fake ports.

## AFF-003 - Business Logic Must Not Import Baileys

Description:

- Only Provider infrastructure boundary may depend on Baileys.

Reason:

- Baileys is an implementation dependency, not product boundary.

Violation Example:

- Messaging or Session module accepts Baileys-native message/session types.

How To Validate:

- Search/import rule restricting Baileys package imports to provider adapter package.
- Provider contract tests.

## AFF-004 - Interface Must Not Call Infrastructure Directly

Description:

- Interface calls Application use cases only for product behavior.

Reason:

- Prevents transport layer from bypassing guardrails, validation, transaction, and audit rules.

Violation Example:

- Interface handler calls WebhookTransport or Provider adapter directly.

How To Validate:

- Import rules.
- Review interface package dependencies.

## AFF-005 - Worker Must Not Call Interface

Description:

- Worker executes application-owned jobs and must not depend on external entry surfaces.

Reason:

- Worker is runtime execution, not presentation or API mapping.

Violation Example:

- Worker reuses an Interface handler to run a retry workflow.

How To Validate:

- Import rule: worker/application runtime packages cannot import interface packages.

## AFF-006 - API/Interface Must Not Publish Integration Events Directly

Description:

- Integration events are prepared and owned by Webhook flows through Application.

Reason:

- Prevents external contract drift and bypassing redaction/retry rules.

Violation Example:

- Interface sends webhook event after a client request without going through Webhook module.

How To Validate:

- Import rules.
- Event publication review.

## AFF-007 - Messaging Must Not Write Session State

Description:

- Messaging may depend on session status through Application contract but must not own or mutate session state.

Reason:

- Session material and lifecycle are separate ownership concerns.

Violation Example:

- Messaging marks session disconnected after a send failure without Session workflow.

How To Validate:

- Module ownership tests.
- Review state mutation paths.

## AFF-008 - Session Must Not Apply Message Business Rules

Description:

- Session tracks session lifecycle, not message type support or delivery policy.

Reason:

- Prevents ownership bleed between session state and messaging behavior.

Violation Example:

- Session module rejects an outbound document message because of message-type policy.

How To Validate:

- Review Session package dependencies.
- Product rule ownership checklist.

## AFF-009 - Provider Must Not Own Product Policy

Description:

- Provider translates external behavior and implements ports; it does not decide product guardrails or business workflow eligibility.

Reason:

- Keeps provider replaceable and policy consistent.

Violation Example:

- Baileys adapter blocks broadcast-like behavior directly instead of returning data to Guardrails/Application.

How To Validate:

- Adapter contract tests.
- Review provider adapter for guardrail/business terms.

## AFF-010 - Shared/Common Must Not Contain Business Logic

Description:

- Shared/Common may contain policy-neutral primitives only.

Reason:

- Prevents hidden coupling and product logic escaping ownership.

Violation Example:

- Common contains `isSupportedMessageType` or guardrail policy.

How To Validate:

- Review shared package symbols.
- Import graph and naming rules.

## AFF-011 - Secret Data Must Never Be Logged

Description:

- API keys, webhook secrets, session/auth material, tokens, private keys, and equivalent Secret data must not appear in logs.

Reason:

- Required by Phase 0 data classification and logging strategy.

Violation Example:

- Provider logs raw session material during reconnect debugging.

How To Validate:

- Redaction tests.
- Secret scanning in test logs.
- Observability sink safe-field allowlist.

## AFF-012 - Confidential Payloads Must Be Redacted From Normal Logs

Description:

- Message bodies, media payloads, webhook payloads, phone numbers, JIDs, and contact names are redacted, hashed, truncated, or referenced.

Reason:

- Reduces privacy and security risk while preserving operations.

Violation Example:

- Webhook retry log includes full payload body.

How To Validate:

- Logging snapshot tests with sensitive fixtures.
- Observability safe-field validation.

## AFF-013 - Accepted Async Work Must Have Observable Lifecycle State

Description:

- Accepted async work must be visible as pending, retrying, completed, failed, dead-letter, or action-required.

Reason:

- Phase 0 requires 0 known silent drops.

Violation Example:

- Webhook delivery work is enqueued without durable lifecycle metadata or terminal state.

How To Validate:

- Workflow tests for each async use case.
- Job lifecycle state transition review.

## AFF-014 - Webhook Delivery Must Be Async And Retry-Visible

Description:

- Webhook delivery must not be inline-only or fire-and-forget.

Reason:

- Required for webhook success targets, retry handling, and downstream downtime mitigation.

Violation Example:

- Product use case sends webhook directly and ignores timeout/failure state.

How To Validate:

- Review Webhook interactions.
- Tests for receiver timeout/failure/retry/dead-letter paths.

## AFF-015 - External Provider Failures Must Be Classified

Description:

- Provider failures must become External Provider Error, action-required, retryable, or terminal categories before crossing boundaries.

Reason:

- Product must not leak raw provider errors or hide account/session conditions.

Violation Example:

- Baileys error object is returned directly to Application or Interface.

How To Validate:

- Provider contract tests.
- Error mapping tests for provider fixtures.

## AFF-016 - Guardrails Must Not Be Silently Bypassed By Configuration

Description:

- Configuration must not disable spam, broadcast, rate-limit, or abuse-risk guardrails without explicit approved decision.

Reason:

- Product posture is API platform with product-enforced guardrails.

Violation Example:

- Config flag disables broadcast blocking in production by default.

How To Validate:

- Configuration validation tests.
- Security review of feature flags and guardrail settings.

## AFF-017 - Testing Package Must Not Be Imported By Production Packages

Description:

- Test fakes and fixtures are test-scope only.

Reason:

- Prevents test behavior from leaking into production.

Violation Example:

- Provider runtime imports MockProvider from testing package in production path.

How To Validate:

- Import rule.
- Build packaging check.

## AFF-018 - Provider Adapter Must Not Emit External Webhook Events Directly

Description:

- Provider adapter sends translated events to Application; Webhook module owns external event preparation and delivery lifecycle.

Reason:

- Preserves redaction, retry, and integration event ownership.

Violation Example:

- Baileys adapter posts provider event directly to an external webhook receiver.

How To Validate:

- Provider adapter dependency scan.
- Webhook flow tests.

## AFF-019 - Domain Must Not Publish Directly To EventBus, Queue, Log, Or Webhook

Description:

- Domain creates events as facts; Application controls publication timing.

Reason:

- Preserves transaction boundary ownership and prevents hidden side effects.

Violation Example:

- Messaging domain object enqueues a webhook job directly.

How To Validate:

- Domain import restrictions.
- Domain event tests.

## AFF-020 - Runtime Components Must Enter Product Behavior Through Application Use Cases

Description:

- API Process, Worker Process, Scheduler, and Provider Adapter Runtime must invoke product behavior through Application use cases or ports.

Reason:

- Ensures guardrails, transactions, validation, audit, and observability are consistently applied.

Violation Example:

- Scheduler directly deletes expired records without Application retention workflow.

How To Validate:

- Runtime component dependency review.
- Architecture tests for runtime package imports.

## Validation Cadence

Fitness functions should be checked:

- During implementation planning before source layout is approved.
- In automated checks once source code exists.
- During ADR review for any boundary exception.
- Before Baileys upgrade acceptance.
- Before Phase 2 implementation readiness review.
