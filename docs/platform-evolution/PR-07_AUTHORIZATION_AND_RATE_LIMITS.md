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
| Admin bypass decision         | Complete | `admin:*` bypass is explicit in the ownership decision and can be audited.             |
| Instance-scoped rate limiting | Complete | Rate-limit buckets prefer resolved `instanceRef` over non-instance resource ids.       |
| Endpoint-class guardrails     | Complete | In-memory limiter supports per-endpoint-class limits such as lower message send caps.  |
| Runtime rate-limit wiring     | Complete | API runtime can opt in through env-configured fixed-window limits.                     |
| Rate-limit observability      | Complete | Limiter exposes safe bucket snapshots with key id, endpoint class, scope, and counts.  |
| Security audit hook           | Complete | HTTP boundary records auth, authorization, rate-limit denial, and admin bypass events. |
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
- Persist `ApiSecurityAuditSink` events into the approved audit storage.
- Wire production-grade distributed rate limiting before multi-process production runtime.
- Export rate-limit snapshots through the approved metrics runtime.
