# OmniWA TUI Integration Contract

This document is the backend-side integration guide for the external Rust terminal client
`omniwa-tui`.

`omniwa-tui` must treat OmniWA as a platform backend. It must not call internal Application
commands, internal queries, repositories, providers, or package-private handlers. The supported
integration boundary is the public REST/SSE API plus generated or official SDK code.

## Source Of Truth

Use these files in this order:

1. `docs/api/client-contract/omniwa-tui-capabilities.json`
2. `docs/api/openapi/omniwa-v1.openapi.json`
3. `sdks/rust/omniwa-sdk/`
4. Public runtime smoke checks against `http://127.0.0.1:3000`

The capability manifest is machine-readable and is intended for client feature gating. OpenAPI
documents route shape and envelope shape. The SDK should be the preferred call surface once a method
exists there.

## Runtime Defaults

| Item                  | Value                        |
| --------------------- | ---------------------------- |
| Local base URL        | `http://127.0.0.1:3000`      |
| Base path             | `/v1`                        |
| API key header        | `x-api-key`                  |
| Local API key         | `local-dev-secret-change-me` |
| Request id header     | `x-request-id`               |
| Correlation id header | `x-correlation-id`           |
| Trace id header       | `x-trace-id`                 |
| Idempotency header    | `idempotency-key`            |
| SSE resume header     | `Last-Event-ID`              |

The backend returns `x-request-id` and `x-correlation-id` in HTTP responses. TUI logs and UI error
states should preserve both values.

## Envelope Contract

Success resource response:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_demo",
    "correlationId": "corr_demo",
    "timestamp": "2026-07-02T00:00:00.000Z"
  }
}
```

Collection response:

```json
{
  "data": [],
  "meta": {
    "requestId": "req_demo",
    "correlationId": "corr_demo",
    "timestamp": "2026-07-02T00:00:00.000Z",
    "query": {
      "resourceType": "instance",
      "readStatus": "empty"
    },
    "pagination": {
      "nextCursor": null,
      "previousCursor": null,
      "hasMore": false,
      "limit": 50
    }
  }
}
```

Error response:

```json
{
  "error": {
    "code": "missing_or_invalid_api_key",
    "message": "API request requires a valid x-api-key header.",
    "details": {
      "category": "authentication"
    }
  },
  "meta": {
    "requestId": "req_demo",
    "correlationId": "corr_demo",
    "timestamp": "2026-07-02T00:00:00.000Z"
  }
}
```

## Capability Status Meaning

| Status                         | TUI behavior                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `implemented_public`           | The endpoint is public and has a backend handler or transport that can be used now.                        |
| `route_exists_not_implemented` | Route exists and is documented, but the Application handler is not usable yet. Disable actions by default. |
| `internal_only`                | Backend may have internal code, but no supported public route. Never call it from TUI.                     |
| `missing`                      | No public route exists. Do not call it.                                                                    |
| `deprecated`                   | Do not add new usage.                                                                                      |
| `unknown`                      | Treat as disabled until the contract is updated.                                                           |

## Current TUI Integration Scope

Wire these first:

| Area      | Endpoint                                  | Status               | TUI use                                                                                          |
| --------- | ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Health    | `GET /v1/health`                          | `implemented_public` | Backend connectivity and top-level status.                                                       |
| Instances | `GET /v1/instances`                       | `implemented_public` | Instance list screen with empty/loading/error support.                                           |
| Instances | `GET /v1/instances/{id}`                  | `implemented_public` | Instance detail/status panel after selecting a list item.                                        |
| Instances | `POST /v1/instances`                      | `implemented_public` | Optional create-instance action; requires `idempotency-key`.                                     |
| Sessions  | `GET /v1/instances/{id}/sessions`         | `implemented_public` | Instance-scoped sessions screen. Top-level `/v1/sessions` remains unavailable.                   |
| Events    | `GET /v1/events`                          | `implemented_public` | Event history screen backed by EventLog replay; payload is redacted from DTOs.                   |
| Realtime  | `GET /v1/events/stream`                   | `implemented_public` | SSE connection status and heartbeat support.                                                     |
| Queue     | `GET /v1/queue`                           | `implemented_public` | Queue summary screen; queue engine internals and job payloads are not exposed.                   |
| Jobs      | `GET /v1/jobs`                            | `implemented_public` | Jobs list screen; requires a credential with `jobs:read` or admin scope.                         |
| Jobs      | `GET /v1/jobs/{id}`                       | `implemented_public` | Job detail/status panel; safe metadata and outbound intent refs are not exposed.                 |
| Messages  | `GET /v1/instances/{id}/messages`         | `implemented_public` | Instance-scoped message list; raw text, JID, provider payloads, and intent refs are not exposed. |
| Messages  | `GET /v1/messages/{id}`                   | `implemented_public` | Message status/detail panel with safe status, type, direction, and instance ref.                 |
| Webhooks  | `GET /v1/webhooks`                        | `implemented_public` | Webhook subscription list; target URLs are not exposed in public DTOs.                           |
| Webhooks  | `GET /v1/webhooks/{id}`                   | `implemented_public` | Webhook subscription detail/status panel.                                                        |
| Webhooks  | `GET /v1/webhook-deliveries`              | `implemented_public` | Webhook delivery history list; retry policy internals are not exposed.                           |
| Webhooks  | `GET /v1/webhook-deliveries/{id}/history` | `implemented_public` | Webhook delivery detail/history panel.                                                           |

Keep these disabled or read-only with a backend-not-ready state:

- Chats
- Contacts
- Groups
- Group members
- Message send/retry/cancel actions
- Logs
- Audit
- Settings
- Metrics

## Realtime Contract

SSE path:

```text
GET /v1/events/stream
```

Auth uses the same `x-api-key` header. Resume is supported through either `cursor` query parameter
or `Last-Event-ID` header. The stream includes comment heartbeats:

```text
: omniwa-stream requestId=req_demo correlationId=corr_demo timestamp=2026-07-02T00:00:00.000Z

: heartbeat
```

Event payloads use:

```text
id: <cursor>
event: <event-type>
data: {"id":"...","cursor":"...","type":"...","version":"v1","timestamp":"...","dataClassification":"public|internal|confidential","source":"...","payload":{}}
```

The local runtime may emit only heartbeat comments when there are no retained events. TUI should
treat a connected heartbeat-only stream as connected, not as an error.

## Client State Mapping

| Backend condition                                                                                     | TUI state               |
| ----------------------------------------------------------------------------------------------------- | ----------------------- |
| Request in flight                                                                                     | loading                 |
| Collection `data: []` and `readStatus: empty`                                                         | empty                   |
| `401` with `missing_or_invalid_api_key`                                                               | auth error              |
| `403` with `missing_scope`                                                                            | permission denied       |
| `404` with `route_not_found`                                                                          | feature unavailable     |
| Success envelope with `readStatus: unavailable` and `reasonCode: application_handler_not_implemented` | backend not implemented |
| SSE heartbeat received                                                                                | realtime connected      |
| Timeout/network error                                                                                 | transport error         |

## Local Verification

```sh
BASE=http://127.0.0.1:3000
KEY=local-dev-secret-change-me

curl -sS -H "x-api-key: $KEY" "$BASE/v1/health"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo/sessions"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/events"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/queue"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/jobs"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/jobs/job_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo/messages"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/messages/msg_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhooks"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhooks/webhook_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhook-deliveries"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhook-deliveries/webhook_delivery_demo/history"
curl -sS -H "x-api-key: $KEY" -H "idempotency-key: tui-create-1" \
  -H "content-type: application/json" -X POST "$BASE/v1/instances" -d '{}'
curl -sS -N -H "x-api-key: $KEY" "$BASE/v1/events/stream"
```

Negative-state checks:

```sh
curl -sS "$BASE/v1/health"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/sessions"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/groups"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/groups/group_1"
```

## Fixtures

Client parser fixtures live in `docs/api/client-contract/fixtures/`.

Required fixture states:

- Health success
- Missing API key error
- Instance collection empty
- Instance collection list
- Message collection list
- Message detail/status
- Group route exists but handler unavailable
- SSE heartbeat

`omniwa-tui` should copy or consume these fixtures in its own test suite pinned to a backend
contract version.

## Do Not Do

- Do not call Application command/query names from TUI.
- Do not infer permissions by trying mutations at startup.
- Do not parse cursor internals.
- Do not display raw provider payloads, raw JIDs, phone numbers, or session material.
- Do not enable route-only mutations until the capability status changes to `implemented_public`.
