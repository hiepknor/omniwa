# OmniWA Query Catalog

## Purpose

This document catalogs Phase 3.3 Application Queries.

Queries are read-only application contracts. This document does not define DTOs, REST APIs, OpenAPI, SQL, database views, ORM models, cache implementation, dashboard components, or source code.

## Query Groups

| Group | Queries |
| --- | --- |
| Status | GetInstanceStatus, GetMessageStatus, GetMediaStatus, GetWebhookStatus, GetHealthStatus, GetConfigurationStatus. |
| History | ListInstances, QueryAuditRecords, GetMessageDeliveryHistory, GetWebhookDeliveryHistory. |
| Configuration | GetConfigurationStatus. |
| Metrics | GetOperationalMetricsSnapshot, GetQueueMetricsSnapshot, GetWebhookMetricsSnapshot, GetMessageMetricsSnapshot, GetMediaMetricsSnapshot. |
| Monitoring | GetHealthStatus, GetActionRequiredItems, GetWorkerJobStatus, GetProviderCapabilityStatus. |

## Query Catalog

| Query | Traceability | Purpose | Returned Information | Read Model | Consistency Requirement | Caching Candidate |
| --- | --- | --- | --- | --- | --- | --- |
| GetInstanceStatus | UC-INS-011, MVP Instance lifecycle visibility. | Read safe instance lifecycle, readiness, connection, and action-required state. | InstanceId, lifecycle state, readiness summary, safe session availability marker, health category, action-required marker, stale marker where applicable. | Instance status view from Instance, Session availability summary, HealthStatus. | Strong owner read for Instance; Health may be eventual. | Conditional short cache when not used for immediate operator mutation. |
| ListInstances | UC-INS-012, MVP Single Tenant + Multi Instance. | Read safe list of managed instances. | Instance summaries, lifecycle, safe display metadata, health/action-required summary. | Instance list projection plus HealthStatus projection. | Eventual projection allowed with staleness marker. | Yes, short-lived. |
| GetMessageStatus | UC-MSG-010, MVP message lifecycle visibility. | Read safe message lifecycle and delivery visibility. | MessageId, direction, type category, lifecycle, delivery status, failure category, WorkerJob summary, webhook summary where approved. | Message status view with WorkerJob and WebhookDelivery summaries. | Strong owner read for Message; related job/webhook summaries may be eventual. | Conditional; avoid stale cache for active message troubleshooting. |
| GetMessageDeliveryHistory | Product Scope Messaging, Success Metrics Message Failure Rate. | Read retained safe delivery/status transition history for one message where retained. | Status transitions, retry/dead-letter markers, failure categories, timestamps, correlation references. | Message lifecycle history projection and WorkerJob summary. | Retention-bound; eventual projection allowed with marker. | Conditional; must respect retention. |
| GetMediaStatus | UC-MED-006, MVP media handling. | Read safe media processing and retention status. | MediaId, category, processing state, retention state, diagnostic capture marker, failure category, no raw binary. | MediaAsset safe status view. | Strong owner read for MediaAsset where possible. | Conditional. |
| GetWebhookStatus | UC-WEB-010, MVP webhook delivery reliability. | Read safe subscription and delivery lifecycle status. | Webhook subscription lifecycle, delivery state, retry/dead-letter status, safe receiver failure category, health marker. | WebhookSubscription and WebhookDelivery status views plus HealthStatus. | Strong owner read for requested subscription/delivery; health eventual. | Conditional. |
| GetWebhookDeliveryHistory | Product Scope Webhooks, Success Metrics Webhook Success Rate. | Read retained safe delivery attempts and outcomes. | Attempt count, first-attempt/eventual success markers, retry/dead-letter state, receiver failure category, timestamps. | WebhookDelivery attempt summary projection. | Retention-bound; eventual projection allowed. | Yes for historical records; not for active attempt state. |
| GetHealthStatus | UC-MON-003, NFR Observability/Availability. | Read safe health status for product or dependency subject. | Subject, health classification, safe cause category, action-required marker, staleness marker. | HealthStatus projection. | Eventual projection; stale marker required when not fresh. | Yes, short-lived. |
| QueryAuditRecords | UC-MON-004, NFR Security/Audit/Retention. | Read Secret-safe audit evidence by approved criteria. | AuditRecord summaries, category, source reference, retention marker, redaction marker, no Secret/raw Confidential evidence. | AuditRecord safe summary. | Retention-bound and access-scoped. | Conditional; cache must preserve access and retention. |
| GetConfigurationStatus | Product Scope Security baseline, NFR Deployment/Configuration/Guardrails. | Read safe active configuration status and safety classification. | Active snapshot reference, validation status, guardrail-safety marker, superseded/rejected summary, Secret-reference presence marker without values. | ConfigurationSnapshot safe status view. | Strong owner read for active snapshot; historical summary retention-bound. | Yes, short-lived. |
| GetOperationalMetricsSnapshot | Success Metrics API latency, worker stability, deployment/MTTR signals. | Read high-level operational metric snapshot. | API latency categories, workflow failure counts, MTTR markers, action-required counts, freshness marker. | Metrics/Telemetry/Health projection. | Eventual; stale marker required. | Yes, short-lived. |
| GetQueueMetricsSnapshot | Success Metrics Queue Throughput, Queue Success Rate, Worker Stability. | Read async work health and throughput by work type. | Work type counts, oldest pending age, completed/failed/retry/dead-letter counts, silent-drop indicator where known. | WorkerJob metrics projection and HealthStatus. | Eventual; must not hide pending/dead-letter state. | Yes, short-lived. |
| GetWebhookMetricsSnapshot | Success Metrics Webhook Success Rate. | Read webhook delivery reliability metrics. | First-attempt success rate, eventual success rate, retry counts, dead-letter counts, oldest pending delivery age. | WebhookDelivery metrics projection. | Eventual; freshness marker required. | Yes, short-lived. |
| GetMessageMetricsSnapshot | Success Metrics Message Failure Rate, API latency for enqueue operations. | Read message workflow reliability metrics. | Accepted/queued/failed/unknown counts, visible failure categories, enqueue latency category, retry/dead-letter counts. | Message and WorkerJob metrics projection. | Eventual; not source of message truth. | Yes, short-lived. |
| GetMediaMetricsSnapshot | Success Metrics Media Processing Success Rate. | Read media processing reliability metrics. | Success/failure counts by supported media category, failure categories, processing latency category, retry/dead-letter counts. | MediaAsset and WorkerJob metrics projection. | Eventual; not source of media truth. | Yes, short-lived. |
| GetActionRequiredItems | NFR Observability, Runtime Guardrails. | Read safe list of items requiring operator action. | Instance/session/provider/webhook/worker/config health action-required summaries and safe reasons. | HealthStatus and owner lifecycle projections. | Eventual; stale marker required. | Yes, short-lived. |
| GetWorkerJobStatus | Product Scope Queue, Success Metrics Queue Success Rate. | Read safe WorkerJob lifecycle for one job or owner context. | Job lifecycle, owner context reference, retry/dead-letter/action-required status, attempt summary. | WorkerJob status view. | Strong owner read for WorkerJob where possible. | Conditional; avoid stale cache for active recovery. |
| GetProviderCapabilityStatus | Product Scope provider abstraction, Baileys upgrade risk, NFR Reliability. | Read provider compatibility and capability classification. | ProviderProfile status, supported/degraded/unsupported categories for approved MVP capabilities, last refresh marker. | ProviderProfile safe capability view. | Strong owner read for ProviderProfile; external freshness may be stale-marked. | Yes, short-lived. |

## Deferred Query Boundaries

| Candidate Query | Status | Reason |
| --- | --- | --- |
| GetSession | Deferred | Session material is sensitive. MVP exposes safe session availability through GetInstanceStatus rather than standalone session detail. |
| GetMessages | Deferred | Message body is not retained by default and chat/message listing semantics require later product decision. |
| GetContacts | Deferred | Contacts are product scope but not in Phase 3 use case inventory yet; privacy review required. |
| GetChats | Deferred | Chat read model requires separate product/domain decision. |
| GetGroups | Deferred | Group capabilities are deferred from MVP. |
| Analytics queries | Deferred | Analytics is future scope and must not be smuggled through operational metrics. |

## Query Traceability Matrix

| Query Source | Queries |
| --- | --- |
| Approved Phase 3.1 query use cases | GetInstanceStatus, ListInstances, GetMessageStatus, GetMediaStatus, GetWebhookStatus, GetHealthStatus, QueryAuditRecords. |
| Product Scope capabilities | GetConfigurationStatus, GetMessageDeliveryHistory, GetWebhookDeliveryHistory, GetWorkerJobStatus, GetProviderCapabilityStatus. |
| Non-Functional / Success Metrics / Monitoring | GetOperationalMetricsSnapshot, GetQueueMetricsSnapshot, GetWebhookMetricsSnapshot, GetMessageMetricsSnapshot, GetMediaMetricsSnapshot, GetActionRequiredItems. |

## Query Constraints

- Query access must be read-only.
- Query execution must not enqueue recovery, refresh provider state, deliver webhook, write audit evidence, or mutate projections.
- Query read models must not expose raw payloads or Secret values.
- Query read models must not force repository ports to become broad reporting APIs.
- Metrics queries must not become campaign or usage-growth analytics without future product decision.
