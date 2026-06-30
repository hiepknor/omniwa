# Platform Evolution Recommendation

## Recommendation

Proceed with platform evolution, but do not start OmniWA TUI implementation until three platform contracts are created:

1. REST API transport and resource routes for current domains.
2. OpenAPI contract.
3. Official Rust SDK foundation.

The current codebase is a good backend core foundation, but it is not yet a platform boundary.

## Score

| Area                       | Score | Reason                                                          |
| -------------------------- | ----: | --------------------------------------------------------------- |
| Layering                   |  9/10 | Package dependencies are clean and checked                      |
| Domain foundation          |  7/10 | Current MVP domains are solid, but platform domains are missing |
| Application contracts      |  8/10 | Commands/queries/workflows exist and are coherent               |
| Public API                 |  3/10 | Internal adapter only; no REST/OpenAPI                          |
| Client readiness           |  2/10 | No SDK, no public contract                                      |
| Query/read model           |  5/10 | Query catalog exists, TUI projections missing                   |
| Runtime readiness          |  4/10 | Many app shells are empty                                       |
| Persistence readiness      |  4/10 | In-memory plus plans, no durable adapter/schema                 |
| Realtime readiness         |  2/10 | Event contracts only                                            |
| Platform readiness overall |  5/10 | Strong core, missing platform surface                           |

Overall platform readiness: 49/100.

## Top 10 Immediate Actions

1. Approve ADR-0001 Platform Boundary.
2. Implement HTTP transport shell in `apps/api`.
3. Add REST resource mapping for existing commands/queries.
4. Approve and create OpenAPI contract.
5. Create Rust SDK foundation from OpenAPI.
6. Add TUI-grade projections for current domains.
7. Add SSE event stream and EventLog projection.
8. Review durable persistence model before any migration.
9. Approve Groups domain addendum before implementing Groups.
10. Keep Broadcast/Campaign out until a separate product/security decision.

## What To Keep

- Current package boundaries.
- Current Domain/Application separation.
- Current provider abstraction.
- Current guardrail posture.
- Current architecture boundary check.
- Current release readiness check.

## What To Refactor Incrementally

- Convert `apps/api` from shell to HTTP runtime.
- Convert `@omniwa/interface-api` from internal command/query adapter into a component behind REST route handlers.
- Add projection/read model modules without changing aggregate write model.
- Add missing platform domains as additive source modules after ADR approval.

## What Not To Do

- Do not expose `/commands/{CommandName}`.
- Do not let TUI use `reqwest` directly.
- Do not put business rules in REST handlers, SDK, TUI, provider adapter, or projection builder.
- Do not implement Groups inside Messaging.
- Do not create database migrations before persistence review.
- Do not add Broadcast under a group/messaging shortcut.
