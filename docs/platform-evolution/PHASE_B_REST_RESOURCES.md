# Phase B - REST Resources For Current Domains

## Status

Implemented as an incremental extension on top of Phase A HTTP Transport.

Phase B expands `apps/api` route coverage for the current Application command
and query catalog. It does not change Domain logic, Application orchestration,
repository behavior, provider behavior, or persistence.

## Source Basis

Phase B follows:

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/PUBLIC_API_REVIEW.md`
- `docs/api/ENDPOINT_GROUPS.md`
- `docs/api/IDEMPOTENCY_AND_RATE_LIMITS.md`
- `docs/adr/ADR-0001-platform-boundary.md`
- `docs/adr/ADR-0002-rest-api.md`
- `docs/adr/ADR-0007-public-contract.md`

## Boundary Rule

Implemented boundary remains:

```text
REST Resource -> apps/api route mapper -> ApiInterfaceAdapter -> Application
```

Routes still do not import Domain, Infrastructure, Provider, Queue, Repository,
or Baileys.

Internal command/query names are used only inside the route mapper and test
assertions. They are not exposed as public paths.

## Route Coverage Added

### Health And Monitoring

| Method | Path                   | Mapping                         | Boundary   | Status      |
| ------ | ---------------------- | ------------------------------- | ---------- | ----------- |
| GET    | `/v1/health/readiness` | `GetHealthStatus`               | health     | Implemented |
| GET    | `/v1/action-required`  | `GetActionRequiredItems`        | health     | Implemented |
| GET    | `/v1/metrics`          | `GetOperationalMetricsSnapshot` | monitoring | Implemented |
| GET    | `/v1/metrics/queue`    | `GetQueueMetricsSnapshot`       | monitoring | Implemented |
| GET    | `/v1/metrics/messages` | `GetMessageMetricsSnapshot`     | monitoring | Implemented |
| GET    | `/v1/metrics/webhooks` | `GetWebhookMetricsSnapshot`     | monitoring | Implemented |
| GET    | `/v1/metrics/media`    | `GetMediaMetricsSnapshot`       | monitoring | Implemented |
| GET    | `/v1/queue`            | `GetQueueMetricsSnapshot`       | monitoring | Implemented |

### Instances

| Method | Path                                  | Mapping                  | Boundary | Status         |
| ------ | ------------------------------------- | ------------------------ | -------- | -------------- |
| PATCH  | `/v1/instances/:instanceId`           | `UpdateInstanceMetadata` | public   | Implemented    |
| DELETE | `/v1/instances/:instanceId`           | `DestroyInstance`        | admin    | Implemented    |
| POST   | `/v1/instances/:instanceId/reconnect` | none public              | public   | Partial: `501` |
| GET    | `/v1/instances/:instanceId/sessions`  | none dedicated           | public   | Partial: `501` |

Reconnect is currently scheduler-owned in the Application command catalog.
Phase B therefore does not force it through the public/admin API boundary.

### Messages And Media

| Method | Path                                       | Mapping                                 | Boundary | Status         |
| ------ | ------------------------------------------ | --------------------------------------- | -------- | -------------- |
| POST   | `/v1/instances/:instanceId/messages`       | `SendTextMessage` or `SendMediaMessage` | public   | Implemented    |
| GET    | `/v1/instances/:instanceId/messages`       | none dedicated                          | public   | Partial: `501` |
| GET    | `/v1/messages/:messageId`                  | `GetMessageStatus`                      | public   | Implemented    |
| GET    | `/v1/messages/:messageId/delivery-history` | `GetMessageDeliveryHistory`             | public   | Implemented    |
| POST   | `/v1/messages/:messageId/retry`            | `RetryMessageSend`                      | public   | Implemented    |
| POST   | `/v1/messages/:messageId/cancel`           | `CancelMessage`                         | public   | Implemented    |
| POST   | `/v1/media`                                | `RegisterMedia`                         | public   | Implemented    |
| GET    | `/v1/media/:mediaId`                       | `GetMediaStatus`                        | public   | Implemented    |

Generic message submission uses a validated body `type` field:

- `text` maps to text message send.
- `media`, `image`, `video`, `document`, or `audio` maps to media message send.

### Webhooks

| Method | Path                                         | Mapping                       | Boundary | Status         |
| ------ | -------------------------------------------- | ----------------------------- | -------- | -------------- |
| GET    | `/v1/webhooks/:webhookId`                    | `GetWebhookStatus`            | public   | Implemented    |
| PATCH  | `/v1/webhooks/:webhookId`                    | `UpdateWebhookSubscription`   | public   | Implemented    |
| POST   | `/v1/webhooks/:webhookId/activate`           | `ActivateWebhookSubscription` | public   | Implemented    |
| POST   | `/v1/webhooks/:webhookId/suspend`            | `SuspendWebhookSubscription`  | public   | Implemented    |
| DELETE | `/v1/webhooks/:webhookId`                    | `RetireWebhookSubscription`   | public   | Implemented    |
| GET    | `/v1/webhook-deliveries`                     | none dedicated                | public   | Partial: `501` |
| GET    | `/v1/webhook-deliveries/:deliveryId/history` | `GetWebhookDeliveryHistory`   | public   | Implemented    |
| POST   | `/v1/webhook-deliveries/:deliveryId/retry`   | `RetryWebhookDelivery`        | public   | Implemented    |

`GET /v1/webhooks` remains partial because the current source has status query
support but no list projection.

### Provider, Settings, Audit

| Method | Path                                | Mapping                         | Boundary | Status         |
| ------ | ----------------------------------- | ------------------------------- | -------- | -------------- |
| GET    | `/v1/provider/capabilities`         | `GetProviderCapabilityStatus`   | admin    | Implemented    |
| POST   | `/v1/provider/capabilities/refresh` | none public                     | admin    | Partial: `501` |
| GET    | `/v1/settings`                      | `GetConfigurationStatus`        | admin    | Implemented    |
| POST   | `/v1/settings/validate`             | `ValidateConfigurationSnapshot` | admin    | Implemented    |
| POST   | `/v1/settings/activate`             | `ActivateConfigurationSnapshot` | admin    | Implemented    |
| GET    | `/v1/audit-records`                 | `QueryAuditRecords`             | admin    | Implemented    |

Provider capability refresh is currently scheduler-owned in the Application
catalog. It is not forced into the admin REST boundary in this phase.

## Validation Added

Phase B keeps validation transport-level only.

New validation includes:

- optional JSON object command bodies for retry/cancel/delete/action routes,
- generic message body type validation,
- media registration reference validation,
- existing webhook/settings object validation reused for admin routes.

Business rules still belong to Application/Domain.

## Tests Added

`apps/api/src/http-server.spec.ts` now covers:

- health readiness and action-required routes,
- monitoring metrics and queue routes,
- generic message route type mapping,
- message status/history/retry/cancel,
- media registration/status,
- webhook status/mutation/delivery history/retry,
- admin settings/audit/provider/destroy routes,
- partial routes for missing projections and boundary gaps.

## Known Partial Routes

| Route                                      | Reason                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `GET /v1/jobs`                             | Current source has worker job status query but no job-list projection     |
| `GET /v1/webhooks`                         | Current source has webhook status query but no webhook-list projection    |
| `GET /v1/webhook-deliveries`               | Current source has delivery history query but no delivery-list projection |
| `GET /v1/instances/:instanceId/messages`   | Message timeline requires a projection not present yet                    |
| `GET /v1/instances/:instanceId/sessions`   | Safe session visibility is currently via instance status only             |
| `POST /v1/instances/:instanceId/reconnect` | Command is scheduler-owned in the current Application catalog             |
| `POST /v1/provider/capabilities/refresh`   | Command is scheduler-owned in the current Application catalog             |

## Exit Criteria

Phase B exit criteria met:

- Current accessible Application commands/queries have resource routes.
- Route tests prove mapping through the interface adapter.
- Public URLs remain resource-oriented.
- Unsupported route families return explicit error envelopes.
- No Domain/Application rewrite was required.

## Next Phase

Recommended next phase: Phase C - OpenAPI Contract.

Before generating SDKs, Phase C should turn this implemented route surface into
a validated OpenAPI contract and document partial routes as unavailable until
their projections or boundary decisions exist.
