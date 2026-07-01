# PR-11 Public DTO And Query Contract Stabilization

## Status

Implemented.

## Scope

PR-11 stabilizes the public REST contract so clients no longer receive internal
Application outcome shapes.

Implemented capabilities:

- HTTP success responses map Application command outcomes to public operation
  DTOs.
- HTTP success responses map Application query outcomes to public read DTOs.
- Collection query responses use `CollectionEnvelope` with `meta.pagination`
  and `meta.query`.
- Collection endpoints normalize `cursor`, `limit`, `sort`, `search`, and
  whitelisted filter fields before dispatch.
- `limit` is capped at `200`; unsupported filters and sorts are rejected before
  Application dispatch.
- OpenAPI pagination metadata documents effective `limit`, accepted `sort`,
  accepted `search`, and accepted `filters`.
- Rust SDK pagination DTOs decode the extended pagination metadata.

## Public DTO Contract

Public REST responses must not expose:

- `kind: "command_outcome"`
- `kind: "query_outcome"`
- internal command/query names as response data

Command responses now expose an operation-oriented shape:

```json
{
  "data": {
    "resourceType": "message",
    "resourceId": "inst_...",
    "operationStatus": "queued",
    "accepted": true,
    "retryable": false
  }
}
```

Detail query responses now expose a read-oriented shape:

```json
{
  "data": {
    "resourceType": "instance",
    "resourceId": "inst_...",
    "readStatus": "result",
    "consistency": "strong_owner"
  }
}
```

Collection responses use:

```json
{
  "data": [],
  "meta": {
    "pagination": {
      "nextCursor": null,
      "previousCursor": "cursor_1",
      "hasMore": false,
      "limit": 200
    },
    "query": {
      "resourceType": "instance",
      "readStatus": "result"
    }
  }
}
```

Until projection items are populated end to end, collection data may be empty
while the query and pagination contract remains stable.

## Query Whitelisting

Supported collection query controls:

| Parameter | Behavior                                                               |
| --------- | ---------------------------------------------------------------------- |
| `cursor`  | Opaque safe cursor value.                                              |
| `limit`   | Positive integer capped at `200`.                                      |
| `sort`    | Resource-specific field whitelist; optional `-` prefix for descending. |
| `search`  | Safe bounded search string.                                            |
| filters   | Resource-specific whitelisted query parameter names.                   |

Unsupported sort/filter fields return `400` with a public error envelope and do
not dispatch to Application.

## Backward Compatibility Review

This is a pre-production contract stabilization change. It is intentionally
breaking for any pre-production client that parsed internal Application
outcomes from public HTTP responses. The change aligns the implementation with
the accepted platform boundary and ADR-0007.

Compatible surfaces:

- Public URL paths are unchanged.
- Response envelope shape remains `data` plus `meta`.
- Error envelope shape is unchanged.
- SDK generic envelope decoding remains compatible and now decodes extended
  pagination metadata.

## Verification

Targeted checks used for this slice:

```text
pnpm exec vitest run apps/api/src/http-server.spec.ts
cargo test -p omniwa-sdk
pnpm openapi:check
pnpm sdk:check
```

Full repository quality gate:

```text
pnpm check
```
