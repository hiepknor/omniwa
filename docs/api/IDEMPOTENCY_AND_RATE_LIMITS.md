# Idempotency And Rate Limits

## Principles

- Idempotency protects duplicate-prone commands from accidental repeated effects.
- Rate limits protect OmniWA, WhatsApp account health, provider boundaries, and webhook receivers.
- API rate limits are transport and abuse controls; they do not replace Application guardrail policies.
- Query caching is separate from command idempotency.
- Idempotency keys and rate-limit logs must never contain secrets, raw phone/JID, message body, media binary, or provider payload.

## Idempotency Key Rules

| Rule | Decision |
|---|---|
| Header | Use an `Idempotency-Key` request header for duplicate-prone command endpoints |
| Scope | Key is scoped to API key, command type, target resource boundary, and safe request fingerprint |
| Lifetime | Retain long enough to cover client retry windows and async workflow replay risk |
| Replay result | Return the same safe accepted/result visibility for duplicate equivalent request |
| Conflict | Same key with materially different request produces idempotency conflict |
| Queries | Do not require idempotency key |
| Internal events | Use event occurrence identity or provider signal identity, not public API idempotency key |

## Endpoint Families Requiring Idempotency-Key

| Endpoint Family | Commands | Reason |
|---|---|---|
| Instance creation | CreateInstance | Avoid duplicate instance creation |
| Instance connection actions | ConnectInstance, StartQrPairing, RefreshQrPairing, ReconnectInstance | Avoid duplicate connect/reconnect/QR workflows |
| Message send | SendTextMessage, SendMediaMessage | Avoid duplicate outbound messages |
| Message retry/cancel | RetryMessageSend, CancelMessage | Avoid duplicate workflow mutation |
| Media registration | RegisterMedia | Avoid duplicate media registration |
| Webhook subscription mutation | RegisterWebhookSubscription, UpdateWebhookSubscription, ActivateWebhookSubscription, SuspendWebhookSubscription, RetireWebhookSubscription | Avoid duplicate subscription state transitions |
| Webhook delivery operations | RetryWebhookDelivery, MoveWebhookDeliveryToDeadLetter | Avoid duplicate replay/dead-letter changes |
| Configuration activation | ValidateConfigurationSnapshot, ActivateConfigurationSnapshot | Avoid duplicate operational changes |
| Diagnostic capture | RequestDiagnosticCapture | Avoid duplicate sensitive diagnostic work |
| Destructive operations | DestroyInstance | Avoid duplicate destructive lifecycle requests |

## Idempotent Application Commands

The API must align with the Application Idempotency Strategy. The following command families are treated as idempotent or duplicate-safe:

- Instance lifecycle commands.
- QR pairing commands.
- Messaging send/retry/cancel commands.
- Media registration and processing commands.
- Webhook subscription and delivery commands.
- Provider signal handling commands.
- Worker job lifecycle commands.
- Configuration validation/activation commands.
- Audit recording commands.
- Health and telemetry refresh commands.

## Cacheable Queries

| Query Family | Cache Candidate | Notes |
|---|---|---|
| ListInstances | Yes, short-lived | Must respect key scope |
| GetInstanceStatus | Yes, very short-lived | Do not mask connection transitions too long |
| GetMessageStatus | Yes, very short-lived | Async state changes frequently |
| GetMediaStatus | Yes, short-lived | Depends on processing state |
| GetWebhookStatus | Yes, short-lived | Subscription state changes less often |
| GetWebhookDeliveryHistory | Yes, short-lived pages | Must preserve cursor consistency |
| GetHealthStatus | Yes, very short-lived | Readiness must be timely |
| Metrics snapshots | Yes, short-lived | Use snapshot time in metadata |
| QueryAuditRecords | Cautious | Admin-only, append-only, cursor based |

Queries must remain side-effect-free even when cached.

## Rate Limit Boundaries

Rate limits apply at multiple boundaries.

| Boundary | Purpose |
|---|---|
| API key | Prevent one integration from exhausting system capacity |
| Admin key | Protect restricted operations from accidental loops |
| Instance | Protect WhatsApp account health and provider connection stability |
| Endpoint family | Protect expensive or high-risk operation classes |
| Source network | Slow brute force and abuse attempts |
| Webhook receiver | Prevent uncontrolled delivery pressure to external endpoints |

## Endpoint Family Rate Limit Guidance

| Endpoint Family | Limit Dimension | Reason |
|---|---|---|
| Authentication failures | Source and key identifier when safe | Abuse protection |
| Instance create/destroy | API key and admin key | Operational safety |
| Connect/reconnect/QR refresh | Instance and API key | Provider stability and account health |
| Message send | Instance, API key, message type | WhatsApp policy and provider backpressure |
| Media registration | API key, instance, media type | Storage and processing pressure |
| Webhook subscription changes | API key and webhook target | Configuration churn protection |
| Webhook retry/replay | Admin key, webhook target, delivery ID | Receiver protection and duplicate control |
| Metrics and history queries | API key and endpoint family | Query load protection |
| Audit queries | Admin key and time range | Sensitive operational data protection |

## Rate Limit Response Semantics

When a request is rate-limited, API should return:

- Stable error code `rate_limited`.
- Safe message.
- Retry guidance when safe.
- Request ID and correlation ID.
- No details that reveal other clients, provider internals, or sensitive capacity thresholds.

## Backpressure Relationship

Rate limits and backpressure are related but distinct:

| Mechanism | Layer | Purpose |
|---|---|---|
| API rate limit | API boundary | Reject excessive incoming requests early |
| Application guardrail | Application/Domain policy | Enforce product and compliance rules |
| Queue backpressure | Runtime/Infrastructure | Slow or stop async intake when workers are saturated |
| Provider throttling | Provider adapter | Protect external provider connection and account health |
| Webhook retry policy | Application/Worker | Protect external webhook receiver and preserve delivery semantics |

## Idempotency And Rate Limit Traceability

| API Surface | Idempotency | Rate Limit Boundary | Application Source |
|---|---|---|---|
| Instance API | Required for create/connect/reconnect/destroy/QR actions | API key, instance, action family | Instance commands |
| Message API | Required for send/retry/cancel | API key, instance, message type | Messaging commands |
| Media API | Required for registration and diagnostics | API key, instance, media type | Media commands |
| Webhook API | Required for mutation, retry, dead-letter | API key/admin key, webhook target | Webhook commands |
| Provider API | Required for refresh operation | Admin key | Provider commands |
| Configuration API | Required for activation | Admin key | Configuration commands |
| Health API | Not required for query | API key or monitoring scope for detailed health | Health queries |
| Monitoring API | Not required for query | Monitoring scope, endpoint family | Metrics queries |
| Audit API | Not required for query | Admin key, time range | Audit queries |
