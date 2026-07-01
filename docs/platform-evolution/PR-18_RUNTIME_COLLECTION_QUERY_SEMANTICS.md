# PR-18 Runtime Collection Query Semantics

## Status

Implemented.

## Scope

PR-18 completes the runtime side of the public collection query contract for
the current REST adapter slice.

Implemented capabilities:

- Collection responses apply safe filters to public DTO fields.
- Collection responses apply safe search only across public string DTO fields.
- Collection responses apply whitelisted ascending or descending sort fields.
- Collection responses apply server-side `limit` and cursor pagination.
- Cursor tokens are opaque, scoped to query name, limit, filter, sort, and
  search context.
- Cursors from a different query context are rejected before Application
  dispatch.
- Pagination metadata now reports `nextCursor`, `previousCursor`, and `hasMore`
  from runtime page state instead of fixed placeholders.

## Traceability

| Item                | Trace                                                               |
| ------------------- | ------------------------------------------------------------------- |
| Production backlog  | `P1-02` in `PRODUCTION_EXECUTION_PLAN.md`                           |
| API contract        | `docs/api/PAGINATION_MODEL.md`, `docs/api/FILTERING_AND_SORTING.md` |
| Runtime adapter     | `apps/api/src/http-server.ts`                                       |
| Tests               | `apps/api/src/http-server.spec.ts`                                  |
| Architecture policy | ADR-0002 REST API, ADR-0004 Query Model, ADR-0007 Public Contract   |

## Runtime Rules

Collection processing order:

1. Map Application result items to public resource DTOs.
2. Apply whitelisted filters against public DTO fields.
3. Apply search across public string fields only.
4. Apply whitelisted sort with stable tie ordering.
5. Apply cursor offset and server-side limit.
6. Emit pagination metadata from the resulting page.

The runtime deliberately filters and sorts after DTO mapping so raw provider
payloads, phone numbers, raw JIDs, session material, and internal Application
fields cannot become queryable public data.

## Cursor Contract

Cursor tokens are opaque to clients. The current runtime format is an internal
implementation detail and must not be parsed by clients.

Cursor constraints:

- Cursor context includes query name, effective limit, filters, sort, and
  search.
- Cursor context mismatch returns a validation error.
- Cursor tokens do not contain database IDs, provider IDs, raw JIDs, phone
  numbers, or message bodies.

## Compatibility

No public route, operation ID, auth model, error envelope, or response envelope
was changed.

Clients should treat cursor tokens as opaque and resend them only with the same
collection query controls that produced them.

## Verification

Targeted checks:

```text
pnpm exec vitest run apps/api/src/http-server.spec.ts
```

Full gate:

```text
pnpm check
```
