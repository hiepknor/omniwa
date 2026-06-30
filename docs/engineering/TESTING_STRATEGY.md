# OmniWA Testing Strategy

## Purpose

This document defines the testing strategy for OmniWA implementation.

It does not create test files, test runner configuration, package files, CI workflows, source code, or infrastructure.

## Testing Principles

- Test business rules at the Domain layer first.
- Test Application orchestration with fake ports.
- Test Infrastructure through contract tests against port semantics.
- Test Interface through contract mapping to commands/queries.
- Test runtime behavior through focused integration and end-to-end flows.
- Test redaction and sensitive-data safety before real provider integration.
- Test architecture rules continuously.

## Testing Pyramid

| Level | Purpose | Relative Weight |
|---|---|---:|
| Domain unit tests | Invariants, lifecycle, policies, specifications, factories, domain errors, event facts. | High |
| Application unit tests | Commands, queries, workflows, idempotency, transaction timing, event publication timing. | High |
| Contract tests | Repository ports, provider ports, queue ports, webhook transport, API contract mapping. | Medium |
| Integration tests | Persistence, queue, object storage, secret/config, observability adapters. | Medium |
| End-to-end tests | Critical product flows through runtime boundaries. | Low but mandatory |
| Performance and reliability tests | Queue age, webhook retry, reconnect, API latency, worker stability. | Targeted |
| Architecture tests | Import rules, dependency graph, forbidden package references, sensitive imports. | Mandatory |

## Unit Tests

Domain unit tests must cover:

- aggregate invariant protection,
- lifecycle transitions,
- supported and unsupported message type behavior,
- guardrail decisions,
- session usability,
- media retention rules,
- webhook retry policy,
- WorkerJob retry/dead-letter lifecycle,
- domain error categories,
- domain event facts.

Application unit tests must cover:

- command to use-case mapping,
- query side-effect freedom,
- workflow sequencing,
- idempotency replay and conflict behavior,
- transaction boundary ordering,
- access decision invocation,
- async work visibility before accepted response,
- provider signal translation consumption,
- error mapping.

## Integration Tests

Integration tests must verify adapters without changing inner contracts.

| Adapter Area | Required Integration Focus |
|---|---|
| Persistence | Repository semantics, projection rebuild, retention markers, idempotency state, no raw payload leaks. |
| Queue | Work reservation, retry, dead-letter, shutdown release, duplicate prevention, PostgreSQL WorkerJob reconciliation. |
| Provider | Translated provider signals, provider failure classification, no business policy in adapter. |
| Object Storage | Artifact references, retention cleanup, no raw identifiers in paths. |
| Secret Provider | Secret read/write boundary, rotation behavior, no plaintext fallback. |
| Webhook Transport | Signing, timeout, retry classification, replay protection after detail decision. |
| Observability | Redaction, safe labels/attributes, correlation propagation. |

## Contract Tests

Contract tests are mandatory for:

- repository ports,
- MessagingProvider/provider ports,
- QueueProvider,
- WebhookTransport,
- MediaStore/Object Storage port,
- SecretProvider,
- ConfigurationProvider,
- EventBus,
- API request/response/error/async contract mapping.

Contract tests must assert product semantics, not implementation details.

## Architecture Tests

Architecture tests must enforce:

- AFF-001 through AFF-020 from `ARCHITECTURE_FITNESS_FUNCTIONS.md`,
- no Domain import from Infrastructure,
- no Application import from concrete Infrastructure,
- no Baileys import outside provider adapter,
- no Interface direct infrastructure call for product behavior,
- no Worker import from Interface,
- no production import from Testing,
- no product policy in Shared,
- no raw Secret/Confidential logging paths,
- no provider-native payload in Domain/API contracts.

Architecture tests are merge blockers.

## Performance Tests

Performance validation must align with NFR and Success Metrics:

| Metric | Target |
|---|---|
| API latency | P95 under 500 ms for common non-media operations under normal MVP load. |
| Text enqueue latency | P95 under 300 ms under normal MVP load. |
| Media enqueue latency | P95 under 1 second excluding upload/download. |
| Queue age | Oldest pending item under 10 minutes under normal MVP load. |
| Webhook eventual success | 99% within 15 minutes for healthy downstream endpoints. |
| Reconnect | 85% auto-recoverable disconnects connected within 5 minutes. |
| Worker stability | No uncontrolled restart loop in a 24-hour controlled validation run. |

## End-to-End Tests

Required E2E flows:

- create instance and start QR pairing,
- session activation through translated provider signal,
- send text message accepted and queued,
- send supported media message accepted and queued,
- provider status update maps to message lifecycle,
- inbound message maps to webhook delivery,
- webhook retry then success,
- webhook retry exhaustion to dead-letter,
- reconnect workflow,
- action-required session/logout state,
- health and metrics safe read,
- audit query without secrets.

Provider-dependent E2E tests must use a controlled adapter or fake provider unless a real-provider validation run is explicitly approved.

## Coverage Targets

| Area | Target |
|---|---:|
| Domain critical invariants and policies | 95% branch coverage for implemented critical behavior |
| Application command/query/workflow logic | 90% branch coverage for implemented critical behavior |
| API mapping and error handling | 85% branch coverage for implemented critical behavior |
| Infrastructure adapters | Contract coverage for all port obligations |
| Architecture rules | 100% of blocker rules represented by checks |
| Redaction and Secret handling | 100% of sensitive fixture categories tested |

Coverage numbers do not replace review. A lower-risk module may justify lower line coverage, but critical invariants and safety rules cannot.

## Mock And Fake Strategy

- Use fakes for Application tests.
- Use deterministic Clock and UUID providers in tests.
- Use fake provider adapter for provider-independent workflows.
- Use fake webhook receiver for retry/dead-letter tests.
- Use sensitive-data fixtures for redaction tests.
- Do not mock Domain behavior in Application tests when the real Domain model is available.
- Do not use real Baileys for ordinary unit tests.

## Test Data Strategy

- Use generated safe product IDs.
- Do not use real phone numbers, real JIDs, real session material, real API keys, or real webhook secrets.
- Sensitive fixtures must be synthetic and clearly marked.
- Test data must include redaction cases for every Secret and Confidential class.
- Test data must include stale provider signals, duplicate idempotency keys, retry exhaustion, and unsupported message types.

## Test Gate Matrix

| Gate | Required Before Merge |
|---|---|
| Unit tests | Required for changed Domain/Application behavior. |
| Contract tests | Required for changed port or adapter behavior. |
| Architecture tests | Always required. |
| Redaction tests | Required for any logging, telemetry, webhook, API, provider, persistence, or audit change. |
| Integration tests | Required for adapter changes. |
| E2E smoke | Required before release candidate. |
| Performance tests | Required before production readiness review. |

## Checklist

| Item | Status |
|---|---|
| Testing pyramid defined | PASS |
| Unit strategy defined | PASS |
| Integration strategy defined | PASS |
| Contract strategy defined | PASS |
| Architecture tests defined | PASS |
| Performance targets defined | PASS |
| E2E flows defined | PASS |
| Coverage targets defined | PASS |
| Mock and test data strategy defined | PASS |

**Testing strategy is ready.**
