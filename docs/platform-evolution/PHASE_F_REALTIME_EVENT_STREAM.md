# Phase F - Realtime Event Stream

## Purpose

Phase F adds a read-only realtime foundation for OmniWA platform clients without
introducing WebSocket, changing Domain write models, or bypassing the
Application/API boundary.

The goal is to support TUI watch mode, dashboard live updates, CLI watch mode,
and third-party integrations through safe Server-Sent Events.

## Required Context

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/QUERY_REALTIME_SDK_TUI_REVIEW.md`
- `docs/adr/ADR-0005-realtime.md`
- `docs/api/OPENAPI_CONTRACT.md`
- `docs/sdk/RUST_SDK_FOUNDATION.md`

## Deliverables

| Deliverable              | Status   | Notes                                                            |
| ------------------------ | -------- | ---------------------------------------------------------------- |
| EventLog projection      | Complete | Added retention-bound projection for safe product event history  |
| Event polling fallback   | Complete | `GET /v1/events` maps to `ListEvents` Application query          |
| SSE endpoint             | Complete | `GET /v1/events/stream` emits safe `text/event-stream` envelopes |
| Cursor resume            | Complete | Supports `cursor` query parameter and `Last-Event-ID` header     |
| Safe event envelope      | Complete | Payload values are restricted to safe scalars                    |
| OpenAPI update           | Complete | Added Events tag and stream operation                            |
| SDK streaming foundation | Complete | Added Events client and SSE parser helper                        |
| WebSocket                | Deferred | Still deferred until bidirectional semantics are required        |

## Public API

| Method | Path                | Purpose                                      |
| ------ | ------------------- | -------------------------------------------- |
| GET    | `/v1/events`        | Polling fallback for retained event log rows |
| GET    | `/v1/events/stream` | Read-only SSE stream of safe event envelopes |

## Authorization

Both event resources require authenticated API access.

| Resource            | Required Scope |
| ------------------- | -------------- |
| `/v1/events`        | `events:read`  |
| `/v1/events/stream` | `events:read`  |

`admin:*` also grants access.

## SSE Envelope

The SSE stream emits only redacted, safe event envelopes:

```text
id: cursor_1
event: message.delivered.v1
data: {"id":"evt_1","cursor":"cursor_1","type":"message.delivered.v1","version":"v1",...}
```

Rules:

- `id` is the resume cursor.
- `event` is a public event type, not an internal command/query name.
- `data` must not include provider-native payloads, secrets, raw session
  material, or nested unsafe objects.
- Unknown or expired cursors do not replay old data.
- WebSocket remains out of scope.

## Boundary Confirmation

- REST fallback goes through `ApiInterfaceAdapter`.
- SSE endpoint uses a safe `RealtimeEventSource` abstraction.
- SSE does not call Domain, Provider, Persistence, or Application internals
  directly.
- EventLog projection is derived state and can be rebuilt or disabled.
- SDK streaming helper only parses SSE text; it does not contain business logic.

## Risks

| Risk                                       | Mitigation                                                       |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Live source is still in-memory/snapshot    | Durable/live projection adapter remains a later platform step    |
| Event schema is intentionally minimal      | Future event DTOs can be added compatibly through OpenAPI/SDK    |
| High-volume streams could overload clients | Cursor and limit exist; filtering can be added incrementally     |
| Event payload leakage                      | Safe scalar envelope restriction and no provider-native payloads |

## Exit Criteria

| Criteria                            | Status |
| ----------------------------------- | ------ |
| EventLog projection defined         | PASS   |
| `ListEvents` query defined          | PASS   |
| REST polling fallback added         | PASS   |
| SSE endpoint added                  | PASS   |
| Cursor resume behavior tested       | PASS   |
| Safe payload rule tested            | PASS   |
| OpenAPI contract updated            | PASS   |
| Rust SDK streaming foundation added | PASS   |

**Phase F is complete.**

Recommended next phase: Phase G - Durable Persistence Review And Adapter.
