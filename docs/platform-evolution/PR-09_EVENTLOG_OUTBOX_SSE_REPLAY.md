# PR-09 - EventLog, Outbox, SSE Replay

## Status

Implemented as a production-readiness foundation.

This PR makes platform event visibility restart-safe by connecting Application notifications and
runtime provider signals to the durable EventLog/outbox boundary used by SSE replay.

## Scope Implemented

| Area                              | Status   | Notes                                                                                   |
| --------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| EventLog persistence              | Complete | In-memory and durable JSON EventLog stores persist event records and outbox state.      |
| Outbox idempotency                | Complete | Stable event IDs prevent duplicate event/outbox records.                                |
| Application notification bridge   | Complete | `EventLogInternalEventBus` persists notifications before invoking handlers.             |
| Runtime provider signal bridge    | Complete | Provider runtime signals publish to EventLog through `EventLogProviderSignalPublisher`. |
| SSE durable replay                | Complete | `createEventLogRealtimeEventSource` replays from retained durable EventLog records.     |
| Retention-aware cursor behavior   | Complete | `ok`, `no_cursor`, `not_found`, and `expired` cursor states are deterministic.          |
| Public-safe event payloads        | Complete | Event payload values are scalar-only and reject nested/provider-native data.            |
| Regression and release gate proof | Complete | EventLog and SSE replay specs are now part of required regression/release evidence.     |

## Boundary Rules Preserved

- EventLog is an infrastructure persistence boundary behind Application ports.
- SSE reads through `RealtimeEventSource`; API does not call persistence internals directly.
- Provider runtime does not import EventLog implementation directly; the EventLog sink is optional
  wiring through a signal-sink contract.
- Event payloads do not include raw provider socket data, session secrets, QR payloads, or nested
  request bodies.

## Runtime Flow

```text
Application notification
  -> EventLogInternalEventBus
  -> EventLog append
  -> Outbox pending record
  -> SSE replay source
```

```text
Provider runtime signal
  -> EventLogProviderSignalPublisher / Sink
  -> EventLog append
  -> Outbox pending record
  -> SSE replay source
```

## Cursor Semantics

| Cursor State | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| `no_cursor`  | Client requested the current retained stream start.       |
| `ok`         | Cursor is retained and replay begins after that cursor.   |
| `not_found`  | Cursor is unknown and not provably expired.               |
| `expired`    | Cursor sequence is older than the retained oldest cursor. |

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  packages/infrastructure-persistence/src/event-log-store.spec.ts \
  apps/api/src/realtime-event-stream.spec.ts \
  apps/api/src/http-server.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Wire the production downstream EventLog outbox publisher where integration dispatch is required.
- Provide target-environment evidence for the background outbox loop and PostgreSQL EventLog backend.
- Extend observability dashboards and alert routing with EventLog/outbox backlog and replay health
  metrics.
