# PR-17 Public Resource DTO Contract Stabilization

## Status

Implemented.

## Scope

PR-17 tightens the public REST contract after the PR-11 envelope and query
contract work.

Implemented capabilities:

- Public collection items are mapped through resource-specific DTO allowlists.
- Internal Application fields such as `kind`, `commandRef`, and `queryRef` are
  not emitted through public response data.
- Sensitive projection fields such as provider payloads, session material, raw
  phone numbers, and raw JIDs are not passed through by default.
- OpenAPI `PublicData` is a typed `oneOf` union instead of only a generic
  object.
- Rust SDK exposes typed DTO structs for operation results, resource reads,
  instance resources, and group member resources.

## Traceability

| Item                | Trace                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Production backlog  | `P1-01`, `P1-02`, `P1-03` in `PRODUCTION_EXECUTION_PLAN.md`             |
| API contract        | `docs/api/openapi/omniwa-v1.openapi.json`                               |
| Runtime adapter     | `apps/api/src/http-server.ts`                                           |
| SDK boundary        | `sdks/rust/omniwa-sdk/src/models.rs`                                    |
| Contract gate       | `tooling/api/check-openapi.mjs`                                         |
| Architecture policy | ADR-0001 Platform Boundary, ADR-0002 REST API, ADR-0007 Public Contract |

## Runtime Contract

Collection resources now use a resource-type mapper. The mapper:

- emits `resourceType` and a stable `id` when available,
- includes only approved public fields for the resource type,
- drops raw provider payloads and secret/session fields by omission,
- keeps cursor, limit, search, sort, and filter metadata unchanged.

Detail query responses continue to expose read metadata such as `readStatus`,
`consistency`, `freshness`, and `resultRef`, while adding safe resource fields
when the Application result contains them.

## OpenAPI Contract

`PublicData` now references typed schemas including:

- `OperationData`
- `ResourceReadData`
- `InstanceResource`
- `MessageResource`
- `GroupResource`
- `GroupMemberResource`
- `JobResource`
- `WebhookResource`

The OpenAPI checker fails if `PublicData` regresses to a generic-only object or
if required DTO schemas are missing.

## SDK Contract

The Rust SDK still supports generic `PublicData` for forward compatibility, but
now also exposes typed DTO structs for stable public resource decoding. This
prevents TUI, CLI, Web, and MCP clients from guessing response shapes.

## Compatibility

This is a pre-production stabilization change. It does not remove routes,
operation IDs, auth headers, error envelopes, or pagination metadata.

Potential client impact:

- clients that depended on unapproved projection fields in collection data must
  switch to the typed public DTO fields,
- clients that need a field not present in the DTO contract must request an
  explicit contract addition instead of parsing internal projection state.

## Verification

Targeted checks:

```text
pnpm exec vitest run apps/api/src/http-server.spec.ts
pnpm openapi:check
cargo test -p omniwa-sdk
```

Full gate:

```text
pnpm check
```
