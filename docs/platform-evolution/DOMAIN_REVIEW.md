# Domain Model Review

## Review Basis

This review uses current source modules in `packages/domain`, repository ports, Application command/query catalogs, and current docs that explicitly defer some platform domains.

## Domain Decisions

| Domain                       | Decision                                             | Reason                                                                                                        |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Identity                     | KEEP                                                 | Aggregate IDs and opaque identity are already centralized and safe.                                           |
| Instance                     | KEEP                                                 | Core platform concept and current source aggregate exists.                                                    |
| Session                      | KEEP                                                 | Core lifecycle and recovery concept exists; keep separate from Instance because sensitivity differs.          |
| Message                      | KEEP                                                 | Core platform capability exists; current model protects message lifecycle and unsupported types.              |
| Media                        | KEEP                                                 | Supporting/core for message workflows; keep separate from Message due artifact lifecycle.                     |
| Webhook                      | KEEP                                                 | Platform integration capability; current subscription/delivery split is appropriate.                          |
| Queue / WorkerJob            | KEEP, but keep as Operations                         | WorkerJob should not be merged with Messaging; it is operational lifecycle.                                   |
| Provider                     | KEEP                                                 | Provider abstraction is necessary for Baileys and future providers.                                           |
| Audit                        | KEEP                                                 | Platform operations need audit; current model is safe but needs more production wiring.                       |
| Metrics / Health / Telemetry | KEEP as Observability/Operations, not core business  | Needed for platform; should not own product behavior.                                                         |
| Configuration / Settings     | KEEP                                                 | Platform needs admin settings; current domain exists.                                                         |
| Guardrails                   | KEEP                                                 | Current anti-spam/broadcast/rate-limit posture is important.                                                  |
| Chat                         | ADD                                                  | Required by platform clients for navigation/read model; absent in source.                                     |
| Contact                      | ADD                                                  | Required by platform clients and integrations; absent in source.                                              |
| Group                        | ADD                                                  | Required for platform completeness; absent and currently deferred.                                            |
| GroupMember                  | ADD as Group entity first                            | Membership consistency belongs in Group aggregate initially.                                                  |
| GroupAction                  | ADD as audit-sensitive aggregate                     | Admin mutations need lifecycle, idempotency, provider outcome, and audit.                                     |
| InviteLink                   | ADD as entity or value object based on history needs | Current source has no equivalent.                                                                             |
| Label                        | ADD later                                            | Useful for clients but not required before Chat/Contact/Group base.                                           |
| Broadcast                    | DO NOT ADD YET                                       | Current guardrail posture intentionally blocks broadcast/campaign; adding it needs product/security decision. |
| EventLog                     | ADD as read/operations model                         | Domain event contracts exist but no queryable event log.                                                      |
| LogEntry                     | ADD as operations read model                         | Logger exists but no query surface.                                                                           |
| API Client/API Key           | ADD as administration/security domain                | `ApiCredential` is only adapter input today; platform needs lifecycle/rotation.                               |

## Groups Domain Recommendation

Groups should become a first-class platform domain if OmniWA targets TUI/Web/CLI/MCP and third-party integrations.

### Proposed Core Concepts

| Concept           | Type                                                       | Reason                                                                                              |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Group`           | Aggregate root                                             | Owns group identity, metadata snapshot, settings, membership version, lifecycle.                    |
| `GroupMember`     | Entity inside Group initially                              | Membership role/state changes usually need consistency with one Group.                              |
| `GroupAction`     | Separate aggregate                                         | Add/remove/promote/demote/rename/invite operations are async, audit-sensitive, provider-dependent.  |
| `GroupMetadata`   | Value Object                                               | Name, description, picture reference, announcement/restriction flags should be immutable snapshots. |
| `InviteLink`      | Entity if history/revoke is needed; otherwise Value Object | Link rotation/revoke likely needs lifecycle and audit.                                              |
| `GroupRole`       | Value Object / enum                                        | member/admin/super_admin if provider supports it.                                                   |
| `GroupCapability` | Value Object                                               | Provider capability mapping for actions not always available.                                       |

### Group Aggregate Boundary

Group owns:

- Product group identity.
- Instance ownership.
- Safe provider group reference.
- Current metadata snapshot.
- Membership snapshot and version.
- Group visibility/status.
- Last sync status.

Group does not own:

- Message lifecycle.
- Provider transport execution.
- Webhook delivery.
- Audit record persistence.
- Queue mechanics.

### GroupAction Aggregate Boundary

GroupAction owns:

- Requested action type.
- Actor reference.
- Target group.
- Optional target member.
- Idempotency key.
- Request lifecycle: requested, queued, processing, applied, failed, cancelled.
- Safe provider outcome category.

GroupAction does not own:

- Group membership truth after provider confirms; Application coordinates update.
- Provider-native payloads.
- Audit storage implementation.

### Group Events

Initial event catalog should include:

- `GroupDiscovered`.
- `GroupMetadataUpdated`.
- `GroupMemberJoined`.
- `GroupMemberLeft`.
- `GroupMemberAdded`.
- `GroupMemberRemoved`.
- `GroupAdminPromoted`.
- `GroupAdminDemoted`.
- `GroupInviteLinkUpdated`.
- `GroupActionRequested`.
- `GroupActionApplied`.
- `GroupActionFailed`.

## Domains To Avoid Adding Prematurely

| Domain             | Reason                                                                             |
| ------------------ | ---------------------------------------------------------------------------------- |
| Broadcast/Campaign | Current product/security posture blocks it; high abuse risk.                       |
| Analytics          | Current metrics are operational; analytics can accidentally become campaign scope. |
| Multi Tenant       | Current product decision is Single Tenant + Multi Instance.                        |
