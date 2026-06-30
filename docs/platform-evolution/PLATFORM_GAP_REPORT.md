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

| Capability       | Status        | Current Evidence                                                                    | Gap                                                                        |
| ---------------- | ------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| REST API         | MISSING       | `apps/api/src/index.ts` is empty; no HTTP framework dependency; no route source     | Need HTTP transport and resource routing over `@omniwa/interface-api`      |
| OpenAPI          | MISSING       | Docs mention deferred OpenAPI; no spec/generator/source                             | Need OpenAPI contract and validation/generation workflow                   |
| Official SDK     | MISSING       | No SDK package or generated client                                                  | Need SDK architecture and Rust SDK package after OpenAPI                   |
| Groups           | MISSING       | Docs explicitly defer; no source module/commands/queries/repositories               | Need product addendum, domain model, provider capability, REST/read models |
| Chats            | MISSING       | Docs defer; no source module/queries/repositories                                   | Need chat projection/read model at minimum                                 |
| Contacts         | MISSING       | Docs defer; no source module/queries/repositories                                   | Need contact privacy model and read model                                  |
| Realtime         | MISSING       | Event contracts exist; no SSE/WebSocket transport or event stream app               | Need event log/projection and streaming API                                |
| Persistence      | PARTIAL       | Repository ports, in-memory repositories, read projection store, adapter plan       | Need physical schema review and durable adapter; no migrations yet         |
| Query Layer      | PARTIAL       | Application query catalog and `ReadModelPort` exist                                 | Need TUI-oriented projections and REST query contracts                     |
| Projection       | PARTIAL       | `read-projection-store.ts` exists; projection builder app is empty                  | Need projection builder runtime and concrete projection catalog            |
| Authentication   | PARTIAL       | `ApiCredential`, credential kinds, scopes in `ApiInterfaceAdapter`                  | Need HTTP header/API key extraction, key storage, rotation surface         |
| Authorization    | PARTIAL       | Scope checks and instance boundary checks in adapter; access decision domain exists | Need resource-level REST policy and API key resource management            |
| Settings         | PARTIAL       | Configuration domain and commands/queries exist                                     | Need admin REST resources and persistence backing                          |
| Audit            | PARTIAL       | Audit aggregate/repository/query command concepts exist                             | Need audit read API, audit event production across public operations       |
| Metrics          | PARTIAL       | Observability metrics contracts and in-memory runtime exist                         | Need metrics runtime app/API endpoint/projections                          |
| Health           | PARTIAL       | Health contracts and domain exist; health app empty                                 | Need liveness/readiness HTTP endpoints and app wiring                      |
| Provider Runtime | PARTIAL       | Baileys adapter exists; `apps/provider-runtime` is empty                            | Need runtime process composition and lifecycle wiring                      |
| Worker           | PARTIAL       | Queue provider and WorkerJob domain exist; `apps/worker` is empty                   | Need worker process, job handlers, command dispatch                        |
| Webhook          | PARTIAL/READY | Webhook domain, transport, dispatcher helper exist; app shell empty                 | Need runtime app wiring and REST resources for subscription/delivery       |
| Logs             | MISSING       | Logger contracts/redaction exist; no log store/query API                            | Need operational log read model and safe log streaming/query               |
| API Explorer     | MISSING       | No OpenAPI                                                                          | Depends on OpenAPI                                                         |
| MCP Server       | MISSING       | No source                                                                           | Should consume SDK/API, not backend internals                              |

## Architecture Readiness

| Area                         | Current State                                       | Platform Fitness                                        |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Clean Architecture           | Package dependencies follow expected direction      | Good foundation                                         |
| DDD                          | Core aggregates and policies exist for MVP domains  | Good foundation but incomplete platform domain coverage |
| CQRS                         | Command/query catalogs exist; query side is thin    | Needs read projections for TUI/Web/CLI                  |
| Hexagonal / Ports & Adapters | Application ports and infrastructure adapters exist | Good foundation                                         |
| Public contract boundary     | Internal `ApiInterfaceAdapter` exists               | Not enough for platform                                 |
| Client abstraction boundary  | No SDK                                              | Not platform ready                                      |

## Key Platform Blockers

1. There is no REST transport implementation.
2. There is no OpenAPI contract.
3. There is no SDK.
4. `ApiInterfaceAdapter` uses command/query names internally; those names must not become the public REST API.
5. TUI-critical read domains are missing: Chat, Contact, Group, Members, Logs, EventLog.
6. App runtime shells are mostly empty.
7. Durable persistence is not implemented.
8. Realtime transport is not implemented.
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

| Weakness                            | Why It Matters For Platform                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| API package is not a REST transport | TUI, SDK, CLI, Web, MCP need one stable network contract               |
| Concrete API details are deferred   | SDK and API Explorer cannot exist without them                         |
| Groups/Chats/Contacts are deferred  | Platform clients need browsing and operations, not only send/status    |
| Query side is not UI-grade          | TUI screens are read-heavy and need list/search/filter/sort/projection |
| Runtime apps are shells             | Platform cannot run end-to-end yet                                     |
| No durable schema                   | State cannot survive real operation                                    |
| No SDK                              | Each client would reimplement protocol concerns                        |

## Compatibility With OmniWA TUI

| TUI Screen   | Status  | Current Code/Module Evidence                                    | Missing                                              |
| ------------ | ------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Dashboard    | PARTIAL | Health/metrics query catalog, observability package             | Summary projection, REST endpoint, realtime          |
| Instances    | PARTIAL | Instance domain, commands, `ListInstances`, `GetInstanceStatus` | REST routes, durable persistence, TUI projection     |
| Sessions     | PARTIAL | Session domain/repository, instance status                      | Session list/detail read model and REST routes       |
| Chats        | MISSING | No source module                                                | Chat read projection/domain decision                 |
| Contacts     | MISSING | No source module                                                | Contact domain/privacy/read model                    |
| Groups       | MISSING | No source module                                                | Group domain, provider support, REST/API/query       |
| Members      | MISSING | No source module                                                | Group member model/actions                           |
| Messages     | PARTIAL | Message domain, commands, queries                               | Message timeline/list query, REST routes, pagination |
| Queue        | PARTIAL | Queue provider, WorkerJob                                       | Queue overview/list endpoints/projections            |
| Jobs         | PARTIAL | WorkerJob domain/query                                          | Job list/detail/retry APIs                           |
| Webhooks     | PARTIAL | Webhook domain, transport, dispatcher helper                    | REST routes and app wiring                           |
| Events       | PARTIAL | Domain event contracts                                          | Event log/read model/stream                          |
| Logs         | MISSING | Logger contracts only                                           | Log storage/query/stream                             |
| API Explorer | MISSING | No OpenAPI                                                      | OpenAPI spec and explorer integration                |
| Settings     | PARTIAL | Configuration domain/commands/query                             | Admin REST resources and persistence                 |
