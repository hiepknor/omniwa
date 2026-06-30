# Storage Model

## Purpose

This document defines OmniWA logical storage model for Phase 5.1.

It does not choose PostgreSQL, Redis, object storage, SQL, Prisma, ORM, database tables, columns, indexes, migrations, or source code.

## Logical Storage Principles

- Logical storage is grouped by ownership and persistence responsibility, not physical database layout.
- Logical storage does not imply one physical database, one table, or one service.
- Each write storage has exactly one owning context and one source aggregate boundary.
- Derived read projections may combine sources, but they do not own source data.
- Storage must preserve opaque product identity and avoid provider/database/queue identifiers as public state.
- Storage must enforce data classification and retention boundaries.

## Logical Storage Catalog

| Logical Storage | Purpose | Owner Context | Source Aggregate | Data Classification | Source Of Truth? |
|---|---|---|---|---|---|
| Instance State Storage | Durable instance lifecycle, metadata, readiness summary, action-required state | Instance | Instance | Internal, selected Confidential markers | Yes |
| Session State Storage | Session lifecycle, recovery, retention marker, safe secret reference | Session | Session | Secret-sensitive; Secret values excluded | Yes |
| Messaging State Storage | Message lifecycle, supported type, delivery visibility, failure category | Messaging | Message | Confidential-safe metadata; body excluded by default | Yes |
| Media Metadata Storage | Media category, processing state, retention state, diagnostic marker | Media | MediaAsset | Confidential-safe metadata; binary excluded by default | Yes |
| Webhook Subscription Storage | Subscription lifecycle, safe destination reference, signal selection, secret reference marker | Webhook Delivery | WebhookSubscription | Confidential; Secret values excluded | Yes |
| Webhook Delivery Storage | Delivery lifecycle, attempt summary, retry/dead-letter state, delivery identity | Webhook Delivery | WebhookDelivery | Confidential-safe metadata; payload excluded by default | Yes |
| Guardrail Decision Storage | Responsible-usage allow/block/throttle/action-required outcome | Guardrails | GuardrailDecision | Internal with safe risk classifications | Yes |
| Provider Profile Storage | Product-level provider capability, compatibility, and failure classification vocabulary | Provider Integration | ProviderProfile | Internal; provider-native payload excluded | Yes |
| Worker Job Storage | Visible async work lifecycle, reservation, retry, dead lineage, owner context reference | Operations | WorkerJob | Internal operational state | Yes |
| Access Decision Storage | Capability decision, expiry, privileged marker, safe actor/target reference | Security and Access | AccessDecision | Confidential-safe security metadata | Yes |
| Audit Storage | Secret-safe audit evidence, redaction marker, retention category | Audit | AuditRecord | Confidential-safe; no Secret/raw evidence | Yes |
| Health Projection Storage | Product/dependency health classification and action-required markers | Health | HealthStatus | Internal operational projection | Projection source of health status |
| Configuration Storage | Validated/superseded/active configuration snapshot metadata and Secret references | Configuration | ConfigurationSnapshot | Confidential; Secret values excluded | Yes |
| Telemetry Projection Storage | Sanitized telemetry projection decisions and correlation-safe signal state | Observability | TelemetrySignal | Sanitized Internal only | Projection source of telemetry state |
| Read Projection Storage | Derived API query views for status, history, metrics, and lists | Query/Application projection | Derived from owner aggregates | Safe/redacted only | No |
| Future Archive Storage | Long-term retained/archived state after active lifecycle | Owner context of archived source | Source aggregate remains owner | Same or stricter classification | Archive copy only |
| Future Analytics Storage | Future projection for analytics if approved | Future analytics context | No source ownership | Sanitized projection only | No; deferred |

## Storage Responsibility By Capability

| Product Capability | Required Logical Storage |
|---|---|
| Instance lifecycle | Instance State Storage, Session State Storage, Health Projection Storage |
| QR pairing | Session State Storage, Instance State Storage |
| Messaging | Messaging State Storage, Guardrail Decision Storage, Worker Job Storage |
| Media | Media Metadata Storage, Worker Job Storage |
| Webhook | Webhook Subscription Storage, Webhook Delivery Storage, Worker Job Storage |
| Queue/Worker visibility | Worker Job Storage, Health Projection Storage |
| Provider abstraction | Provider Profile Storage, Health Projection Storage |
| Configuration | Configuration Storage, Audit Storage |
| Security/Audit | Access Decision Storage, Audit Storage |
| Observability/Metrics | Health Projection Storage, Telemetry Projection Storage, Read Projection Storage |
| API Query | Read Projection Storage plus owner storage for strong reads |

## Idempotency Storage Position

There is no standalone shared idempotency source of truth in Phase 5.1.

Idempotency state must be persisted inside the owning persistence unit for the command scope:

- Message send idempotency belongs with Messaging State Storage and Worker Job Storage.
- Webhook delivery idempotency belongs with Webhook Delivery Storage.
- Worker execution idempotency belongs with Worker Job Storage.
- Media registration/processing idempotency belongs with Media Metadata Storage and Worker Job Storage.
- Instance connect/reconnect idempotency belongs with Instance State Storage, Session State Storage, and Worker Job Storage as coordinated by Application.
- Configuration activation idempotency belongs with Configuration Storage.
- Audit evidence idempotency belongs with Audit Storage.

A future implementation may share physical persistence mechanics for idempotency, but logical ownership must remain with the owning context.

## Storage Lifecycle Classes

| Lifecycle Class | Meaning | Examples |
|---|---|---|
| Active Operational State | Current state needed for commands, queries, recovery, and workers | Instance, Session, Message, WebhookDelivery, WorkerJob |
| Retention-Bound History | Safe historical state retained for support, audit, or API history | Message delivery history, webhook delivery history, audit records |
| Projection State | Derived state for queries, metrics, health, and monitoring | HealthStatus, metrics snapshots, read projections |
| Archive Candidate | State that may move out of active operational storage after retention/terminal state | Completed jobs, expired sessions, retired webhooks |
| Deleted/Cleaned State | State removed or redacted after retention or cleanup | Media binary, raw payloads, expired diagnostic artifacts |

## Storage Model Constraints

- Logical storage may be physically colocated later, but ownership boundaries remain.
- Logical storage may be split later, but repository port semantics remain.
- Read Projection Storage cannot become the write model.
- Future Archive Storage cannot restore expired data into API responses unless policy permits it.
- Future Analytics Storage is deferred and must not consume raw message bodies, raw media, raw provider payloads, phone/JID, or webhook secrets.

## Storage Model Traceability

| Logical Storage | Aggregate | Repository Port | Application Use Case | API Resource | Product Capability |
|---|---|---|---|---|---|
| Instance State Storage | Instance | InstanceRepositoryPort | CreateInstance, ConnectInstance, ReconnectInstance, DestroyInstance, GetInstanceStatus | Instance | Instance |
| Session State Storage | Session | SessionRepositoryPort | StartQrPairing, ConfirmSessionActivated, MarkInstanceLoggedOut, GetInstanceStatus | Session, QR | Instance, Reliability |
| Messaging State Storage | Message | MessageRepositoryPort | SendTextMessage, SendMediaMessage, RetryMessageSend, GetMessageStatus | Message | Messaging |
| Media Metadata Storage | MediaAsset | MediaAssetRepositoryPort | RegisterMedia, ProcessMediaWork, GetMediaStatus | Media | Media, Messaging |
| Webhook Subscription Storage | WebhookSubscription | WebhookSubscriptionRepositoryPort | RegisterWebhookSubscription, UpdateWebhookSubscription, GetWebhookStatus | WebhookSubscription | Webhook |
| Webhook Delivery Storage | WebhookDelivery | WebhookDeliveryRepositoryPort | ScheduleWebhookDelivery, RetryWebhookDelivery, GetWebhookDeliveryHistory | WebhookDelivery | Webhook, Queue |
| Guardrail Decision Storage | GuardrailDecision | GuardrailDecisionRepositoryPort | EvaluateOutboundGuardrails, SendTextMessage, SendMediaMessage | Message | Guardrails, Messaging |
| Provider Profile Storage | ProviderProfile | ProviderProfileRepositoryPort | EvaluateProviderCompatibility, RefreshProviderCapability, GetProviderCapabilityStatus | Provider | Provider abstraction |
| Worker Job Storage | WorkerJob | WorkerJobRepositoryPort | QueueAsyncWork, ReserveWorkerJob, CompleteWorkerJob, GetWorkerJobStatus | WorkerJob | Queue, Worker |
| Access Decision Storage | AccessDecision | AccessDecisionRepositoryPort | EvaluateAccessDecision | Admin resources | Security |
| Audit Storage | AuditRecord | AuditRecordRepositoryPort | RecordAuditEvidence, QueryAuditRecords | AuditRecord | Audit, Security |
| Health Projection Storage | HealthStatus | HealthStatusRepositoryPort | RefreshHealthStatus, GetHealthStatus, GetActionRequiredItems | Health | Observability |
| Configuration Storage | ConfigurationSnapshot | ConfigurationSnapshotRepositoryPort | ValidateConfigurationSnapshot, ActivateConfigurationSnapshot, GetConfigurationStatus | Configuration | Configuration |
| Telemetry Projection Storage | TelemetrySignal | TelemetrySignalRepositoryPort | CaptureTelemetrySignal, metrics snapshot queries | Metrics | Observability |
