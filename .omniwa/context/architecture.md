# Architecture Context Summary

## Approved Style

OmniWA uses a Modular Monolith for MVP, with Clean Architecture and Hexagonal Ports and Adapters inside package boundaries.

The core dependency direction is:

```text
Interface
  -> Application
  -> Domain

Infrastructure implements ports owned by Application or Domain-facing contracts.
```

Business behavior enters through Application commands, queries, workflows, or approved ports. Infrastructure does not drive product policy.

## Key ADR Baseline

Accepted ADRs cover:

- Architecture style.
- Modular Monolith.
- Dependency rule.
- Layered architecture.
- Event-driven strategy.
- Adapter pattern.
- Provider abstraction.
- Configuration strategy.
- Error handling.
- Logging.
- Package boundary.
- Internal event bus.
- Async job strategy.
- Transaction boundary.
- Testability.
- Future evolution.

Read `docs/architecture/ARCHITECTURE_FREEZE.md` and the relevant ADR before changing structure.

## Non-negotiable Architecture Rules

- Business logic must not depend directly on Baileys.
- API must not call Domain, Provider, Baileys, database, queue, Redis, Object Storage, or Infrastructure directly for product behavior.
- Worker must not call Interface/API.
- Provider adapters must translate provider signals and must not own product policy.
- Domain must not publish directly to EventBus, Queue, Webhook, Log, Provider, or external systems.
- Application controls orchestration, transaction timing, idempotency, and event publication timing.
- Shared packages must not contain business logic.

## Runtime View

Approved runtime roles include API Runtime, Worker Runtime, Scheduler, Provider Runtime, Webhook Dispatcher, Projection Builder, Background Jobs, Metrics Exporter, and Health Runtime.

Runtimes communicate through approved Application workflows and ports. Runtime composition must not create hidden dependency paths.

## Extension Points

Approved extension points include MessagingProvider, SessionStore, MediaStore, QueueProvider, WebhookTransport, EventBus, Clock, UUIDGenerator, ConfigurationProvider, and SecretProvider.

Do not replace these with direct library calls in business paths.

## Architecture Escalation

Stop and create an ADR proposal if a task requires:

- a new framework or infrastructure technology,
- a package boundary change,
- direct cross-layer access,
- new provider capability semantics,
- a runtime topology change,
- a change to event, transaction, or queue semantics.

