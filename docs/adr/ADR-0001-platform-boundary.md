# ADR-0001 Platform Boundary

## Status

Proposed.

## Context

The current repository has a clean internal modular architecture and an internal `ApiInterfaceAdapter`, but no REST API, OpenAPI, or SDK. The target platform includes REST API, OpenAPI, SDK, TUI, Web Dashboard, CLI, MCP, and third-party integrations.

If clients call Application command/query names directly, internal Application contracts become public and hard to evolve.

## Decision

Define the public platform boundary as:

```text
Client -> Official SDK -> REST API -> Interface Adapter -> Application -> Domain
```

Application command/query names are internal and must not appear as public REST operations.

## Alternatives

| Alternative                          | Reason Rejected                                              |
| ------------------------------------ | ------------------------------------------------------------ |
| Expose Application commands directly | Leaks internals and couples clients to backend orchestration |
| Let each client use raw HTTP         | Duplicates auth, errors, pagination, retry, streaming        |
| Put business logic in SDK            | Violates backend-owned business rule requirement             |

## Consequences

- REST resources become the public contract.
- SDK is the supported client boundary.
- TUI, Web, CLI, MCP, and integrations use the SDK.
- Backend can refactor Application internals without breaking clients if REST/OpenAPI remains compatible.

## Migration Plan

1. Keep `ApiInterfaceAdapter` internal.
2. Add HTTP routes in `apps/api`.
3. Map routes to adapter requests.
4. Add OpenAPI.
5. Generate SDK.
6. Move clients to SDK-only access.
