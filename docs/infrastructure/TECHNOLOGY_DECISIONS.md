# Technology Decisions

## Purpose

This document records Phase 6 infrastructure technology decisions.

These are architecture-level decisions. They do not create implementation code, Docker Compose, Kubernetes, Terraform, GitHub Actions, manifests, or configuration files.

## Decision Status

All decisions below are **Accepted for Phase 6 Infrastructure Design** unless marked deferred.

## TD-001 Runtime

| Field | Decision |
|---|---|
| Decision | Use a Node.js LTS runtime family for OmniWA runtime roles because Baileys/WhiskeySockets is a Node.js ecosystem dependency. Runtime roles remain API, Worker, Scheduler, Provider, Webhook, Projection, Metrics, and Health. |
| Why | Aligns with provider library ecosystem and avoids cross-language provider boundary complexity in MVP. |
| Alternatives | JVM, Go, Python, multi-language services. |
| Trade-offs | Node.js simplifies Baileys integration but requires careful worker isolation, process management, and backpressure handling. |
| Future Evolution | Provider abstraction allows future non-Node services only behind ports/adapters and ADR review. |

## TD-002 Database

| Field | Decision |
|---|---|
| Decision | PostgreSQL is the MVP durable source of truth for approved Aggregate state, repository state, projections, audit-safe evidence, idempotency, WorkerJob, and retention markers. |
| Why | Already frozen in Persistence; supports transactional consistency, read projections, backup, restore, and mature operational tooling. |
| Alternatives | MySQL, document database, event store, managed NoSQL, database-per-context. |
| Trade-offs | PostgreSQL centralizes MVP durability and simplifies recovery; write-heavy history needs retention/partition discipline. |
| Future Evolution | Read replicas, archive database, partitioning, sharding, and event sourcing require future review/ADR. |

## TD-003 Cache

| Field | Decision |
|---|---|
| Decision | Redis is the ephemeral cache and coordination store for query cache, rate windows, locks, queue-support hints, and runtime hints. |
| Why | Persistence freeze approves Redis for ephemeral roles only. |
| Alternatives | PostgreSQL-only cache, in-process cache, managed cache service, no cache. |
| Trade-offs | Redis improves latency and coordination, but Redis loss must not lose accepted product state. |
| Future Evolution | Managed Redis or clustered Redis can be introduced without changing Domain/Application semantics. |

## TD-004 Queue

| Field | Decision |
|---|---|
| Decision | Queue implementation must sit behind QueueProvider. MVP infrastructure may use Redis-backed queue support, but PostgreSQL WorkerJob state remains the durable recovery source. Exact queue library is deferred to implementation planning. |
| Why | Maintains accepted async work visibility and avoids making Redis the source of truth. |
| Alternatives | PostgreSQL-only queue, managed queue service, in-memory queue, direct worker calls. |
| Trade-offs | Redis-backed queue support improves worker throughput; requires reconciliation with durable WorkerJob state. |
| Future Evolution | Managed queue or database-backed jobs may replace Redis mechanics behind QueueProvider after ADR. |

## TD-005 Logging

| Field | Decision |
|---|---|
| Decision | Use structured JSON-compatible application logs with correlation_id, request_id, runtime_role, safe actor/key identifier, safe resource reference, and failure category. |
| Why | Supports machine parsing, incident response, and redaction governance. |
| Alternatives | Plain text logs, binary logs, vendor-specific logs only. |
| Trade-offs | Structured logs require discipline and redaction review, but improve operations. |
| Future Evolution | Logs can be shipped to any compliant logging backend; no vendor lock-in required. |

## TD-006 Metrics

| Field | Decision |
|---|---|
| Decision | Use Prometheus-compatible metric concepts for counters, gauges, histograms, and runtime health metrics. |
| Why | Fits SLI/SLO needs and supports many deployment environments without tying product code to a vendor. |
| Alternatives | Vendor-only metrics SDK, logs-as-metrics only, custom metrics collector. |
| Trade-offs | Requires cardinality governance; raw phone/JID/message identifiers must never be metric labels. |
| Future Evolution | Managed metrics backends can scrape or ingest the same metric vocabulary. |

## TD-007 Tracing

| Field | Decision |
|---|---|
| Decision | Use OpenTelemetry-compatible tracing concepts for request and async workflow trace propagation. |
| Why | Provides standard trace context across API, Worker, Provider, Webhook, and Projection boundaries. |
| Alternatives | Correlation ID only, vendor-specific tracing, no tracing. |
| Trade-offs | Tracing adds data volume and redaction responsibilities; sampled tracing is appropriate for MVP. |
| Future Evolution | Any OpenTelemetry-compatible backend can be selected during implementation. |

## TD-008 Object Storage

| Field | Decision |
|---|---|
| Decision | Use S3-compatible object storage semantics for temporary media artifacts, diagnostic artifacts, backup artifacts, and approved archives. Provider choice is deferred. |
| Why | S3-compatible semantics are broadly portable and match artifact lifecycle needs. |
| Alternatives | Local filesystem, database blobs, cloud-specific object APIs only. |
| Trade-offs | Object references and lifecycle policies need strict security; business metadata stays in PostgreSQL. |
| Future Evolution | S3-compatible managed service, MinIO-compatible local development, or cloud object storage can be selected later. |

## TD-009 Reverse Proxy

| Field | Decision |
|---|---|
| Decision | Use a standard HTTP reverse proxy boundary in front of API Runtime for TLS termination, routing, request size limits, and basic ingress protection. Concrete product is deferred. |
| Why | Keeps public ingress concerns out of API runtime and supports local/production topology differences. |
| Alternatives | API runtime exposed directly, cloud load balancer only, service mesh ingress. |
| Trade-offs | Adds another operational component; avoids exposing runtime processes directly. |
| Future Evolution | NGINX, Caddy, Traefik, cloud load balancer, or platform ingress can implement the boundary after infrastructure selection. |

## TD-010 Configuration

| Field | Decision |
|---|---|
| Decision | Use explicit environment-scoped configuration delivered through a ConfigurationProvider boundary and validated ConfigurationSnapshot flow. |
| Why | Configuration cannot silently disable guardrails or change product scope. |
| Alternatives | Ad hoc environment reads in modules, hard-coded config, runtime mutable config without validation. |
| Trade-offs | Validation adds startup and activation steps but prevents unsafe drift. |
| Future Evolution | Config files, environment variables, managed config stores, or secret-backed config may implement the provider later. |

## TD-011 Secret Management

| Field | Decision |
|---|---|
| Decision | Use a SecretProvider boundary for API key secret material, admin key secret material, webhook signing secrets, session/auth material, provider credentials, encryption keys, and backup secrets. Concrete provider is deferred. |
| Why | Secret handling must remain centralized, auditable, rotatable, and excluded from logs/projections/cache. |
| Alternatives | Plain environment variables only, database plaintext secrets, application-local secret files. |
| Trade-offs | Secret provider integration adds operational dependency but reduces leakage risk. |
| Future Evolution | Managed secret store, local development secret adapter, HSM/KMS-backed encryption, and rotation automation can be selected later. |

## Technology Decision Constraints

- Technology choices must not change frozen Product, API, Domain, Application, or Persistence semantics.
- Any concrete tool that changes architecture constraints requires ADR review.
- No technology may make Redis permanent storage.
- No technology may store raw Confidential or Secret data in logs, metrics, traces, cache, object paths, or public responses.
- No technology may bypass Application commands/queries or Repository Ports.
