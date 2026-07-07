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
| Local delete scope    | `instances:destroy`          |
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

Wire standard TUI screens from these surfaces first. Admin/operator-only rows are included for
contract completeness and should remain disabled by default unless the client is explicitly running in
an admin profile.

| Area      | Endpoint                                     | Status               | TUI use                                                                                                                                         |
| --------- | -------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Health    | `GET /v1/health`                             | `implemented_public` | Backend connectivity and top-level status.                                                                                                      |
| Instances | `GET /v1/instances`                          | `implemented_public` | Instance list screen with empty/loading/error support.                                                                                          |
| Instances | `GET /v1/instances/{id}`                     | `implemented_public` | Instance detail/status panel after selecting a list item.                                                                                       |
| Instances | `POST /v1/instances`                         | `implemented_public` | Optional create-instance action; requires `idempotency-key`.                                                                                    |
| Instances | `DELETE /v1/instances/{id}`                  | `implemented_public` | Admin/elevated destroy action; requires `instances:destroy` or `admin:*` and `idempotency-key`.                                                 |
| Sessions  | `GET /v1/instances/{id}/sessions`            | `implemented_public` | Instance-scoped sessions screen. Top-level `/v1/sessions` remains unavailable.                                                                  |
| Events    | `GET /v1/events`                             | `implemented_public` | Event history screen backed by EventLog replay; payload is redacted from DTOs.                                                                  |
| Realtime  | `GET /v1/events/stream`                      | `implemented_public` | SSE connection status and heartbeat support.                                                                                                    |
| Queue     | `GET /v1/queue`                              | `implemented_public` | Queue summary screen; queue engine internals and job payloads are not exposed.                                                                  |
| Jobs      | `GET /v1/jobs`                               | `implemented_public` | Jobs list screen; requires a credential with `jobs:read` or admin scope.                                                                        |
| Jobs      | `GET /v1/jobs/{id}`                          | `implemented_public` | Job detail/status panel; safe metadata and outbound intent refs are not exposed.                                                                |
| Messages  | `GET /v1/instances/{id}/messages`            | `implemented_public` | Instance-scoped message list; raw text, JID, provider payloads, and intent refs are not exposed.                                                |
| Messages  | `GET /v1/messages/{id}`                      | `implemented_public` | Message status/detail panel with safe status, type, direction, and instance ref.                                                                |
| Messages  | `POST /v1/instances/{id}/messages/text`      | `implemented_public` | Controlled text send action; requires `idempotency-key` and returns only operation metadata.                                                    |
| Messages  | `POST /v1/messages/{id}/retry`               | `implemented_public` | Retry eligible failed text messages as a new safe queued attempt; requires `idempotency-key`.                                                   |
| Messages  | `POST /v1/messages/{id}/cancel`              | `implemented_public` | Cancel eligible outbound messages before terminal delivery; requires `idempotency-key`.                                                         |
| Chats     | `GET /v1/instances/{id}/chats`               | `implemented_public` | Preferred instance-scoped chat list for TUI navigation.                                                                                         |
| Chats     | `GET /v1/chats/{id}`                         | `implemented_public` | Chat detail/status panel with safe unread, label, mute, and pin state.                                                                          |
| Contacts  | `GET /v1/instances/{id}/contacts`            | `implemented_public` | Preferred instance-scoped contact list. Raw JIDs and phone numbers are not exposed.                                                             |
| Contacts  | `GET /v1/contacts/{id}`                      | `implemented_public` | Contact detail/status panel with safe identity, instance ref, status, and display name.                                                         |
| Groups    | `GET /v1/instances/{id}/groups`              | `implemented_public` | Preferred instance-scoped group list. Raw group/member JIDs and invite links are not exposed.                                                   |
| Groups    | `GET /v1/groups/{id}`                        | `implemented_public` | Group detail/status panel with safe metadata, member counts, and local state.                                                                   |
| Groups    | `GET /v1/groups/{id}/members`                | `implemented_public` | Group members list using safe `memberRef` values only.                                                                                          |
| Groups    | `PATCH /v1/groups/{id}`                      | `implemented_public` | Update safe group metadata; requires `groups:write` and `idempotency-key`.                                                                      |
| Groups    | `PATCH /v1/groups/{id}/local-state`          | `implemented_public` | Update local mute/archive/pin state; requires `groups:write` and `idempotency-key`.                                                             |
| Groups    | `POST /v1/groups/{id}/members`               | `implemented_public` | Records a local add-member intent; returns `accepted`, not provider-backed completion.                                                          |
| Groups    | `DELETE /v1/groups/{id}/members/{ref}`       | `implemented_public` | Records a local remove-member intent by safe `memberRef`; returns `accepted`.                                                                   |
| Groups    | `POST /v1/groups/{id}/members/{ref}/promote` | `implemented_public` | Records a local promote-member intent by safe `memberRef`; returns `accepted`.                                                                  |
| Groups    | `POST /v1/groups/{id}/members/{ref}/demote`  | `implemented_public` | Records a local demote-member intent by safe `memberRef`; returns `accepted`.                                                                   |
| Webhooks  | `GET /v1/webhooks`                           | `implemented_public` | Webhook subscription list; target URLs are not exposed in public DTOs.                                                                          |
| Webhooks  | `GET /v1/webhooks/{id}`                      | `implemented_public` | Webhook subscription detail/status panel.                                                                                                       |
| Webhooks  | `GET /v1/webhook-deliveries`                 | `implemented_public` | Webhook delivery history list; use `status=dead_letter` plus optional `reasonCode` or `failureCategory` filters for operator remediation views. |
| Webhooks  | `GET /v1/webhook-deliveries/{id}/history`    | `implemented_public` | Webhook delivery detail/history panel.                                                                                                          |
| Webhooks  | `POST /v1/webhook-deliveries/{id}/retry`     | `implemented_public` | Controlled retry for eligible pending/retrying deliveries; requires `webhooks:retry` and `idempotency-key`.                                     |
| Webhooks  | `POST /v1/webhook-deliveries/{id}/redrive`   | `implemented_public` | Controlled redrive for eligible dead-lettered deliveries; returns the new queued delivery ref.                                                  |
| Webhooks  | `POST /v1/webhook-deliveries/redrive`        | `implemented_public` | Controlled bulk redrive for selected dead-lettered deliveries; requires an admin/elevated key.                                                  |
| API Keys  | `GET /v1/api-keys`                           | `implemented_public` | Admin/operator-only lifecycle list. Requires `admin:*`; never displays plaintext keys or hashes.                                                |
| API Keys  | `POST /v1/api-keys`                          | `implemented_public` | Admin/operator-only provision action. Request key is write-only and is not returned.                                                            |
| API Keys  | `POST /v1/api-keys/{id}/revoke`              | `implemented_public` | Admin/operator-only revoke action by safe key id.                                                                                               |
| API Keys  | `POST /v1/api-keys/{id}/rotate`              | `implemented_public` | Admin/operator-only rotate action. Replacement key is write-only and is not returned.                                                           |

Keep these disabled or read-only with a backend-not-ready state:

- Group message send, invite-link refresh, and provider-backed group member sync/execution
- Chat message timeline by chat id
- Media message send
- Logs
- Audit
- Settings
- Metrics

API key lifecycle routes are public platform APIs but are **not** recommended for default TUI
navigation. Only enable them in an explicit operator/admin mode after the capability manifest marks
`apiKeys.recommendedForTui` as suitable for that client profile and the credential has `admin:*`.

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
ADMIN_KEY=local-dev-secret-change-me # replace with an admin/elevated key when the local key is scoped

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
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: send-text-demo" -H "content-type: application/json" \
  -d '{"to":"contact_ref_demo","text":"Hello from OmniWA"}' "$BASE/v1/instances/inst_demo/messages/text"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: retry-message-demo" \
  "$BASE/v1/messages/msg_failed/retry"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: cancel-message-demo" \
  "$BASE/v1/messages/msg_queued/cancel"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo/chats"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/chats/chat_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo/contacts"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/contacts/contact_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/instances/inst_demo/groups"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/groups/group_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/groups/group_demo/members"
curl -sS -X PATCH -H "x-api-key: $KEY" -H "idempotency-key: update-group-demo" -H "content-type: application/json" \
  -d '{"subject":"Support"}' "$BASE/v1/groups/group_demo"
curl -sS -X PATCH -H "x-api-key: $KEY" -H "idempotency-key: archive-group-demo" -H "content-type: application/json" \
  -d '{"archived":true}' "$BASE/v1/groups/group_demo/local-state"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: add-group-member-demo" -H "content-type: application/json" \
  -d '{"jid":"12025550123@s.whatsapp.net"}' "$BASE/v1/groups/group_demo/members"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: promote-group-member-demo" \
  "$BASE/v1/groups/group_demo/members/group_demo%3Amember%3A1/promote"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhooks"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhooks/webhook_demo"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhook-deliveries"
curl -sS -H "x-api-key: $ADMIN_KEY" "$BASE/v1/webhook-deliveries?status=dead_letter&reasonCode=receiver_terminal_failure"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/webhook-deliveries/webhook_delivery_demo/history"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: retry-webhook-delivery-demo" \
  "$BASE/v1/webhook-deliveries/webhook_delivery_demo/retry"
curl -sS -X POST -H "x-api-key: $KEY" -H "idempotency-key: redrive-webhook-delivery-demo" \
  "$BASE/v1/webhook-deliveries/webhook_delivery_demo/redrive"
curl -sS -X POST -H "x-api-key: $ADMIN_KEY" -H "idempotency-key: bulk-redrive-webhook-delivery-demo" \
  -H "content-type: application/json" \
  -d '{"deliveryIds":["webhook_delivery_demo_1","webhook_delivery_demo_2"]}' \
  "$BASE/v1/webhook-deliveries/redrive"
curl -sS -H "x-api-key: $KEY" -H "idempotency-key: tui-create-1" \
  -H "content-type: application/json" -X POST "$BASE/v1/instances" -d '{}'
curl -sS -X DELETE -H "x-api-key: $ADMIN_KEY" -H "idempotency-key: destroy-instance-demo" \
  "$BASE/v1/instances/inst_demo"
curl -sS -N -H "x-api-key: $KEY" "$BASE/v1/events/stream"
```

Admin API-key lifecycle checks require a runtime configured with
`OMNIWA_API_KEY_LIFECYCLE_STORE_PATH` and an `admin:*` credential:

```sh
curl -sS -H "x-api-key: $ADMIN_KEY" "$BASE/v1/api-keys"
curl -sS -X POST -H "x-api-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"key":"new-secret","keyId":"api_key_operator","kind":"api_key","scopes":["instances:read"]}' \
  "$BASE/v1/api-keys"
curl -sS -X POST -H "x-api-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"reasonCode":"operator_requested"}' "$BASE/v1/api-keys/api_key_operator/revoke"
curl -sS -X POST -H "x-api-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"nextKey":"next-secret","nextKeyId":"api_key_operator_next","kind":"api_key","scopes":["instances:read"]}' \
  "$BASE/v1/api-keys/api_key_operator/rotate"
```

Group member mutations return `operationStatus: "accepted"` because the backend records the
controlled local action and audit evidence. Provider-backed WhatsApp synchronization for these
member actions is still outside the current scope. Group metadata and local-state mutations return
`completed` because they complete against OmniWA-owned local state.

Instance deletion returns `operationStatus: "accepted"` and tombstones the instance. TUI clients
should remove it from active list views after success, may keep detail views able to render
`status: "destroyed"`, and must treat provider-runtime disconnect as best-effort through the backend
bridge rather than as a raw provider operation. The action requires an `admin_key` with
`instances:destroy` or `admin:*`; clients should disable the destructive action when that capability is
absent.

Negative-state checks:

```sh
curl -sS "$BASE/v1/health"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/sessions"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/chats"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/contacts"
curl -sS -H "x-api-key: $KEY" "$BASE/v1/groups"
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
- Message send queued operation
- Message retry queued operation
- Message cancel accepted operation
- Chat collection list
- Chat detail/status
- Contact collection list
- Contact detail/status
- Group collection list
- Group detail/status
- Group members list
- API key lifecycle list
- API key provision/revoke/rotate operations
- Webhook delivery retry/redrive operations, including selected bulk redrive
- Webhook delivery dead-letter list filtered by `status=dead_letter`, `reasonCode`, or
  `failureCategory`
- SSE heartbeat

`omniwa-tui` should copy or consume these fixtures in its own test suite pinned to a backend
contract version.

## Do Not Do

- Do not call Application command/query names from TUI.
- Do not infer permissions by trying mutations at startup.
- Do not parse cursor internals.
- Do not display raw provider payloads, raw JIDs, phone numbers, or session material.
- Do not enable route-only mutations until the capability status changes to `implemented_public`.
