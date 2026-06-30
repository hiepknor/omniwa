# Platform Evolution Plan

## Principles

- Do not rewrite the current modular monolith.
- Keep current package dependency direction.
- Do not expose internal command/query names as public REST API.
- Add platform capabilities as adapters, projections, and additive domains.
- Each phase must be independently testable and rollbackable.
- Existing Application command/query catalogs remain internal.
- Public clients use SDK over REST; TUI does not call Application or transport internals.

## Phase A - HTTP Transport Shell

Goal:

- Turn `apps/api` from empty shell into a transport host over `@omniwa/interface-api`.

Scope:

- Select HTTP framework through ADR before implementation.
- Add request id/correlation id extraction.
- Add API key extraction and mapping to current `ApiCredential`.
- Add health/liveness minimal endpoint.
- No new product behavior.

Rollback:

- Remove app wiring and keep existing packages unchanged.

Tests:

- Transport maps HTTP request to `ApiInterfaceAdapter`.
- No route imports Domain or Infrastructure directly.
- Missing/invalid credential returns safe API error.

## Phase B - REST Resource Mapping For Existing Domains

Goal:

- Expose current implemented Application commands/queries as REST resources without leaking command names.

Resource families:

- Instances.
- Messages.
- Media.
- Webhooks.
- Jobs.
- Health.
- Metrics.
- Configuration.
- Audit.

Scope:

- Add REST routing package or app modules.
- Map routes to `ApiInterfaceAdapter` command/query requests.
- Keep Application command/query names internal.

Rollback:

- Disable route group without changing Domain/Application.

Tests:

- Each route has traceability to one current command/query.
- Async command routes return accepted/queued status without claiming provider completion.
- Boundary check still passes.

## Phase C - OpenAPI Contract

Goal:

- Make REST contract consumable by SDK, API Explorer, third-party clients, and MCP.

Scope:

- Create OpenAPI for Phase B resources.
- Add contract validation in CI.
- Add examples with safe placeholder data only.

Rollback:

- Remove generated artifacts/spec validation without touching runtime behavior.

Tests:

- OpenAPI operation IDs map to REST resources, not Application command names.
- Error envelope and pagination are documented.

## Phase D - Official Rust SDK Foundation

Goal:

- Provide one official client abstraction for TUI, CLI, and external integrations.

Scope:

- Generate low-level client from OpenAPI.
- Add ergonomic Rust layer for auth, pagination, errors, and SSE later.
- TUI must depend on SDK, not raw HTTP.

Rollback:

- SDK package can be versioned independently and regenerated from prior OpenAPI.

Tests:

- SDK contract tests against API fixtures.
- Error mapping tests.

## Phase E - Query Projections For Platform Clients

Goal:

- Make TUI/Web/CLI read paths stable and efficient without changing write aggregates.

Scope:

- Build projection catalog around existing read needs:
  - Dashboard summary.
  - Instance list.
  - Session summary.
  - Message timeline/status.
  - Job list/status.
  - Webhook delivery history.
  - Audit records.
  - Metrics snapshots.
- Wire `apps/projection-builder`.

Rollback:

- Projections are derived; they can be rebuilt or disabled without mutating write model.

Tests:

- Projection does not mutate aggregates.
- Projection respects retention and redaction.

## Phase F - Realtime Event Stream

Goal:

- Provide read-only event stream for TUI, CLI watch mode, Dashboard, and integrations.

Scope:

- Add EventLog projection.
- Add SSE endpoint for current product events.
- Keep WebSocket deferred until bidirectional semantics are needed.

Rollback:

- Disable stream endpoint; clients fall back to polling.

Tests:

- SSE emits only safe event envelopes.
- Reconnect cursor/resume behavior does not expose expired data.

## Phase G - Durable Persistence Review And Adapter

Goal:

- Replace in-memory persistence for platform operation with a durable implementation.

Scope:

- Review physical data model before migrations.
- Implement repository adapters preserving current repository port semantics.
- Keep Redis ephemeral.
- Keep object storage artifact-only.

Rollback:

- Adapter-level rollback with migration review plan.

Tests:

- Repository contract tests.
- Projection rebuild tests.
- Backup/recovery validation remains green.

## Phase H - Groups Domain Addendum

Goal:

- Add Groups as a first-class platform domain without corrupting Messaging or Provider boundaries.

Scope:

- Product decision and ADR.
- Add Group, GroupMember, GroupAction, InviteLink concepts.
- Add provider capability mapping.
- Add commands/queries/projections/routes only after domain approval.

Rollback:

- Additive resource group; can be disabled by capability/config without impacting existing messaging.

Tests:

- Group operations audit.
- Provider unsupported capability maps to safe errors.
- No group admin logic in provider adapter.

## Phase I - Chats, Contacts, Labels

Goal:

- Add platform browsing/navigation domains required by UI clients.

Scope:

- Chat projection.
- Contact privacy model.
- Label domain if needed for UI organization.

Rollback:

- Read-only projections can be disabled independently.

Tests:

- Confidential data redaction.
- Pagination/filter/sort safety.

## Phase J - Platform Clients

Goal:

- Build clients on top of SDK only.

Scope:

- OmniWA TUI.
- CLI.
- Web Dashboard.
- MCP server.

Tests:

- Client tests use SDK mocks/fixtures.
- No business logic in clients.
