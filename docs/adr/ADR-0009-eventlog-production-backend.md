# ADR-0009 EventLog Production Backend

## Status

Accepted.

## Context

Claude platform review identified M2: the selected production durability backend for EventLog and
outbox is still local JSON/in-memory. OmniWA now has:

- `EventLogPort` and `EventOutboxPort` as synchronous Application ports.
- `InMemoryEventLogStore` and `DurableJsonEventLogStore` infrastructure implementations.
- SSE replay from the EventLog replay port.
- Safe provider signal ingestion into EventLog without raw QR/JID/text/auth-state payloads.
- A generic `EventOutboxConsumer` foundation that can drain pending outbox records through an
  injected publisher.

The remaining production blocker is selecting and wiring a durable production EventLog backend.
PostgreSQL is the approved durable source-of-truth store for current production state, but the
current EventLog contract is synchronous while the existing PostgreSQL adapter boundary is async.
Implementing a real PostgreSQL EventLog backend behind the current sync port would either force a
fake synchronous database path or push unsafe blocking behavior into runtime code.

This is an event, transaction, and async-job semantics decision. Per `AGENTS.md`, implementation
must stop and this ADR must be accepted before code changes rely on the new production EventLog
backend direction.

## Decision

Adopt an asynchronous EventLog boundary for production EventLog operations, with a compatibility
bridge for existing local synchronous stores during migration.

The proposed implementation direction is:

- Introduce async-capable EventLog ports in Application:
  - `AsyncEventLogAppendPort`
  - `AsyncEventLogReplayPort`
  - `AsyncEventOutboxPort`
  - `AsyncEventLogPort`
- Keep the payload and public event contracts unchanged:
  - `PlatformEventRecord`
  - `PlatformEventAppendInput`
  - `EventOutboxRecord`
  - `EventLogReplayResult`
  - SSE event envelope
- Provide an adapter that wraps current sync `EventLogPort` implementations for local/test/runtime
  code while migration happens.
- Implement a PostgreSQL EventLog store behind the async port in `packages/infrastructure-persistence`.
- Store event records and outbox records in PostgreSQL using versioned SQL migrations.
- Preserve idempotent append semantics by event id.
- Preserve monotonic cursor semantics with a database sequence or equivalent generated numeric
  sequence encoded as `eventlog:<sequence>`.
- Preserve retention behavior through explicit query limits and future cleanup policy instead of
  silent in-memory truncation.
- Wire production runtime profiles to the async PostgreSQL EventLog backend only after the adapter
  and tests exist.
- Keep local/dev support for in-memory and durable JSON EventLog stores through the compatibility
  wrapper until they are intentionally retired or left as non-production profiles.

This ADR does not change the public REST API, OpenAPI contract, Rust SDK contract, provider
abstraction, webhook payloads, or Domain model.

## Alternatives Considered

| Alternative                                                                            | Reason Rejected or Deferred                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Keep `EventLogPort` synchronous and implement PostgreSQL with blocking calls           | Node PostgreSQL access is async; a fake sync database path would be unsafe, brittle, and misleading for production readiness. |
| Keep durable JSON as the production EventLog backend                                   | JSON storage is acceptable for local deterministic replay but is not an adequate production event/outbox durability backend.  |
| Use Redis Streams for EventLog                                                         | Redis is not the approved durable source of truth; this would conflict with the rule that Redis is ephemeral infrastructure.  |
| Use a queue engine as EventLog                                                         | A queue can transport events, but it is not the retained query/replay source required by SSE and event history.               |
| Event sourcing for all aggregates                                                      | Too broad for the current blocker and would rewrite the persistence model.                                                    |
| Add a PostgreSQL backend only for outbox, leaving EventLog JSON                        | Splits event replay and publication state across stores, complicating idempotency, recovery, and operator evidence.           |
| Make API/SSE read directly from PostgreSQL tables while Application uses sync EventLog | Creates two EventLog models and risks contract drift between runtime writes and public reads.                                 |

## Consequences

### Positive

- Allows the production EventLog backend to use PostgreSQL correctly without blocking hacks.
- Keeps public event and SSE contracts stable for TUI, SDK, and integrations.
- Makes EventLog/outbox production durability testable with real PostgreSQL.
- Gives runtime code one explicit async boundary for append, replay, outbox drain, and mark-published.
- Preserves local/dev speed through sync-store compatibility wrappers.

### Negative

- Requires touching Application services that currently call `EventLogPort` synchronously.
- Requires adapter migration across API, worker, provider runtime, background, and tests.
- Introduces a wider async surface that must be reviewed for sequencing, error propagation, and
  shutdown behavior.
- Existing tests with fake sync EventLog ports need migration or wrapper helpers.

## Affected Documents

- `docs/IMPLEMENTATION_STATUS.md`
- `docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md`
- `docs/platform-evolution/PR-09_EVENTLOG_OUTBOX_SSE_REPLAY.md`
- `docs/reviews/CLAUDE_PLATFORM_REVIEW_2026-07-05.md`
- `packages/application/src/ports/event-log.ts`
- `packages/application/src/services/domain-event-publisher.ts`
- `packages/application/src/services/provider-signal-ingress.ts`
- `packages/infrastructure-persistence/src/event-log-store.ts`
- `packages/infrastructure-persistence/src/event-outbox-consumer.ts`
- `apps/api/src/realtime-event-stream.ts`
- Runtime composition files under `apps/*/src/runtime-composition.ts`

## Validation

Implementation after this ADR is accepted must prove:

- `pnpm arch:check` still passes and no Infrastructure imports enter Domain/Application contracts.
- Existing public SSE envelopes and event list DTOs remain backward compatible.
- Sync local stores can still run through compatibility wrappers.
- PostgreSQL EventLog append is idempotent by event id.
- PostgreSQL cursor generation is monotonic and stable across restarts.
- PostgreSQL replay supports `no_cursor`, `ok`, `not_found`, and `expired` or an explicitly
  documented production replacement for `expired`.
- PostgreSQL outbox records survive restart and can be drained by `EventOutboxConsumer`.
- Failed outbox publishes remain pending and do not leak raw provider payloads.
- EventLog payload validation continues to reject nested/raw provider-native data.
- Production runtime composition fails closed unless the selected production EventLog backend is
  configured.
- `pnpm check` and `pnpm test:postgres` pass.

## Migration Plan

1. Review and accept this ADR.
2. Add async EventLog port types while keeping existing sync `EventLogPort` for local compatibility.
3. Add a sync-to-async compatibility wrapper for `InMemoryEventLogStore` and
   `DurableJsonEventLogStore`.
4. Migrate Application services and realtime sources to the async port.
5. Add PostgreSQL EventLog migrations for event records and outbox records.
6. Implement `PostgresqlEventLogStore` behind the async port.
7. Add unit tests for compatibility wrappers and PostgreSQL contract tests for append, replay,
   idempotency, outbox drain, mark-published, and safe failure behavior.
8. Wire production runtime composition to require the PostgreSQL EventLog backend.
9. Update implementation status and production plan docs without editing freeze documents.
10. Run `pnpm check` and `pnpm test:postgres`.
