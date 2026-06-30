# Phase A - HTTP Transport Foundation

## Status

Implemented as the first incremental step of Platform Evolution.

This phase turns `apps/api` into a real HTTP transport host while keeping the
current Domain and Application model unchanged.

## Source Basis

This implementation is based on:

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/PUBLIC_API_REVIEW.md`
- `docs/platform-evolution/MIGRATION_ROADMAP.md`
- `docs/adr/ADR-0001-platform-boundary.md`
- `docs/adr/ADR-0002-rest-api.md`
- `docs/adr/ADR-0007-public-contract.md`

## Framework Decision

Phase A uses Node.js built-in `node:http` instead of adding an external HTTP
framework.

Reasons:

- The repository had no approved HTTP framework or runtime dependency.
- Phase A only needs a thin transport shell over `@omniwa/interface-api`.
- Avoiding a framework keeps coupling low until OpenAPI and route coverage
  stabilize.
- The handler is testable without binding a real network port.

Trade-off:

- The router is intentionally small and should not grow into a custom web
  framework.
- If route complexity increases in Phase B/C, a dedicated framework can be
  introduced through ADR.

## Platform Boundary

Implemented boundary:

```text
HTTP REST request
  -> apps/api route mapper
  -> @omniwa/interface-api ApiInterfaceAdapter
  -> ApplicationInterfaceDispatcher
  -> Application layer
```

Routes do not call Domain, Provider, Repository, Queue, or Infrastructure
directly.

Public URLs do not expose internal Application command/query names.

## Implemented Runtime Files

| File                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/http-server.ts`      | HTTP server factory, request mapping, auth, envelopes, validation |
| `apps/api/src/index.ts`            | Runtime entry point and exports                                   |
| `apps/api/src/http-server.spec.ts` | Transport-level route/auth/envelope tests                         |
| `apps/api/package.json`            | Workspace dependencies for Application and Interface API          |
| `apps/api/tsconfig.json`           | Project references for imported workspace packages                |

## Authentication

Phase A supports a minimal API-key middleware.

Header:

```text
x-api-key: <secret>
```

Runtime environment variables:

| Variable                           | Purpose                                                         | Default          |
| ---------------------------------- | --------------------------------------------------------------- | ---------------- |
| `OMNIWA_API_KEY`                   | Required shared secret for the default runtime key              | unset            |
| `OMNIWA_API_KEY_ID`                | Safe key identifier used in actor references                    | `env-api-key`    |
| `OMNIWA_API_KEY_KIND`              | `api_key`, `admin_key`, `monitoring_key`, or `internal_runtime` | `api_key`        |
| `OMNIWA_API_KEY_SCOPES`            | Comma-separated API scopes                                      | P0 public scopes |
| `OMNIWA_API_KEY_ALLOWED_INSTANCES` | Optional comma-separated instance refs                          | unrestricted     |
| `OMNIWA_API_HOST`                  | API bind host                                                   | `127.0.0.1`      |
| `OMNIWA_API_PORT`                  | API bind port                                                   | `3000`           |

No secret is hardcoded in source.

## Request Identity

Phase A supports:

| Header             | Behavior                                       |
| ------------------ | ---------------------------------------------- |
| `x-request-id`     | Used as response request ID when provided      |
| `x-correlation-id` | Used as response correlation ID when provided  |
| `x-trace-id`       | Passed to the internal adapter when provided   |
| `idempotency-key`  | Passed to duplicate-prone Application commands |

If request or correlation IDs are absent, the transport generates safe fallback
values.

## Response Envelope

Successful responses use:

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

Error responses use:

```json
{
  "error": {
    "code": "string",
    "message": "string",
    "details": {}
  },
  "meta": {
    "requestId": "req_...",
    "correlationId": "corr_...",
    "timestamp": "2026-06-30T00:00:00.000Z"
  }
}
```

The transport also returns `x-request-id` and `x-correlation-id` headers.

## P0 Route Coverage

| Method | Path                                       | Internal Mapping              | Status                              |
| ------ | ------------------------------------------ | ----------------------------- | ----------------------------------- |
| GET    | `/v1/health`                               | `GetHealthStatus`             | Implemented                         |
| GET    | `/v1/instances`                            | `ListInstances`               | Implemented                         |
| GET    | `/v1/instances/:instanceId`                | `GetInstanceStatus`           | Implemented                         |
| POST   | `/v1/instances`                            | `CreateInstance`              | Implemented                         |
| POST   | `/v1/instances/:instanceId/connect`        | `ConnectInstance`             | Implemented                         |
| POST   | `/v1/instances/:instanceId/disconnect`     | `DisconnectInstance`          | Implemented                         |
| POST   | `/v1/instances/:instanceId/qr/refresh`     | `RefreshQrPairing`            | Implemented                         |
| POST   | `/v1/instances/:instanceId/messages/text`  | `SendTextMessage`             | Implemented                         |
| POST   | `/v1/instances/:instanceId/messages/media` | `SendMediaMessage`            | Implemented                         |
| GET    | `/v1/jobs`                                 | none available                | Partial: returns `501`              |
| GET    | `/v1/jobs/:jobId`                          | `GetWorkerJobStatus`          | Implemented via monitoring boundary |
| GET    | `/v1/webhooks`                             | none available                | Partial: returns `501`              |
| POST   | `/v1/webhooks`                             | `RegisterWebhookSubscription` | Implemented                         |

## Validation

Minimal validation is implemented for:

- safe path segments,
- JSON object request bodies,
- text-message `to` and `text` fields,
- media-message `to` plus `mediaId` or `mediaRef`,
- webhook `url`,
- optional instance `displayName`.

This is transport validation only. Business validation remains owned by
Application/Domain.

## Known Partial Behavior

Current Application envelopes carry `safeInputRef`, not detailed public DTO
payloads. Phase A validates bodies but passes only a safe input reference to the
internal adapter.

`apps/api` accepts an injected `ApplicationInterfaceDispatcher`. Because the
current source does not yet contain full Application use-case implementations,
the standalone runtime falls back to a safe unavailable dispatcher until Phase B
or a later implementation phase wires real Application services.

The following routes are intentionally partial because the current source does
not contain the required query/projection:

- `GET /v1/jobs`
- `GET /v1/webhooks`

They exist as public route placeholders and return safe `501` error envelopes
instead of pretending unsupported data exists.

## Tests Added

`apps/api/src/http-server.spec.ts` covers:

- health route mapping,
- missing auth,
- valid auth,
- success envelope,
- error envelope,
- instance list route,
- send text message route,
- partial route behavior.

## Exit Criteria

Phase A exit criteria met:

- API app accepts HTTP-shaped requests.
- API key authentication exists.
- Request/correlation IDs are present in response metadata.
- Success and error envelopes are stable.
- Routes map to `ApiInterfaceAdapter`.
- Internal command/query names are not exposed in public URLs.
- Partial route gaps are explicit.

## Next Phase

Recommended next phase: Phase B - REST Resources For Current Domains.

Phase B should add fuller resource mapping, route traceability, and projection
requirements before OpenAPI generation.
