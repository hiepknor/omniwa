# Public API Review

## Current API Reality

The repository currently has an internal `ApiInterfaceAdapter` in `@omniwa/interface-api`.

It is not a REST API implementation:

- No HTTP framework is present.
- No route source files exist.
- `apps/api/src/index.ts` exports nothing.
- No OpenAPI file exists.

The current adapter is still useful as a boundary from transport to Application, but it must remain internal.

## Public API Rule

Public clients must not see Application command/query names.

Allowed public shape:

```text
Client -> SDK -> REST Resource -> Interface API Adapter -> Application Command/Query
```

Forbidden public shape:

```text
Client -> POST /commands/SendTextMessage
Client -> { kind: "command", name: "SendTextMessage" }
```

## REST Resource Tree Based On Current Domains

This resource tree is additive and maps only to current source domains unless marked future.

### Platform And Health

| Method | Path                   | Current Mapping                 |
| ------ | ---------------------- | ------------------------------- |
| GET    | `/v1/health`           | `GetHealthStatus`               |
| GET    | `/v1/health/readiness` | `GetHealthStatus`               |
| GET    | `/v1/action-required`  | `GetActionRequiredItems`        |
| GET    | `/v1/metrics`          | `GetOperationalMetricsSnapshot` |
| GET    | `/v1/metrics/queue`    | `GetQueueMetricsSnapshot`       |
| GET    | `/v1/metrics/messages` | `GetMessageMetricsSnapshot`     |
| GET    | `/v1/metrics/webhooks` | `GetWebhookMetricsSnapshot`     |
| GET    | `/v1/metrics/media`    | `GetMediaMetricsSnapshot`       |

### Instances And Sessions

| Method | Path                                    | Current Mapping                                               |
| ------ | --------------------------------------- | ------------------------------------------------------------- |
| GET    | `/v1/instances`                         | `ListInstances`                                               |
| POST   | `/v1/instances`                         | `CreateInstance`                                              |
| GET    | `/v1/instances/{instanceId}`            | `GetInstanceStatus`                                           |
| PATCH  | `/v1/instances/{instanceId}`            | `UpdateInstanceMetadata`                                      |
| POST   | `/v1/instances/{instanceId}/connect`    | `ConnectInstance`                                             |
| POST   | `/v1/instances/{instanceId}/disconnect` | `DisconnectInstance`                                          |
| POST   | `/v1/instances/{instanceId}/reconnect`  | `ReconnectInstance`                                           |
| DELETE | `/v1/instances/{instanceId}`            | `DestroyInstance`                                             |
| POST   | `/v1/instances/{instanceId}/qr/refresh` | `RefreshQrPairing`                                            |
| GET    | `/v1/instances/{instanceId}/sessions`   | Needs query; current session info is only via instance status |

### Messages And Media

| Method | Path                                        | Current Mapping                                               |
| ------ | ------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/v1/instances/{instanceId}/messages`       | `SendTextMessage` or `SendMediaMessage` based on request type |
| GET    | `/v1/messages/{messageId}`                  | `GetMessageStatus`                                            |
| GET    | `/v1/messages/{messageId}/delivery-history` | `GetMessageDeliveryHistory`                                   |
| POST   | `/v1/messages/{messageId}/retry`            | `RetryMessageSend`                                            |
| POST   | `/v1/messages/{messageId}/cancel`           | `CancelMessage`                                               |
| POST   | `/v1/media`                                 | `RegisterMedia`                                               |
| GET    | `/v1/media/{mediaId}`                       | `GetMediaStatus`                                              |

Needed but not currently backed:

- `GET /v1/instances/{instanceId}/messages` for TUI timeline/list.

### Webhooks

| Method | Path                                          | Current Mapping                                                 |
| ------ | --------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/v1/webhooks`                                | Needs list query; current `GetWebhookStatus` is status-oriented |
| POST   | `/v1/webhooks`                                | `RegisterWebhookSubscription`                                   |
| GET    | `/v1/webhooks/{webhookId}`                    | `GetWebhookStatus`                                              |
| PATCH  | `/v1/webhooks/{webhookId}`                    | `UpdateWebhookSubscription`                                     |
| POST   | `/v1/webhooks/{webhookId}/activate`           | `ActivateWebhookSubscription`                                   |
| POST   | `/v1/webhooks/{webhookId}/suspend`            | `SuspendWebhookSubscription`                                    |
| DELETE | `/v1/webhooks/{webhookId}`                    | `RetireWebhookSubscription`                                     |
| GET    | `/v1/webhook-deliveries`                      | Needs list query                                                |
| GET    | `/v1/webhook-deliveries/{deliveryId}/history` | `GetWebhookDeliveryHistory`                                     |
| POST   | `/v1/webhook-deliveries/{deliveryId}/retry`   | `RetryWebhookDelivery`                                          |

### Jobs And Queue

| Method | Path               | Current Mapping                                        |
| ------ | ------------------ | ------------------------------------------------------ |
| GET    | `/v1/jobs/{jobId}` | `GetWorkerJobStatus`                                   |
| GET    | `/v1/jobs`         | Needs list query/projection                            |
| GET    | `/v1/queue`        | `GetQueueMetricsSnapshot` plus future queue projection |

### Provider

| Method | Path                                | Current Mapping               |
| ------ | ----------------------------------- | ----------------------------- |
| GET    | `/v1/provider/capabilities`         | `GetProviderCapabilityStatus` |
| POST   | `/v1/provider/capabilities/refresh` | `RefreshProviderCapability`   |

### Settings And Audit

| Method | Path                    | Current Mapping                 |
| ------ | ----------------------- | ------------------------------- |
| GET    | `/v1/settings`          | `GetConfigurationStatus`        |
| POST   | `/v1/settings/validate` | `ValidateConfigurationSnapshot` |
| POST   | `/v1/settings/activate` | `ActivateConfigurationSnapshot` |
| GET    | `/v1/audit-records`     | `QueryAuditRecords`             |

## Future Platform Resource Groups

These are not backed by current source and require domain/API addenda.

| Resource      | Future Paths                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chats         | `GET /v1/chats`, `GET /v1/instances/{instanceId}/chats`, `GET /v1/chats/{chatId}`                                                                             |
| Contacts      | `GET /v1/contacts`, `GET /v1/instances/{instanceId}/contacts`, `GET /v1/contacts/{contactId}`                                                                 |
| Groups        | `GET /v1/groups`, `GET /v1/instances/{instanceId}/groups`, `GET /v1/groups/{groupId}`                                                                         |
| Group Members | `GET /v1/groups/{groupId}/members`, `POST /v1/groups/{groupId}/members`, `DELETE /v1/groups/{groupId}/members/{memberId}`                                     |
| Group Actions | `POST /v1/groups/{groupId}/members/{memberId}/promote`, `POST /v1/groups/{groupId}/members/{memberId}/demote`, `POST /v1/groups/{groupId}/invite-link/rotate` |
| Events        | `GET /v1/events`, `GET /v1/events/stream`                                                                                                                     |
| Logs          | `GET /v1/logs`, `GET /v1/logs/stream`                                                                                                                         |
| API Clients   | `GET /v1/api-clients`, `POST /v1/api-clients`, `POST /v1/api-clients/{clientId}/rotate`                                                                       |

## API Standards Required Before SDK

- Versioned URL prefix: `/v1`.
- Stable response envelope.
- Stable error envelope.
- Cursor pagination.
- Safe filter/sort model.
- Idempotency key for async/mutating commands.
- Request ID and correlation ID on every response.
- OpenAPI operation IDs that name resources/actions, not internal commands.
