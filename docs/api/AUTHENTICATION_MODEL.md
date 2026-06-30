# Authentication Model

## Authentication Principles

- Authentication identifies the caller; authorization decides whether the caller may perform the operation.
- API secrets are Secret data and must never be logged or returned.
- Authentication must produce a safe request identity for Application authorization.
- API authentication does not replace product guardrails or Application access decisions.

## Supported Authentication Types

| Auth Type | Purpose | Boundary | MVP | Notes |
|---|---|---|---|---|
| API Key | Authenticates public API clients | Public API | Yes | Primary MVP mechanism |
| Admin Key | Authenticates restricted administrative access | Admin API | Yes | Separate from normal API key |
| Monitoring Key or Scope | Authenticates monitoring systems | Health and Monitoring API | Yes | May be represented as scoped API key |
| Internal Runtime Identity | Authenticates worker, scheduler, and provider signal boundaries if transport-exposed | Internal Runtime API | Internal | Not public |
| Webhook Signing Secret | Allows webhook consumers to verify outbound deliveries | Webhook Delivery Boundary | Yes | Not used to authenticate inbound public API |
| OAuth | Delegated user/team access | Public and Admin future | Future | Requires future product and security decision |

## API Key Model

API Key is the default authentication method for MVP public API.

Required properties at the contract level:

- Key identifies an integration or technical caller.
- Key has a stable key identifier that can be logged safely.
- Key secret is never logged, returned, or stored in plain text.
- Key can be scoped to operations and optionally to instance boundaries.
- Key can be rotated without changing product resource identity.

## Admin Key Model

Admin Key is separate from API Key.

Admin Key is required for:

- Configuration activation.
- Audit record queries.
- Provider capability refresh.
- Destructive or restricted operations.
- Dead-letter and replay operations that can alter operational history.
- Diagnostic capture requests.

Admin Key must not be used by normal client integrations.

## Request Identity

After authentication, API produces a safe request identity that can be passed to Application authorization.

| Identity Attribute | Purpose | Sensitive? |
|---|---|---|
| key_id | Stable non-secret identifier for the credential | No |
| key_type | API, Admin, Monitoring, Internal | No |
| scopes | Candidate operation permissions | No |
| allowed_instance_ids | Optional instance-level boundary | Confidential if broad operational detail; do not over-log |
| request_id | Transport request tracking | No |
| correlation_id | Workflow tracing | No |
| source_ip or network hint | Abuse and audit signal | Internal |

## Key Rotation

Key rotation policy:

- Support overlapping old and new keys during a rotation window.
- Rotation must not invalidate active workflows unless the operation requires re-authentication.
- Revoked keys must fail new requests.
- Audit records should store safe key identifiers, not secrets.
- Rotation events should be observable through admin/audit surfaces.

Recommended MVP rotation window:

- 7 to 30 days for planned rotation.
- Immediate revocation for compromise.

## Secret Handling

| Secret | Handling Rule |
|---|---|
| API Key secret | Never log, never return after creation, store only protected form |
| Admin Key secret | Stronger operational restriction, never used by public clients |
| Webhook Signing Secret | Never shown in logs; expose only through controlled creation/rotation flow |
| Session secret | Never exposed through API |
| Provider token/payload | Never exposed through API |

## Failed Authentication

Failed authentication must:

- Return a generic authentication error.
- Avoid confirming whether a key identifier exists.
- Not include secret fragments.
- Be rate-limited by source and boundary.
- Be auditable through safe metadata.

## Future OAuth

OAuth is deferred because MVP targets technical API clients and internal teams. OAuth may be introduced later for:

- Human operator login.
- Team-based administration.
- Fine-grained role assignment.
- Marketplace or third-party integration authorization.

Introducing OAuth requires new product/security decisions and likely API version review.
