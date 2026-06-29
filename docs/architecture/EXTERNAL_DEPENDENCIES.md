# OmniWA External Dependencies

## Purpose

This document describes external systems and dependencies at system context level.

It does not select implementation libraries, design database schemas, design queue internals, define Docker, or create API contracts.

## Dependency Status Terms

| Status | Meaning |
| --- | --- |
| Required by product direction | Required by frozen product decisions or current product premise. |
| Expected architecture concern | Likely required by Phase 1 architecture, but implementation details remain undecided. |
| Future option | Not MVP scope unless a later ADR or product decision accepts it. |

## External Dependency Matrix

| External System | Status | Purpose | Direction | Data Exchanged | Risk | Failure Mode | Mitigation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WhatsApp Web / WhatsApp Network | Required by product direction | Actual WhatsApp communication path for accounts and end customers | Bidirectional through provider boundary | Messages, media transfer behavior, delivery/status signals, account/session conditions | Upstream behavior changes, account restrictions, policy enforcement | Send/receive interruption, unknown status, session disconnect, account action-required | Provider abstraction, failure categorization, reconnect visibility, no delivery guarantee claims |
| WhiskeySockets/Baileys | Required by product direction | Initial WhatsApp provider library | OmniWA provider adapter calls Baileys; Baileys emits provider events | Provider events, session state, message payloads, media operations, disconnect reasons | Breaking changes, undocumented behavior, library bugs | Adapter regressions, changed event shape, session instability | Exact version pinning, regression validation, adapter isolation, rollback |
| PostgreSQL | Expected architecture concern | Candidate durable storage service for OmniWA-owned recoverable state | OmniWA runtime to data storage boundary | Instance metadata, operational state, audit metadata, webhook/message metadata, retention-managed records | Unavailability, data corruption, misconfiguration, unauthorized access | Product state unavailable, recovery degraded, audit gaps | Storage behind ports, backup/recovery requirements, encryption/access controls, health checks |
| Redis | Expected architecture concern | Candidate volatile coordination/cache/queue-support service | OmniWA runtime to queue/data-service boundary | Job state support, transient coordination, rate-limit counters, cache-like state where approved later | Memory loss, eviction, unavailability, misconfiguration | Queue delays, retry stalls, rate-limit inconsistency | Queue abstraction, terminal state visibility, no silent drops, health checks, persistence decision in later ADR |
| Object Storage | Future option | Future storage for diagnostic media or large artifacts if explicitly enabled | OmniWA runtime to storage boundary | Media objects or diagnostic artifacts subject to retention policy | Sensitive data leakage, retention violation, unavailable storage | Media diagnostics unavailable, privacy incident | No default media body retention, explicit diagnostic capture, encryption, retention enforcement |
| Reverse Proxy | Future option | Future edge routing, TLS termination, request filtering, and operational boundary | Public Internet to OmniWA interface boundary | Requests, headers, correlation context, TLS metadata | Misconfiguration, header spoofing, auth bypass assumptions | Public surface unavailable or incorrectly exposed | Treat as external boundary, validate inside OmniWA, do not trust headers without explicit policy |
| Monitoring System | Future option / expected operations concern | Receive sanitized logs, metrics, traces, health states, alerts | OmniWA observability boundary to monitoring system | Structured logs, metrics, trace IDs, alert events | Sensitive data leakage, telemetry loss, vendor outage | Reduced incident visibility, privacy exposure | Mandatory redaction, no Secret logging, health alerts, safe telemetry fields |
| External Webhook Receiver | Required by product direction | Receives OmniWA integration events | OmniWA webhook boundary to downstream system | Integration events, delivery attempts, acknowledgements, failures/timeouts | Downtime, slow responses, bad acknowledgements, data exposure | Retry backlog, dead-letter events, downstream workflow failure | Async delivery, retries, idempotency expectations, terminal failed/dead-letter visibility |
| Optional WhatsApp Cloud API | Future option | Future official provider alternative if product scope accepts it | OmniWA provider adapter to official platform | Official API messages/events/templates/statuses where approved later | Different product rules, cost, compliance constraints, API limits | Provider mismatch, unsupported capability, migration complexity | Provider abstraction, new product decision, new ADR, no MVP assumption |

## Dependency Notes

### WhatsApp Web / WhatsApp Network

This is outside OmniWA control. OmniWA must separate platform health from provider/account/network health. Unknown states must be surfaced honestly.

### WhiskeySockets/Baileys

Baileys is a provider implementation dependency, not a domain boundary. No business logic may depend directly on Baileys-specific types or lifecycle callbacks.

### PostgreSQL

This document does not choose PostgreSQL as the final persistence architecture. It is included because Phase 1.2 must account for a durable data service boundary and the prompt names PostgreSQL. If adopted later, it must remain behind persistence ports and data ownership ADRs.

### Redis

This document does not choose Redis as the final queue or coordination architecture. It is included because Phase 1.2 must account for queue/data-service risks and the prompt names Redis. If adopted later, it must remain behind queue/coordination ports and async job rules.

### Object Storage

Object storage is not MVP-required for default message/media retention because message and media bodies are not retained by default after processing. It may become relevant for explicit diagnostic capture or future media workflows.

### Reverse Proxy

A reverse proxy may exist in future deployment contexts, but OmniWA must not rely on it as the only validation or security layer.

### Monitoring System

Monitoring receives sanitized observability data only. It must never be treated as a safe destination for raw provider payloads, message bodies, webhook payloads, session material, or secrets.

### External Webhook Receiver

Webhook receivers are outside OmniWA's trust boundary. OmniWA owns delivery attempts, retries, terminal states, and visibility; the receiver owns endpoint uptime and downstream processing.

### Optional WhatsApp Cloud API

Cloud API support is future optional scope. It cannot be assumed by MVP module architecture except as a reason to preserve provider abstraction.
