# Scalability

## Purpose

This document defines OmniWA Phase 6 scalability design.

It evaluates vertical scaling, horizontal scaling, worker scaling, read replicas, queue scaling, multi-region future, and multi-tenant future without creating deployment manifests or implementation configuration.

## Capacity Assumptions

MVP assumptions:

- Single Tenant + Multi Instance.
- WhatsApp/Baileys provider behavior is a limiting external dependency.
- API latency target is under 500 ms P95 for common non-media operations.
- Text message enqueue target is under 300 ms P95 under normal MVP load.
- Media enqueue target is under 1 second P95 excluding network/provider-dominated upload/download.
- Webhook delivery target is 99.0% eventual delivery within 15 minutes for healthy receivers.
- Recovery target is RPO 24 hours and RTO 4 hours for P1 OmniWA-controlled recovery.

## Bottlenecks

| Bottleneck | Symptom | Primary Mitigation |
|---|---|---|
| API CPU/event loop pressure | API latency or error rate increases | Scale API processes, reduce sync work, move work to Worker. |
| PostgreSQL write pressure | Command latency, lock waits, queue reservation delays | Tune transaction scope, reduce unnecessary indexes, partition retention-heavy data later. |
| PostgreSQL read pressure | Query latency, projection reads slow | Use projections, read replicas for eventual/snapshot reads. |
| Redis contention | Lock failures, queue-support lag, cache latency | Reduce lock scope, add Redis capacity, ensure durable fallback. |
| Worker saturation | Queue depth, oldest pending work age, retry delays | Add workers or specialize by work type. |
| Provider connection limits | Reconnect failures, provider event lag | Limit per-instance concurrency, isolate Provider Runtime, action-required status. |
| Webhook receiver failures | Retry backlog, dead-letter growth | Backoff, isolate webhook workers, classify receiver health. |
| Object Storage latency | Media/artifact operations delayed | Decouple media work, retry artifact operations, mark action-required if needed. |
| Observability overload | Telemetry lag or dropped logs/metrics | Sampling, cardinality control, prioritized alerts. |

## Vertical Scaling

Vertical scaling is the first MVP lever:

- increase API runtime CPU/memory when request latency is CPU/event-loop bound,
- increase Worker runtime capacity when one process can safely handle more concurrency,
- increase PostgreSQL resources before introducing multi-node storage complexity,
- increase Redis resources when ephemeral coordination latency affects runtime,
- tune Object Storage/artifact throughput by provider configuration later.

Trade-off: vertical scaling is simpler but has an upper bound and larger blast radius.

## Horizontal Scaling

Horizontal scaling is allowed after ownership and idempotency safety are proven.

| Runtime | Horizontal Scaling Readiness |
|---|---|
| API | Safe with shared PostgreSQL/Redis and stateless request handling. |
| Worker | Safe when WorkerJob reservation and idempotency prevent duplicate execution. |
| Webhook Dispatcher | Safe when WebhookDelivery attempt ownership is enforced. |
| Projection Builder | Safe when projection rebuild ownership prevents duplicate rebuild conflicts. |
| Scheduler | Requires single-active ownership or leader election. |
| Provider Runtime | Requires one active provider owner per instance. |
| Metrics Exporter | Safe if metrics cardinality and duplicate collection are controlled. |

## Worker Scaling

Worker scaling should be driven by:

- oldest pending work age,
- queue depth by work type,
- processing latency by work type,
- retry count and retry backlog,
- dead-letter growth,
- provider event lag,
- webhook receiver failure rate.

Worker specialization triggers:

| Trigger | Specialization |
|---|---|
| Webhook retries dominate queue | Dedicated Webhook Dispatcher/worker pool. |
| Media processing slows message work | Dedicated media worker pool. |
| Reconnect storms affect normal sends | Dedicated reconnect worker with strict per-instance ownership. |
| Projection lag affects status queries | Dedicated Projection Builder. |
| Retention cleanup competes with active work | Dedicated background maintenance worker. |

## Read Replica

Read replicas are candidates for:

- Instance list/status projections,
- webhook delivery history,
- metrics snapshots,
- retention-bound history,
- non-critical audit queries where access control is preserved.

Read replicas are not default for:

- command preconditions,
- active WorkerJob reservation,
- active provider ownership,
- current configuration activation,
- strong owner reads where stale state can cause invalid actions.

## Queue Scaling

Queue scaling rules:

- QueueProvider remains the abstraction.
- PostgreSQL WorkerJob is durable source for accepted work.
- Redis queue-support can scale independently but must reconcile with WorkerJob.
- Work type routing can be introduced without changing Application command meaning.
- Retry/backoff must avoid overwhelming providers or webhook receivers.

## Multi Region Future

Multi-region is out of MVP scope.

Future multi-region requires:

- Product decision,
- Architecture ADR,
- provider/session ownership model,
- data residency and consistency model,
- backup/restore revision,
- webhook delivery semantics review,
- multi-region observability and incident response.

Current design should not assume active-active operation.

## Multi Tenant Future

Multi Tenant is out of MVP scope.

Future Multi Tenant requires:

- Product decision,
- Domain identity model update,
- API authorization model update,
- tenant-aware storage partitioning or isolation,
- tenant-scoped backup/restore,
- tenant-aware observability and audit.

Current infrastructure must not expose tenant assumptions as product API.

## Scaling Triggers

| Trigger | Action |
|---|---|
| API P95 latency above SLO | Scale API or reduce sync work. |
| Text enqueue latency above target | Investigate API/Application/PostgreSQL path; scale API/PostgreSQL as needed. |
| Queue oldest pending age increasing | Scale Worker or isolate work type. |
| Webhook delivery SLO burn | Scale webhook workers, apply backoff, isolate receiver-caused failures. |
| Projection lag causes stale status | Scale Projection Builder or optimize projection refresh path. |
| PostgreSQL saturation | Add resources, tune access pattern, consider read replica or partition strategy. |
| Redis lock/queue contention | Scale Redis capacity or reduce lock contention. |
| Provider reconnect failures spike | Reduce concurrency, isolate provider runtime, mark action-required. |

## Scalability Constraints

- Scaling cannot create two active provider runtimes for one instance.
- Scaling cannot allow two workers to process the same outbound message lineage concurrently.
- Scaling cannot make Redis durable truth.
- Scaling cannot hide accepted work.
- Scaling cannot skip retention, redaction, or audit boundaries.
- Scaling cannot add Multi Tenant, analytics, campaign, group, or unsupported message capability.
