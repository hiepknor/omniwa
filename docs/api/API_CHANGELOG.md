# API Changelog

This changelog records public REST/OpenAPI contract changes after the
compatibility gate was introduced.

## Unreleased

Type: compatible-contract-promotion

Affected contract:

- `docs/api/openapi/omniwa-v1.openapi.json`
- `docs/api/client-contract/omniwa-tui-capabilities.json`
- `docs/api/client-contract/fixtures/api-keys.list.json`
- `docs/api/client-contract/fixtures/api-key.provisioned.json`
- `docs/api/client-contract/fixtures/api-key.revoked.json`
- `docs/api/client-contract/fixtures/api-key.rotated.json`
- `docs/api/client-contract/fixtures/message-send.queued.json`
- `docs/api/client-contract/fixtures/message-retry.queued.json`
- `docs/api/client-contract/fixtures/message-cancel.accepted.json`
- `docs/api/client-contract/fixtures/group-metadata.updated.json`
- `docs/api/client-contract/fixtures/group-local-state.updated.json`
- `docs/api/client-contract/fixtures/group-member.added.json`
- `docs/api/client-contract/fixtures/group-member.promoted.json`
- `docs/api/client-contract/fixtures/group-member.demoted.json`
- `docs/api/client-contract/fixtures/group-member.removed.json`
- `docs/api/client-contract/fixtures/webhook-deliveries.dead-letter.list.json`
- `docs/api/client-contract/fixtures/webhook-delivery-retry.queued.json`
- `docs/api/client-contract/fixtures/webhook-delivery-bulk-redrive.queued.json`

Client impact:

- Promotes controlled text send, message retry, and message cancel to
  `implemented_public` for clients that follow the capability manifest.
- Promotes controlled group metadata, local-state, add-member, remove-member,
  promote-member, and demote-member mutations to `implemented_public`.
- Promotes admin-only API key lifecycle routes to `implemented_public`:
  `GET /v1/api-keys`, `POST /v1/api-keys`,
  `POST /v1/api-keys/{keyId}/revoke`, and
  `POST /v1/api-keys/{keyId}/rotate`.
- Promotes `POST /v1/webhook-deliveries/{deliveryId}/retry` to
  `implemented_public` for eligible pending/retrying webhook deliveries.
- Promotes `POST /v1/webhook-deliveries/{deliveryId}/redrive` to
  `implemented_public` for eligible dead-lettered webhook deliveries; it queues
  a new safe delivery instead of mutating the terminal original delivery.
- Promotes `POST /v1/webhook-deliveries/redrive` to `implemented_public` for
  selected bulk redrive of dead-lettered webhook deliveries. The request accepts
  safe delivery ids only and returns an operation envelope without target URL,
  receiver payload, retry policy internals, or per-delivery raw details.
- Adds a required dead-letter delivery list fixture for
  `GET /v1/webhook-deliveries?status=dead_letter`, so operator clients can
  render remediation views and selected bulk redrive without guessing filter
  semantics.
- Group member mutations return `operationStatus: "accepted"` because they record
  controlled local intents and audit evidence; they do not imply provider-backed
  WhatsApp completion. Group metadata and local-state mutations remain
  `operationStatus: "completed"`.
- API key lifecycle routes require `admin:*` and return only safe key ids,
  credential kind, scopes, status, timestamps, and reason codes. Plaintext keys
  and `sha256:` hashes are not returned in public DTOs or fixtures.
- Webhook delivery retry requires `webhooks:retry` and `idempotency-key`, returns
  `operationStatus: "queued"`, and does not expose target URL, payload,
  retry-policy internals, or domain events.
- Webhook delivery redrive requires `webhooks:redrive` and `idempotency-key`,
  returns `operationStatus: "queued"`, and does not expose target URL, payload,
  retry-policy internals, or domain events.
- Bulk webhook delivery redrive requires `webhooks:redrive`, an elevated/admin
  credential when no explicit owner is available, and `idempotency-key`; it
  records a safe operation intent and does not expose selected target URLs,
  payloads, retry-policy internals, or domain events.
- Requires clients to use safe `memberRef` values from the group member list for
  remove/promote/demote actions.
- Keeps raw JID, text, provider payload, outbound intent refs, guardrail refs,
  group/member provider payload, raw group JID, raw member JID, and domain
  events out of public DTOs and fixtures.

SDK impact:

- Rust SDK already exposes generated `sendInstanceTextMessage`, `retryMessage`,
  `cancelMessage`, group mutation operations, `retryWebhookDelivery`, and
  generated API-key lifecycle operation ids; this change adds the generated
  `bulkRedriveWebhookDeliveries` operation and WebhooksClient helpers for
  dead-letter delivery listing and selected bulk redrive. Fixture coverage now
  validates retry/cancel, group action, webhook delivery retry/redrive, and
  API-key lifecycle contract envelopes.

Migration note:

- Clients should gate message mutations through the capability manifest and
  pass `idempotency-key` for every send, retry, and cancel request.
- Clients should gate group mutations through the capability manifest and pass
  `idempotency-key` for every metadata/local-state/member action request.
- Clients should gate webhook delivery retry/redrive through the capability
  manifest and pass `idempotency-key` for every retry or redrive request. Bulk
  redrive should stay in explicit operator/admin flows because it acts on a
  selected set of currently dead-lettered deliveries.
- Clients should keep API-key lifecycle UI disabled unless running in an explicit
  admin/operator mode with an `admin:*` credential.

## 0.1.0

Type: compatibility-baseline

Affected contract:

- `docs/api/openapi/omniwa-v1.openapi.json`
- `docs/api/openapi/omniwa-v1.compatibility.json`

Client impact:

- Establishes the initial `/v1` compatibility baseline.
- No public operation is removed or changed by this entry.

SDK impact:

- Rust SDK compatibility is validated through `pnpm sdk:check` and
  `pnpm sdk:test`.

Migration note:

- Existing pre-production clients should treat this as the stable contract
  starting point.

Compatibility baseline:

- Created.
