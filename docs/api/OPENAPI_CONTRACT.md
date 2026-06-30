# OpenAPI Contract

## Purpose

`docs/api/openapi/omniwa-v1.openapi.json` is the public REST contract for the
implemented platform route surface.

This file is the compatibility source for future SDK generation, API Explorer
work, third-party integrations, CLI, MCP, and OmniWA TUI.

## Scope

The contract covers:

- versioned `/v1` resource paths,
- `x-api-key` authentication,
- request id, correlation id, trace id, and idempotency headers,
- success, collection, accepted, and error envelopes,
- cursor pagination primitives,
- implemented Phase B route surface,
- Phase E projection read routes for platform clients,
- reserved partial routes that currently return safe `501` error envelopes.

The contract does not define:

- SDK package structure,
- OpenAPI-generated source code,
- provider-native payloads,
- database schema,
- business rules outside the frozen Application/Domain boundary,
- Groups, Chats, Contacts, Broadcast, or realtime streams.

## Compatibility Rules

- Public paths and operation ids must be resource-oriented.
- Operation ids must not expose Application command/query names.
- API changes require an OpenAPI update in the same change set.
- Request and response examples must use synthetic, safe placeholder data only.
- Public schemas must not expose API keys, webhook secrets, session material,
  raw provider payloads, raw phone numbers, raw JIDs, or raw message bodies in
  logs/examples.

## Validation

Run:

```text
pnpm openapi:check
```

The validation checks:

- the OpenAPI document shape,
- `ApiKeyAuth`,
- route coverage for the current platform API surface,
- success/error/pagination schemas,
- unique operation ids,
- no direct use of internal Application command/query names as operation ids,
- auth error coverage for every operation.

`pnpm check` includes this gate before `release:check`.

## Partial Routes

The following resources are intentionally present in the contract but reserved
with `501` responses until public ownership changes are approved:

| Route                                       | Reason                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /v1/instances/{instanceId}/reconnect` | Reconnect is scheduler-owned in the current Application catalog.        |
| `POST /v1/provider/capabilities/refresh`    | Provider refresh is scheduler-owned in the current Application catalog. |

## Phase C Checklist

| Item                                  | Status |
| ------------------------------------- | ------ |
| OpenAPI file created                  | PASS   |
| Public resource operations documented | PASS   |
| Error envelope documented             | PASS   |
| Pagination primitives documented      | PASS   |
| Auth scheme documented                | PASS   |
| Contract validation added             | PASS   |

**Phase C OpenAPI Contract is ready for SDK foundation work.**
