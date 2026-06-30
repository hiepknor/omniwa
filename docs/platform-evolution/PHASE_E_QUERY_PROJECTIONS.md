# Phase E - Query Projections For Platform Clients

## Purpose

Phase E makes platform-client read paths explicit without changing write
aggregates, Domain business rules, provider adapters, persistence schema, or
worker execution.

The goal is to unblock TUI/Web/CLI read screens through Application query
contracts and derived projection catalog entries.

## Required Context

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/QUERY_REALTIME_SDK_TUI_REVIEW.md`
- `docs/api/OPENAPI_CONTRACT.md`
- `docs/sdk/RUST_SDK_FOUNDATION.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`

## Deliverables

| Deliverable                      | Status   | Notes                                                                                                 |
| -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Application query contracts      | Complete | Added list/dashboard queries for platform read screens                                                |
| REST route mapping               | Complete | Resolved projection-backed GET routes that were previously reserved                                   |
| Projection catalog               | Complete | Added dashboard, session list, message timeline, webhook list/delivery list, and job list projections |
| Projection builder runtime shell | Complete | `apps/projection-builder` now exposes runtime/catalog/store functions                                 |
| OpenAPI update                   | Complete | Projection routes now document `200` responses; `/v1/dashboard` added                                 |
| SDK generated catalog update     | Complete | Rust operation catalog regenerated from OpenAPI                                                       |
| SDK read wrappers                | Complete | Added dashboard/jobs/webhooks wrappers and list methods                                               |

## Added Application Queries

| Query                      | Purpose                                          | Consistency           |
| -------------------------- | ------------------------------------------------ | --------------------- |
| `GetDashboardSummary`      | Dashboard summary for platform clients           | `eventual_projection` |
| `ListInstanceSessions`     | Safe session list for an instance                | `eventual_projection` |
| `ListInstanceMessages`     | Retention-bound message timeline for an instance | `retention_bound`     |
| `ListWorkerJobs`           | Worker job list for Queue/Jobs screens           | `eventual_projection` |
| `ListWebhookSubscriptions` | Webhook subscription list                        | `eventual_projection` |
| `ListWebhookDeliveries`    | Retention-bound webhook delivery list            | `retention_bound`     |

## Resolved REST Routes

These routes now map through `ApiInterfaceAdapter` to Application queries:

| Method | Path                                  | Query                      |
| ------ | ------------------------------------- | -------------------------- |
| GET    | `/v1/dashboard`                       | `GetDashboardSummary`      |
| GET    | `/v1/jobs`                            | `ListWorkerJobs`           |
| GET    | `/v1/webhooks`                        | `ListWebhookSubscriptions` |
| GET    | `/v1/webhook-deliveries`              | `ListWebhookDeliveries`    |
| GET    | `/v1/instances/{instanceId}/messages` | `ListInstanceMessages`     |
| GET    | `/v1/instances/{instanceId}/sessions` | `ListInstanceSessions`     |

## Still Reserved

| Route                                       | Reason                                    |
| ------------------------------------------- | ----------------------------------------- |
| `POST /v1/instances/{instanceId}/reconnect` | Reconnect remains scheduler-owned.        |
| `POST /v1/provider/capabilities/refresh`    | Provider refresh remains scheduler-owned. |

## Boundary Confirmation

- API routes still call only the Interface API adapter.
- Application queries remain side-effect free.
- Projection store only stores derived read models.
- Projection builder runtime does not mutate Domain aggregates.
- SDK uses public REST operation metadata, not backend internals.

## Risks

| Risk                                                                    | Mitigation                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Projection responses are currently dispatcher outcomes, not stable DTOs | Keep projections behind Application query contracts; DTO refinement can be additive |
| In-memory projection store is not durable                               | Durable persistence remains Phase G                                                 |
| No realtime updates yet                                                 | Realtime SSE remains Phase F                                                        |
| Chat/Contact/Group projections still missing                            | Those domains remain future phases after domain approval                            |

## Exit Criteria

| Criteria                                                | Status |
| ------------------------------------------------------- | ------ |
| Dashboard summary query defined                         | PASS   |
| TUI-critical existing-domain list queries defined       | PASS   |
| Projection catalog completed for existing domains       | PASS   |
| Previously reserved projection routes mapped to queries | PASS   |
| OpenAPI route contract updated                          | PASS   |
| SDK generated operation catalog updated                 | PASS   |
| Projection builder app wired                            | PASS   |

**Phase E is complete.**

Recommended next phase: Phase F - Realtime Event Stream.
