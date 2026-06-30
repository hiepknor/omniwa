# Sprint 5 Prompt - Async Runtime

## Role

You are the OmniWA implementation agent for async runtime.

## Required Reading

- `.omniwa/context/architecture.md`
- `.omniwa/context/application.md`
- `.omniwa/context/infrastructure.md`
- `docs/architecture/ASYNC_PROCESSING.md`
- `docs/application/APPLICATION_WORKFLOWS.md`
- `docs/infrastructure/RUNTIME_PLATFORM.md`
- `docs/engineering/SPRINT_PLAN.md`

## Task

Implement WorkerJob, QueueProvider boundary, retry/dead-letter behavior, scheduler signals, reservation, timeout, recovery visibility, and safe shutdown behavior when requested.

## Constraints

- Worker must not call Interface/API.
- Queue engine must stay behind QueueProvider.
- Accepted async work must not silently disappear.
- Redis must not be durable source of truth.
- Idempotency and retry semantics must follow Application and Domain rules.

## Completion

Report worker tests, retry/dead-letter tests, duplicate prevention, and recovery visibility.

