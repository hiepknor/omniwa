# Platform Gap Report

## Assessment Method

This report compares the current source tree and design docs against the requested target:

```text
OmniWA Platform
├── REST API
├── OpenAPI
├── Official SDK
├── OmniWA TUI
├── Web Dashboard
├── CLI
├── Automation
├── MCP Server
└── Third-party Integrations
```

Status definitions:

- READY: Source exists and can be built/tested as an implementation unit.
- PARTIAL: Design or internal contracts exist, but platform-facing implementation is incomplete.
- MISSING: No source implementation exists.

## Platform Capability Matrix

| Capability       | Status        | Current Evidence                                                                        | Gap                                                                  |
| ---------------- | ------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| REST API         | PARTIAL       | `apps/api/src/http-server.ts` exposes resource routes through `@omniwa/interface-api`   | Need production dispatcher/runtime composition                       |
| OpenAPI          | PARTIAL       | `docs/api/openapi/omniwa-v1.openapi.json` and `pnpm openapi:check` exist                | Need typed response schemas and API Explorer integration             |
| Official SDK     | PARTIAL       | Rust SDK foundation, generated operations, resource wrappers, and client profiles exist | Need typed models and real HTTP transport implementation             |
| Groups           | PARTIAL       | Group domain, commands/queries, repositories, projections, REST, OpenAPI, SDK           | Need provider runtime implementation                                 |
| Chats            | PARTIAL       | Chat domain, repositories, projections, REST, OpenAPI, SDK                              | Need search/filter DTOs and realtime updates                         |
| Contacts         | PARTIAL       | Contact privacy model, repositories, projections, REST, OpenAPI, SDK                    | Need write APIs and richer privacy policy                            |
| Realtime         | PARTIAL       | Event stream route, SSE encoder, event source abstraction, SDK parser                   | Need event persistence and runtime integration                       |
| Persistence      | PARTIAL       | Repository ports, in-memory and durable JSON repositories, read projection store        | Need physical schema/migrations for production database              |
| Query Layer      | PARTIAL       | Application query catalog, `ReadModelPort`, platform projections                        | Need typed read DTOs and runtime projection builder                  |
| Projection       | PARTIAL       | Concrete projection catalog and in-memory/durable projection stores                     | Projection builder app is still a runtime shell                      |
| Authentication   | PARTIAL       | API key header auth, credential kinds, scopes, and adapter checks                       | Need key storage, rotation, and management surface                   |
| Authorization    | PARTIAL       | Scope checks and instance boundary checks in adapter; access decision domain exists     | Need resource-level REST policy and API key resource management      |
| Settings         | PARTIAL       | Configuration domain and commands/queries exist                                         | Need admin REST resources and persistence backing                    |
| Audit            | PARTIAL       | Audit aggregate/repository/query command concepts exist                                 | Need audit read API, audit event production across public operations |
| Metrics          | PARTIAL       | Observability metrics contracts, metrics routes, and projections exist                  | Need metrics runtime app wiring                                      |
| Health           | PARTIAL       | Health contracts, domain, and health/readiness REST routes exist                        | Need runtime liveness/readiness wiring                               |
| Provider Runtime | PARTIAL       | Baileys adapter exists; `apps/provider-runtime` is empty                                | Need runtime process composition and lifecycle wiring                |
| Worker           | PARTIAL       | Queue provider and WorkerJob domain exist; `apps/worker` is empty                       | Need worker process, job handlers, command dispatch                  |
| Webhook          | PARTIAL/READY | Webhook domain, transport, dispatcher helper exist; app shell empty                     | Need runtime app wiring and REST resources for subscription/delivery |
| Logs             | MISSING       | Logger contracts/redaction exist; no log store/query API                                | Need operational log read model and safe log streaming/query         |
| API Explorer     | PARTIAL       | OpenAPI exists                                                                          | Need API Explorer UI or integration                                  |
| MCP Server       | PARTIAL       | SDK-only MCP client profile exists                                                      | Need real MCP protocol runtime                                       |

## Architecture Readiness

| Area                         | Current State                                       | Platform Fitness                                        |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Clean Architecture           | Package dependencies follow expected direction      | Good foundation                                         |
| DDD                          | Core aggregates and policies exist for MVP domains  | Good foundation but incomplete platform domain coverage |
| CQRS                         | Command/query catalogs exist; query side is thin    | Needs read projections for TUI/Web/CLI                  |
| Hexagonal / Ports & Adapters | Application ports and infrastructure adapters exist | Good foundation                                         |
| Public contract boundary     | REST + OpenAPI route surface exists                 | Needs typed DTO maturity                                |
| Client abstraction boundary  | Rust SDK foundation and client profiles exist       | Good direction, needs real transport and typed models   |

## Key Platform Blockers

1. Production dispatcher/runtime composition is not complete.
2. SDK still lacks typed request/response models and real HTTP transport.
3. Public API still returns generic Application outcome envelopes instead of stable resource DTOs.
4. Provider runtime does not yet execute group/chat/contact-related operations.
5. Logs remain missing as a safe query/stream resource.
6. App runtime shells are still incomplete.
7. Production database schema and migrations are not implemented.
8. Event persistence and runtime realtime integration are not complete.
9. API key/auth resource lifecycle is not implemented.
10. Projection builder app is empty even though query screens need projections.

## Current Strengths To Preserve

- `shared -> domain -> application -> interface/infrastructure` dependency direction is clean.
- Baileys is isolated to `@omniwa/infrastructure-provider-baileys`.
- Infrastructure does not import interface packages.
- `@omniwa/interface-api` does not import domain or infrastructure directly.
- Domain model uses product-safe statuses instead of provider-native statuses.
- Current checks catch forbidden imports and release evidence regressions.
- Guardrail posture explicitly blocks broadcast/campaign behavior.

## Current Weaknesses To Challenge

| Weakness                         | Why It Matters For Platform                                             |
| -------------------------------- | ----------------------------------------------------------------------- |
| Runtime apps are shells          | Platform cannot run end-to-end yet                                      |
| Generic API data envelope        | Clients need stable typed resource DTOs, not Application outcome shapes |
| SDK transport is fixture-only    | TUI/CLI/Web need a real HTTP transport boundary                         |
| Query side is not fully UI-grade | TUI screens need typed list/search/filter/sort/projection contracts     |
| No production durable schema     | State cannot survive real operation outside JSON adapters               |
| Logs are still missing           | Operators need safe debugging and audit-adjacent visibility             |

## Compatibility With OmniWA TUI

| TUI Screen   | Status  | Current Code/Module Evidence                                 | Missing                                      |
| ------------ | ------- | ------------------------------------------------------------ | -------------------------------------------- |
| Dashboard    | PARTIAL | Dashboard/metrics projections, REST routes, SSE foundation   | Typed DTOs, production runtime data          |
| Instances    | PARTIAL | Instance domain, commands, REST routes, durable adapters     | Typed DTOs, provider runtime                 |
| Sessions     | PARTIAL | Session domain/repository, instance-scoped list route        | Session detail resource                      |
| Chats        | PARTIAL | Chat domain, repository/projection, REST, SDK wrapper        | Search/filter DTOs, realtime updates         |
| Contacts     | PARTIAL | Contact domain/privacy/read model, REST, SDK wrapper         | Write APIs, richer privacy policy            |
| Groups       | PARTIAL | Group domain, members/actions, REST/API/query, SDK wrapper   | Provider runtime support                     |
| Members      | PARTIAL | Group member model/actions under Group aggregate             | Provider runtime support                     |
| Messages     | PARTIAL | Message domain, commands, queries, REST routes, projections  | Typed DTOs, provider runtime                 |
| Queue        | PARTIAL | Queue provider, WorkerJob, queue metrics route               | Queue control APIs, production queue adapter |
| Jobs         | PARTIAL | WorkerJob domain/query and list/detail routes                | Retry/cancel public job controls             |
| Webhooks     | PARTIAL | Webhook domain, transport, dispatcher helper, REST routes    | Production delivery runtime                  |
| Events       | PARTIAL | Domain event contracts, event log projection, SSE foundation | Event persistence integration                |
| Logs         | MISSING | Logger contracts only                                        | Log storage/query/stream                     |
| API Explorer | PARTIAL | OpenAPI contract                                             | Explorer UI/client integration               |
| Settings     | PARTIAL | Configuration domain/commands/query and admin REST routes    | Typed settings DTOs                          |
