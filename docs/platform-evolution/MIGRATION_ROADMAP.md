# Migration Roadmap

## Current

```text
Source packages are modular.
Application command/query catalogs exist.
Internal API adapter exists.
Most runtime apps are shells.
No REST API, OpenAPI, SDK, durable persistence, or realtime stream exists.
```

## Roadmap

```text
Current
  ↓
Phase A - HTTP Transport Shell
  ↓
Phase B - REST Resources For Current Domains
  ↓
Phase C - OpenAPI Contract
  ↓
Phase D - Official Rust SDK
  ↓
Phase E - Query Projections
  ↓
Phase F - Realtime SSE
  ↓
Phase G - Durable Persistence Adapter
  ↓
Phase H - Groups Domain Addendum
  ↓
Phase I - Chats / Contacts / Labels
  ↓
Phase J - Platform Clients
  ↓
Platform Ready
```

## Backward Compatibility Rules

- Existing package names remain stable.
- Existing Domain/Application command/query names remain internal and can evolve with tests.
- Public REST paths must not expose internal command/query names.
- OpenAPI is the public compatibility source after Phase C.
- SDK version follows OpenAPI compatibility.
- Additive resource groups are preferred.
- Removing or renaming public fields requires explicit API version policy.

## Phase Exit Criteria

| Phase | Exit Criteria                                                                             |
| ----- | ----------------------------------------------------------------------------------------- |
| A     | API app can accept HTTP, authenticate, return safe errors, and call `ApiInterfaceAdapter` |
| B     | Current domains have REST route coverage and tests                                        |
| C     | OpenAPI validates against route coverage and error/pagination contracts                   |
| D     | Rust SDK can call Phase B/C API fixtures                                                  |
| E     | TUI-critical projections exist for existing domains                                       |
| F     | SSE stream emits safe event envelopes with cursor/reconnect                               |
| G     | Durable repository adapter passes repository contract tests                               |
| H     | Groups domain approved and implemented behind provider capability checks                  |
| I     | Chat/contact/label read models are available with privacy rules                           |
| J     | TUI/CLI/Web/MCP use SDK only                                                              |

## Rollback Model

| Change Type         | Rollback                                             |
| ------------------- | ---------------------------------------------------- |
| HTTP transport      | Disable app or route group                           |
| REST resource       | Disable route group; Application remains unchanged   |
| OpenAPI             | Revert spec/generation artifacts                     |
| SDK                 | Revert SDK package version                           |
| Projection          | Rebuild/drop projection; source aggregates unchanged |
| SSE                 | Disable stream; clients use polling                  |
| Persistence adapter | Adapter rollback plus migration review               |
| Groups domain       | Capability flag/resource disable if additive         |
