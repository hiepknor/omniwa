# Phase J - Platform Clients

## Status

Implemented as client foundation.

## Goal

Build platform clients on top of the official SDK boundary only. Clients must not import backend packages, Application commands/queries, Domain concepts, Infrastructure adapters, or Provider code.

## Scope

- OmniWA TUI client surface.
- CLI client surface.
- Web Dashboard client surface.
- MCP Server client surface.
- SDK fixture-backed tests proving client surfaces use generated SDK operation IDs.

## Implemented Surface

| Area          | Implemented                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| SDK           | `platform_clients` module with profiles for TUI, CLI, Web Dashboard, and MCP Server                                  |
| TUI           | Screen profile for dashboard, instances, chats/contacts/labels, groups, messages, queue/jobs, webhooks, and settings |
| CLI           | Command group profile for status, instances, messages, and operations                                                |
| Web Dashboard | Panel profile for overview, instance browser, and operations                                                         |
| MCP Server    | Tool group profile for discovery, actions, and event tools                                                           |
| Tests         | SDK fixture tests validate profiles and run representative TUI screen calls through SDK resources                    |
| Docs          | README and platform status updated to reflect client foundation                                                      |

## Post-Phase J SDK Hardening

After Phase J, the SDK foundation was hardened for real client consumption:

| Area       | Implemented                                                                |
| ---------- | -------------------------------------------------------------------------- |
| Transport  | Blocking HTTP transport for real REST calls behind the `Transport` trait   |
| Envelopes  | Typed success, collection, and error envelopes for public API responses    |
| Error Map  | Standard OmniWA error envelopes map into `SdkError::Api`                   |
| Dependency | Root Cargo workspace enables Git dependency consumption during pre-release |
| Tests      | Local HTTP fixture tests cover real HTTP success and API error handling    |

## Guardrails

- Client profiles reference public OpenAPI operation IDs only.
- Client profiles must not expose Application command/query names.
- Client tests use SDK fixtures, not backend internals.
- Clients do not contain business logic.
- Clients do not call REST directly outside the SDK boundary.
- No UI framework, terminal framework, web framework, or MCP runtime dependency is introduced in this phase.

## Deferred

- Real OmniWA TUI runtime.
- Real CLI command parser/runtime.
- Real Web Dashboard application.
- Real MCP server protocol runtime.
- Resource-specific generated SDK DTOs.
- Async SDK transport.
- Client packaging and release workflows.

## Verification Targets

- `cargo test` validates SDK fixtures and platform client profiles.
- `pnpm sdk:check` validates SDK files and generated operations.
- `pnpm check` validates TypeScript, architecture, OpenAPI, SDK, and release gates.

## Phase J Exit Criteria

| Criteria                                                 | Status |
| -------------------------------------------------------- | ------ |
| TUI client surface defined through SDK profile           | PASS   |
| CLI client surface defined through SDK profile           | PASS   |
| Web Dashboard client surface defined through SDK profile | PASS   |
| MCP Server client surface defined through SDK profile    | PASS   |
| Client profiles reference generated SDK operations       | PASS   |
| Client tests use SDK fixtures                            | PASS   |
| No backend package dependency introduced in clients      | PASS   |
| No business logic introduced in clients                  | PASS   |

**Phase J client foundation is ready for review.**
