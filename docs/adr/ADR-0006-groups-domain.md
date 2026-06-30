# ADR-0006 Groups Domain

## Status

Proposed.

## Context

Current docs defer group product capabilities and current source has no Group module, aggregate, repository port, command, query, route, or provider capability surface.

The target platform includes TUI/Web/CLI screens that require Groups and Members. Keeping Groups deferred blocks platform completeness.

## Decision

Add Groups as a first-class domain after REST/OpenAPI/SDK foundations are established.

Initial model:

- `Group` aggregate root.
- `GroupMember` entity inside Group.
- `GroupAction` aggregate for async/audit-sensitive admin operations.
- `GroupMetadata` value object.
- `InviteLink` entity if history/revoke is required; otherwise value object.

Group business rules remain in Domain/Application, not provider adapter or TUI.

## Alternatives

| Alternative                                | Reason Rejected                                                |
| ------------------------------------------ | -------------------------------------------------------------- |
| Keep Groups deferred                       | Blocks platform client requirements                            |
| Put Groups inside Messaging                | Mixes conversation/admin lifecycle with message lifecycle      |
| Implement Groups only in provider adapter  | Leaks business rules into Infrastructure                       |
| Treat GroupMember as aggregate immediately | Premature unless large-scale membership consistency demands it |

## Consequences

- Product scope and guardrails must be updated.
- Provider capability checks are mandatory.
- Group operations require audit.
- Broadcast/campaign remains out of scope unless separately approved.

## Migration Plan

1. Approve product scope addendum for Groups.
2. Add domain model and repository ports.
3. Add Application commands/queries/workflows.
4. Add provider port methods/capability mapping.
5. Add projections and REST resources.
6. Add SDK modules.
7. Add TUI screens.
