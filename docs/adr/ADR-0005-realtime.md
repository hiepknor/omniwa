# ADR-0005 Realtime

## Status

Proposed.

## Context

TUI, Web Dashboard, CLI watch mode, and integrations need live updates for instances, jobs, messages, webhooks, logs, and events. Current source has domain events and application notifications, but no realtime transport.

## Decision

Use Server-Sent Events as the initial realtime transport.

Initial endpoint:

```text
GET /v1/events/stream
```

WebSocket remains deferred until bidirectional client-server realtime control is required.

## Alternatives

| Alternative                  | Reason Rejected                                         |
| ---------------------------- | ------------------------------------------------------- |
| Polling only                 | Higher latency and unnecessary load for watch screens   |
| WebSocket first              | More complex than needed for read-only updates          |
| Provider-native event stream | Leaks provider details and bypasses product event model |

## Consequences

- Need EventLog projection and stream cursor.
- Need authorization on each stream.
- Need redacted event envelopes only.
- Polling remains fallback.

## Migration Plan

1. Add EventLog projection.
2. Add safe event envelope.
3. Add SSE route.
4. Add SDK streaming client.
5. Add TUI event subscription.
