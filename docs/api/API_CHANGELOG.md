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

Client impact:

- Promotes controlled text send, message retry, and message cancel to
  `implemented_public` for clients that follow the capability manifest.
- Promotes controlled group metadata, local-state, add-member, remove-member,
  promote-member, and demote-member mutations to `implemented_public`.
- Promotes admin-only API key lifecycle routes to `implemented_public`:
  `GET /v1/api-keys`, `POST /v1/api-keys`,
  `POST /v1/api-keys/{keyId}/revoke`, and
  `POST /v1/api-keys/{keyId}/rotate`.
- Group member mutations return `operationStatus: "accepted"` because they record
  controlled local intents and audit evidence; they do not imply provider-backed
  WhatsApp completion. Group metadata and local-state mutations remain
  `operationStatus: "completed"`.
- API key lifecycle routes require `admin:*` and return only safe key ids,
  credential kind, scopes, status, timestamps, and reason codes. Plaintext keys
  and `sha256:` hashes are not returned in public DTOs or fixtures.
- Requires clients to use safe `memberRef` values from the group member list for
  remove/promote/demote actions.
- Keeps raw JID, text, provider payload, outbound intent refs, guardrail refs,
  group/member provider payload, raw group JID, raw member JID, and domain
  events out of public DTOs and fixtures.

SDK impact:

- Rust SDK already exposes generated `sendInstanceTextMessage`, `retryMessage`,
  `cancelMessage`, group mutation operations, and generated API-key lifecycle
  operation ids; fixture coverage now validates retry/cancel, group action, and
  API-key lifecycle contract envelopes.

Migration note:

- Clients should gate message mutations through the capability manifest and
  pass `idempotency-key` for every send, retry, and cancel request.
- Clients should gate group mutations through the capability manifest and pass
  `idempotency-key` for every metadata/local-state/member action request.
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
