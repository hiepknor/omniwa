# REST API P0

## Purpose

This document records the implemented Phase A REST HTTP surface.

It is not an OpenAPI specification and does not replace the frozen Phase 4 API
contract. It documents the current runtime implementation in `apps/api`.

## Public Boundary

Public clients call resource-oriented REST paths:

```text
Client -> REST /v1 resources -> ApiInterfaceAdapter -> Application
```

Internal command/query names remain private to the backend.

## Authentication

Every implemented P0 route requires:

```text
x-api-key: <secret>
```

The default runtime key is configured from `OMNIWA_API_KEY`.

## Request Metadata

Supported request headers:

| Header             | Purpose                                    |
| ------------------ | ------------------------------------------ |
| `x-request-id`     | Caller-provided request identity           |
| `x-correlation-id` | Caller-provided correlation identity       |
| `x-trace-id`       | Optional trace identity passed inward      |
| `idempotency-key`  | Required by duplicate-prone async commands |

## Response Envelope

Success:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_...",
    "timestamp": "2026-06-30T00:00:00.000Z"
  }
}
```

Error:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {
      "category": "validation"
    }
  },
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_...",
    "timestamp": "2026-06-30T00:00:00.000Z"
  }
}
```

## Implemented P0 Routes

| Method | Path                                       | Status      | Notes                                               |
| ------ | ------------------------------------------ | ----------- | --------------------------------------------------- |
| GET    | `/v1/health`                               | Implemented | Reads safe health status                            |
| GET    | `/v1/instances`                            | Implemented | Lists instances through current query boundary      |
| GET    | `/v1/instances/:instanceId`                | Implemented | Reads one instance status                           |
| POST   | `/v1/instances`                            | Implemented | Creates instance intent                             |
| POST   | `/v1/instances/:instanceId/connect`        | Implemented | Async connection intent                             |
| POST   | `/v1/instances/:instanceId/disconnect`     | Implemented | Disconnect intent                                   |
| POST   | `/v1/instances/:instanceId/qr/refresh`     | Implemented | QR refresh intent                                   |
| POST   | `/v1/instances/:instanceId/messages/text`  | Implemented | Text-message send intent                            |
| POST   | `/v1/instances/:instanceId/messages/media` | Implemented | Media-message send intent                           |
| GET    | `/v1/jobs`                                 | Partial     | Returns `501` until job-list projection exists      |
| GET    | `/v1/jobs/:jobId`                          | Implemented | Reads worker job status through monitoring boundary |
| GET    | `/v1/webhooks`                             | Partial     | Returns `501` until webhook-list projection exists  |
| POST   | `/v1/webhooks`                             | Implemented | Registers webhook subscription intent               |

## Minimal Request Body Validation

| Route                                   | Required Shape                                              |
| --------------------------------------- | ----------------------------------------------------------- |
| `POST /v1/instances`                    | JSON object; optional non-empty `displayName`               |
| `POST /v1/instances/:id/connect`        | JSON object                                                 |
| `POST /v1/instances/:id/disconnect`     | JSON object                                                 |
| `POST /v1/instances/:id/qr/refresh`     | JSON object                                                 |
| `POST /v1/instances/:id/messages/text`  | JSON object with non-empty `to` and `text`                  |
| `POST /v1/instances/:id/messages/media` | JSON object with non-empty `to` and `mediaId` or `mediaRef` |
| `POST /v1/webhooks`                     | JSON object with non-empty `url`                            |

## Current Limitations

- No OpenAPI document exists yet for these routes.
- No SDK exists yet.
- Request body fields are validated at transport level but are not yet modeled as
  detailed DTO contracts.
- The internal Application command envelope accepts `safeInputRef`, so Phase A
  does not persist or execute full message/webhook payloads.
- `GET /v1/jobs` and `GET /v1/webhooks` require read projections that are not
  present in the current source.

## Phase B Requirements

Before SDK/OpenAPI work, Phase B should:

- add route traceability tests for every implemented route,
- decide concrete request/response resource DTOs,
- add collection read models for jobs and webhooks,
- align monitoring/admin boundary behavior for worker-job reads,
- keep all public paths resource-oriented.
