# API Changelog

This changelog records public REST/OpenAPI contract changes after the
compatibility gate was introduced.

## Unreleased

Type: compatible-contract-promotion

Affected contract:

- `docs/api/client-contract/omniwa-tui-capabilities.json`
- `docs/api/client-contract/fixtures/message-send.queued.json`
- `docs/api/client-contract/fixtures/message-retry.queued.json`
- `docs/api/client-contract/fixtures/message-cancel.accepted.json`

Client impact:

- Promotes controlled text send, message retry, and message cancel to
  `implemented_public` for clients that follow the capability manifest.
- Keeps raw JID, text, provider payload, outbound intent refs, guardrail refs,
  and domain events out of public DTOs and fixtures.

SDK impact:

- Rust SDK already exposes generated `sendInstanceTextMessage`, `retryMessage`,
  and `cancelMessage` operations; fixture coverage now validates retry/cancel.

Migration note:

- Clients should gate message mutations through the capability manifest and
  pass `idempotency-key` for every send, retry, and cancel request.

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
