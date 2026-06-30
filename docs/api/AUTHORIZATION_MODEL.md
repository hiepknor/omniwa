# Authorization Model

## Authorization Principles

- Authorization is operation-level and resource-aware.
- API authentication creates request identity; Application authorization evaluates whether the operation is allowed.
- Domain Layer must not know API keys, admin keys, scopes, or HTTP concepts.
- Interface Layer must not bypass Application access decisions for product behavior.
- MVP uses scoped technical credentials, not full user/team RBAC.

## Authorization Layers

| Layer | Responsibility | Must Not Do |
|---|---|---|
| API Layer | Authenticate caller, parse scopes, attach request identity, reject clearly unauthorized boundary access | Own product authorization policy |
| Application Layer | Evaluate access decision for use case, command, query, and resource boundary | Know HTTP transport details |
| Domain Layer | Enforce business invariants and policies unrelated to caller credentials | Check API keys or scopes |
| Infrastructure Layer | Enforce storage/provider/transport protections | Decide product access |

## Scope Model

MVP authorization uses scopes attached to API keys or admin keys.

| Scope | Allows | Boundary |
|---|---|---|
| `instances:read` | List and inspect instances | Public API |
| `instances:write` | Create/update instance metadata | Public API |
| `instances:connect` | Connect, disconnect, reconnect, QR pairing | Public API |
| `instances:destroy` | Destroy instance | Admin or explicitly elevated key |
| `messages:send` | Submit outbound text/media messages | Public API |
| `messages:read` | Read message status/history | Public API |
| `messages:retry` | Retry eligible message send | Public or Admin depending instance scope |
| `messages:cancel` | Cancel eligible message | Public or Admin depending instance scope |
| `media:write` | Register media | Public API |
| `media:read` | Read media status | Public API |
| `webhooks:write` | Manage webhook subscriptions | Public API |
| `webhooks:read` | Read webhook status/history | Public API |
| `webhooks:retry` | Retry webhook delivery | Admin or elevated public key |
| `health:read` | Read detailed health | Health API |
| `metrics:read` | Read metrics snapshots | Monitoring API |
| `config:read` | Read configuration status | Admin API |
| `config:write` | Validate and activate configuration | Admin API |
| `audit:read` | Query audit records | Admin API |
| `provider:read` | Read provider capability status | Admin API |
| `provider:refresh` | Refresh provider capability | Admin API |
| `jobs:read` | Read worker/job status | Monitoring or Admin API |
| `admin:*` | Administrative override within product constraints | Admin API |

## Instance-Level Boundary

OmniWA MVP is Single Tenant + Multi Instance. Authorization must still support instance-level boundaries.

Rules:

- A key may be allowed for all instances or a subset of instance IDs.
- Instance-scoped keys cannot read or mutate other instances.
- Message, media, webhook, delivery, and status operations must resolve to an instance boundary when applicable.
- Admin Key can cross instance boundaries, but still cannot bypass sensitive data rules or product guardrails.

## Operation-Level Access

| Operation Category | Required Access |
|---|---|
| Read safe status | Resource read scope plus instance access |
| Submit command | Resource write/send scope plus instance access |
| Retry command | Retry scope plus eligibility from Application workflow |
| Cancel command | Cancel scope plus workflow eligibility |
| Destructive operation | Admin Key or explicit elevated scope |
| Configuration activation | Admin Key |
| Audit query | Admin Key |
| Provider capability refresh | Admin Key |
| Detailed metrics | Monitoring scope or Admin Key |

## Admin-Only Operations

The following are Admin-only unless a future ADR/product decision narrows them:

- Destroy instance.
- Activate configuration.
- Query audit records.
- Refresh provider capability.
- Request diagnostic capture.
- Move webhook delivery to dead letter.
- Replay or retry webhook delivery outside normal caller-owned scope.
- Inspect worker job details beyond aggregate status.

## Authorization Failure

Authorization failure must:

- Avoid revealing whether the target resource exists when doing so would leak cross-instance information.
- Return a stable authorization error code.
- Log safe actor, scope, boundary, and resource identifier only when allowed.
- Never log secrets, message body, raw phone/JID, or provider payload.

## Future RBAC

Full RBAC is deferred. It may be needed when OmniWA supports:

- Multi Tenant.
- Human team administration.
- OAuth login.
- Fine-grained operator roles.
- Customer-managed API keys.

Introducing RBAC requires a future authorization ADR and likely API version review.
