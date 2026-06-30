# Phase C - OpenAPI Contract

## Purpose

Phase C turns the implemented Phase B REST resource surface into a validated
OpenAPI contract that future SDK, API Explorer, TUI, CLI, MCP, and third-party
integrations can consume.

This phase does not change runtime behavior, Application contracts, Domain
model, persistence, provider integration, or route implementation.

## Required Context

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/PUBLIC_API_REVIEW.md`
- `docs/platform-evolution/MIGRATION_ROADMAP.md`
- `docs/platform-evolution/PHASE_B_REST_RESOURCES.md`
- `docs/adr/ADR-0001-platform-boundary.md`
- `docs/adr/ADR-0002-rest-api.md`
- `docs/adr/ADR-0007-public-contract.md`
- `docs/api/REST_API_PHASE_B.md`

## Deliverables

| Deliverable                | Status   | Notes                                        |
| -------------------------- | -------- | -------------------------------------------- |
| OpenAPI contract           | Complete | `docs/api/openapi/omniwa-v1.openapi.json`    |
| Contract documentation     | Complete | `docs/api/OPENAPI_CONTRACT.md`               |
| Contract validation script | Complete | `tooling/api/check-openapi.mjs`              |
| Root check integration     | Complete | `pnpm check` now runs `pnpm openapi:check`   |
| Safe examples              | Complete | Examples use synthetic placeholder data only |

## Contract Coverage

The OpenAPI file covers every route documented in Phase B:

- Health and action-required resources.
- Metrics and queue snapshots.
- Instance lifecycle resources.
- Message submission and status resources.
- Media registration and status resources.
- Job visibility resources.
- Webhook subscription and delivery resources.
- Provider capability view resources.
- Settings resources.
- Audit record query resources.

## Reserved Partial Resources

The contract includes partial routes as explicit `501` responses rather than
omitting them. This makes current platform gaps visible to SDK/API Explorer
consumers without pretending the missing read models exist.

| Resource                    | Current Status                                      |
| --------------------------- | --------------------------------------------------- |
| Job list                    | Reserved until a job list projection exists         |
| Webhook list                | Reserved until a webhook list projection exists     |
| Webhook delivery list       | Reserved until a delivery projection exists         |
| Instance message timeline   | Reserved until a message timeline projection exists |
| Instance session list       | Reserved until a session list read model exists     |
| Reconnect request           | Reserved because reconnect remains scheduler-owned  |
| Provider capability refresh | Reserved because refresh remains scheduler-owned    |

## Contract Validation

Run:

```text
pnpm openapi:check
```

The gate validates:

- OpenAPI 3.x document shape.
- Required `x-api-key` security scheme.
- Required success, collection, error, response meta, and pagination schemas.
- Route coverage for Phase B.
- Unique operation ids.
- Operation ids do not directly expose internal Application command/query names.
- Every operation documents an auth error response.
- Every operation documents either a successful response or a reserved `501`
  response.

## Boundary Confirmation

Phase C only adds contract artifacts and validation tooling.

- No REST route implementation was changed.
- No Application command/query was changed.
- No Domain model was changed.
- No persistence, provider, queue, or webhook implementation was changed.
- No SDK code was generated.

## Risks

| Risk                                         | Mitigation                                            |
| -------------------------------------------- | ----------------------------------------------------- |
| OpenAPI drifts from runtime routes           | `pnpm openapi:check` validates Phase B route coverage |
| Operation ids leak internal names            | Checker rejects direct internal command/query names   |
| SDK generated from incomplete partial routes | Partial resources are marked with `501` responses     |
| Examples leak sensitive data                 | Examples use synthetic refs and `example.invalid` URL |

## Exit Criteria

| Criteria                                    | Status |
| ------------------------------------------- | ------ |
| OpenAPI created for Phase B resources       | PASS   |
| Contract validation added to project checks | PASS   |
| Error envelope documented                   | PASS   |
| Pagination contract documented              | PASS   |
| Partial routes documented as unavailable    | PASS   |
| Runtime behavior unchanged                  | PASS   |

**Phase C is complete.**

Recommended next phase: Phase D - Official Rust SDK Foundation.
