# Phase H - Groups Domain Addendum

## Status

Implemented.

## Goal

Add Groups as a first-class platform domain without merging group administration into Messaging or leaking group rules into provider adapters.

## Decisions

- `Group` is the aggregate root.
- `GroupMember`, `GroupAction`, and `GroupInviteLink` are owned concepts inside `Group`.
- `GroupAction` carries an `auditRequired` marker for admin-sensitive operations.
- Provider group support is represented with product vocabulary capabilities, not provider-native method names.
- Public REST routes use resource names such as `/v1/groups/{groupId}/members`; they do not expose Application command/query names.
- TUI and SDK consume read projections for list/detail/member views.

## Implemented Surface

| Area                | Implemented                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Domain              | Group aggregate, member role, invite link, group action, lifecycle status, domain events                           |
| Provider capability | Group provider capability vocabulary and policy/specification checks                                               |
| Application         | Group command/query catalog, service ownership, workflow ownership                                                 |
| Persistence         | Group repository port, in-memory adapter, durable JSON adapter, adapter plan                                       |
| Projections         | Group list, group status, group member list projections                                                            |
| REST                | Instance group list/refresh, group detail, metadata, local state, members, group text message, invite link refresh |
| OpenAPI             | Phase H routes and request bodies in `docs/api/openapi/omniwa-v1.openapi.json`                                     |
| SDK                 | Rust `groups()` resource wrapper                                                                                   |

## Guardrails

- Provider adapters must not contain group business rules.
- Unsupported group capabilities must map to safe `unsupported_capability` domain errors.
- Messaging remains responsible for approved message lifecycle; Group owns group metadata and administration concepts.
- Group routes still dispatch through the API adapter and Application catalog.
- Group operations are additive and can be disabled by capability/config without changing existing message routes.

## Deferred

- Provider runtime implementation for concrete group operations.
- Group event integration delivery beyond approved internal domain contracts.
- Advanced membership consistency split into separate aggregate if scale or concurrency requires it.
- TUI screens and SDK typed response models.

## Verification Targets

- Domain group invariant tests.
- Provider unsupported group capability maps to safe domain error.
- API group route mapping and scope checks.
- OpenAPI operation coverage.
- SDK generated operation coverage.

## Phase H Exit Criteria

| Criteria                                     | Status |
| -------------------------------------------- | ------ |
| Groups domain model added                    | PASS   |
| Provider capability mapping added            | PASS   |
| Application commands/queries/workflows added | PASS   |
| REST resources added without command URLs    | PASS   |
| Projections added                            | PASS   |
| Persistence adapters added                   | PASS   |
| SDK wrapper added                            | PASS   |
| Provider adapter business logic avoided      | PASS   |

**Phase H is ready for review.**
