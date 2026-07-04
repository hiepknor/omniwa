# PR-07 - Authorization And Rate Limits

## Status

Implemented as a production-readiness foundation.

This PR hardens the API transport boundary without changing Domain, Application, or public route
semantics. It adds explicit resource ownership metadata, rate-limit scopes, and security audit
hooks that production adapters can persist later.

## Scope Implemented

| Area                          | Status   | Notes                                                                                  |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Resource ownership types      | Complete | Ownership checks now classify instance, message, group, webhook, delivery, job, event. |
| Resource ownership resolver   | Complete | In-memory resource-to-instance resolver exists for runtime/test composition.           |
| Repository ownership resolver | Partial  | Runtime can resolve session/message/chat/contact/group/job owners from repositories.   |
| Admin bypass decision         | Complete | `admin:*` bypass is explicit in the ownership decision and can be audited.             |
| Instance-scoped rate limiting | Complete | Rate-limit buckets prefer resolved `instanceRef` over non-instance resource ids.       |
| Endpoint-class guardrails     | Complete | In-memory limiter supports per-endpoint-class limits such as lower message send caps.  |
| Runtime rate-limit wiring     | Complete | API runtime can opt in through env-configured fixed-window limits.                     |
| Rate-limit observability      | Complete | Limiter exposes safe snapshots and exports low-cardinality API metric points.          |
| Security audit hook           | Complete | HTTP boundary records auth, authorization, rate-limit denial, and admin bypass events. |
| Runtime audit wiring          | Complete | API runtime can opt in to in-memory, durable JSON, or domain AuditRecord evidence.     |
| Regression coverage           | Complete | Tests cover resource ownership, rate exhaustion, audit events, and admin bypass.       |

## Boundary Rules Preserved

- Public routes remain resource-oriented.
- Route handlers still call the Interface Adapter and do not contain business rules.
- Resource ownership resolution is injected through `ApiResourceOwnershipResolver`.
- Rate limiting is injected through `ApiRateLimiter`.
- Security audit is injected through `ApiSecurityAuditSink`.
- Audit events contain safe metadata only; raw API keys and request bodies are not recorded.

## Runtime Behavior

Authorization flow:

```text
Authenticate x-api-key
  -> route validation
  -> resource ownership decision
  -> rate-limit decision
  -> Interface Adapter
  -> Application Layer
```

Rate-limit buckets are keyed by:

```text
api key id + endpoint class + scope kind + scope ref
```

The scope prefers the resolved instance ref. If the target cannot be resolved to an instance yet,
the limiter falls back to the target resource id or a global bucket.

Runtime composition enables the in-memory limiter only when both variables are configured:

- `OMNIWA_API_RATE_LIMIT_MAX_REQUESTS`
- `OMNIWA_API_RATE_LIMIT_WINDOW_MS`

Optional endpoint-class overrides:

- `OMNIWA_API_RATE_LIMIT_READ_MAX_REQUESTS`
- `OMNIWA_API_RATE_LIMIT_WRITE_MAX_REQUESTS`
- `OMNIWA_API_RATE_LIMIT_MESSAGE_SEND_MAX_REQUESTS`
- `OMNIWA_API_RATE_LIMIT_ADMIN_MAX_REQUESTS`
- `OMNIWA_API_RATE_LIMIT_EVENT_STREAM_MAX_REQUESTS`

Runtime composition can also enable the current security-audit sinks with:

- `OMNIWA_API_SECURITY_AUDIT_IN_MEMORY=true`
- `OMNIWA_API_SECURITY_AUDIT_LOG_PATH`
- `OMNIWA_API_SECURITY_AUDIT_RECORDS=true`

These sinks are mutually exclusive. The `OMNIWA_API_SECURITY_AUDIT_RECORDS=true` path records safe
denied-decision evidence as approved domain `AuditRecord` aggregates when the selected repository
profile provides `AuditRecordRepositoryPort`. PostgreSQL AuditRecord persistence remains follow-up
because the current PostgreSQL repository set does not yet cover the full catalog port.

Runtime composition can enable repository-backed ownership resolution with:

- `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true`

The resolver currently covers resources whose aggregate state already carries explicit instance
ownership: session, message, chat, contact, group, and worker jobs with safe `instanceId` metadata.
Resources without current instance-owner fields fail closed when this resolver is enabled and remain
follow-up work for full production coverage.

Rate-limit snapshots can be converted into approved API metric points:

- `api.rate_limit.bucket.count`
- `api.rate_limit.bucket.remaining`
- `api.rate_limit.bucket.limit`

The exporter aggregates by endpoint class and scope kind only. It does not export API key ids, bucket
keys, instance refs, target refs, or raw request data.

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  apps/api/src/runtime-composition.spec.ts \
  apps/api/src/api-rate-limiter.spec.ts \
  apps/api/src/resource-ownership.spec.ts \
  apps/api/src/http-server.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Replace the in-memory ownership resolver with a persistent resolver backed by production read
  models or repositories.
- Wire production-grade distributed rate limiting before multi-process production runtime.
- Complete ownership coverage for resources that do not yet carry an explicit owner in current
  aggregate state.
- Add PostgreSQL `AuditRecordRepositoryPort` coverage before claiming production audit persistence.
