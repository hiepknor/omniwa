# REST API Phase B

## Purpose

This document records the implemented Phase B REST resource surface.

The Phase C OpenAPI contract for this surface is available at
`docs/api/openapi/omniwa-v1.openapi.json`.

## Authentication

All Phase B routes require `x-api-key`.

The API key kind and scopes determine boundary access:

| Boundary   | Accepted Key Kind                           | Typical Scopes                                   |
| ---------- | ------------------------------------------- | ------------------------------------------------ |
| public     | `api_key` or `admin_key`                    | instance, message, media, webhook, health scopes |
| health     | `api_key`, `admin_key`, or `monitoring_key` | `health:read`                                    |
| monitoring | `admin_key` or `monitoring_key`             | `metrics:read`, `jobs:read`                      |
| admin      | `admin_key`                                 | `admin:*`                                        |

## Implemented Routes

### Health

| Method | Path                   |
| ------ | ---------------------- |
| GET    | `/v1/health`           |
| GET    | `/v1/health/readiness` |
| GET    | `/v1/action-required`  |

### Metrics And Queue

| Method | Path                   |
| ------ | ---------------------- |
| GET    | `/v1/metrics`          |
| GET    | `/v1/metrics/queue`    |
| GET    | `/v1/metrics/messages` |
| GET    | `/v1/metrics/webhooks` |
| GET    | `/v1/metrics/media`    |
| GET    | `/v1/queue`            |
| GET    | `/v1/jobs/:jobId`      |

### Instances

| Method | Path                                   |
| ------ | -------------------------------------- |
| GET    | `/v1/instances`                        |
| POST   | `/v1/instances`                        |
| GET    | `/v1/instances/:instanceId`            |
| PATCH  | `/v1/instances/:instanceId`            |
| DELETE | `/v1/instances/:instanceId`            |
| POST   | `/v1/instances/:instanceId/connect`    |
| POST   | `/v1/instances/:instanceId/disconnect` |
| POST   | `/v1/instances/:instanceId/qr/refresh` |

### Messages And Media

| Method | Path                                       |
| ------ | ------------------------------------------ |
| POST   | `/v1/instances/:instanceId/messages`       |
| POST   | `/v1/instances/:instanceId/messages/text`  |
| POST   | `/v1/instances/:instanceId/messages/media` |
| GET    | `/v1/messages/:messageId`                  |
| GET    | `/v1/messages/:messageId/delivery-history` |
| POST   | `/v1/messages/:messageId/retry`            |
| POST   | `/v1/messages/:messageId/cancel`           |
| POST   | `/v1/media`                                |
| GET    | `/v1/media/:mediaId`                       |

### Webhooks

| Method | Path                                         |
| ------ | -------------------------------------------- |
| POST   | `/v1/webhooks`                               |
| GET    | `/v1/webhooks/:webhookId`                    |
| PATCH  | `/v1/webhooks/:webhookId`                    |
| POST   | `/v1/webhooks/:webhookId/activate`           |
| POST   | `/v1/webhooks/:webhookId/suspend`            |
| DELETE | `/v1/webhooks/:webhookId`                    |
| GET    | `/v1/webhook-deliveries/:deliveryId/history` |
| POST   | `/v1/webhook-deliveries/:deliveryId/retry`   |
| POST   | `/v1/webhook-deliveries/:deliveryId/redrive` |

### Admin

| Method | Path                        |
| ------ | --------------------------- |
| GET    | `/v1/provider/capabilities` |
| GET    | `/v1/settings`              |
| POST   | `/v1/settings/validate`     |
| POST   | `/v1/settings/activate`     |
| GET    | `/v1/audit-records`         |

## Partial Routes

The route exists and returns a safe `501` error envelope.

| Method | Path                                  | Reason                                                             |
| ------ | ------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/v1/instances/:instanceId/messages`  | No message timeline projection in current source                   |
| POST   | `/v1/instances/:instanceId/reconnect` | Reconnect is scheduler-owned in current Application catalog        |
| POST   | `/v1/provider/capabilities/refresh`   | Provider refresh is scheduler-owned in current Application catalog |

## Idempotency

Duplicate-prone command routes must send:

```text
idempotency-key: <stable-client-key>
```

The current `ApiInterfaceAdapter` enforces idempotency for command catalog
entries that require it.

## Current Limitations

- Responses still expose Application outcome objects in `data`; stable resource
  DTOs are deferred to Phase C/OpenAPI.
- Collection routes that require projections are intentionally partial.
- The standalone runtime still requires a real dispatcher to be injected before
  it can execute product behavior beyond safe unavailable fallback responses.
- No SDK, realtime stream, Groups, Chats, or Contacts implementation is
  included in Phase B.
