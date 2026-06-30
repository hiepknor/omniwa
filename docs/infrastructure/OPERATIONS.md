# Operations

## Purpose

This document defines OmniWA Phase 6 operational design.

It covers startup, shutdown, rolling restart, recovery, backup, restore, incident response, maintenance windows, upgrade strategy, and rollback strategy without creating scripts, manifests, CI/CD pipelines, or configuration.

## Startup

| Step | Requirement |
|---|---|
| Configuration load | Load environment-scoped configuration through ConfigurationProvider boundary. |
| Secret validation | Validate required Secret references without logging values. |
| Persistence readiness | PostgreSQL must be reachable before accepting product work. |
| Redis readiness | Required for lock/queue/cache paths; if unavailable, affected runtimes fail closed or degraded. |
| Object Storage readiness | Required before media/artifact/backup workflows that need it. |
| Projection readiness | Stale projections may be served only with freshness markers. |
| Provider readiness | Provider Runtime starts after Instance/Session/ProviderProfile state and ownership guard are available. |
| API readiness | API accepts traffic only when auth, Application, and durable state boundaries are ready. |

## Shutdown

| Runtime | Shutdown Rule |
|---|---|
| API | Stop accepting new traffic, finish in-flight requests, return unavailable for new work during drain. |
| Worker | Stop reserving work, finish or release reserved work safely, update WorkerJob state. |
| Scheduler | Stop scheduling new work, release single-active scheduler ownership. |
| Provider | Stop new provider operations, release/expire provider ownership, classify unsafe disconnection where needed. |
| Webhook Dispatcher | Finish current attempt or mark retry/unknown safely. |
| Projection Builder | Stop at checkpoint, leave freshness/stale markers. |
| Observability | Flush sanitized logs/metrics/traces where possible. |

## Rolling Restart

Rolling restart is allowed when:

- API replicas can drain independently,
- Worker reservations have timeout/release behavior,
- provider ownership prevents duplicate active provider runtime per instance,
- scheduler has single-active ownership,
- Redis locks use bounded TTL and durable verification,
- PostgreSQL remains available,
- health checks and alerts watch error/latency/queue impact.

Rolling restart must not:

- create invisible accepted work,
- run duplicate reconnect for one instance,
- run duplicate provider connection for one instance,
- drop webhook delivery attempts,
- skip retention cleanup markers.

## Recovery

Operational recovery categories:

| Category | Recovery Pattern |
|---|---|
| API process failure | Restart API, validate readiness, monitor request error rate. |
| Worker process failure | Restart Worker, reconcile WorkerJob reservations, retry or mark action-required where needed. |
| Scheduler failure | Restart Scheduler, ensure single-active ownership, scan missed schedules idempotently. |
| Provider runtime failure | Re-establish ownership, classify affected instances, reconnect where eligible. |
| Webhook dispatcher failure | Resume WebhookDelivery pending/retrying state and avoid duplicate delivered transitions. |
| Projection failure | Mark projection stale, rebuild from retained source state. |
| PostgreSQL failure | Follow disaster recovery procedure. |
| Redis failure | Rebuild cache/queue-support hints from PostgreSQL; fail closed where lock certainty is required. |
| Object Storage failure | Pause artifact workflows, mark affected operations degraded/action-required. |

## Backup

Backup operations must:

- create encrypted recoverable-state backup at least every 24 hours,
- include PostgreSQL durable state,
- include approved Object Storage artifacts when they are recoverable state,
- produce backup manifest,
- retain artifacts for 14 days,
- exclude Redis as source-of-truth backup,
- avoid logging Secret or raw Confidential data.

## Restore

Restore operations must:

1. Select latest valid encrypted backup.
2. Restore PostgreSQL durable state.
3. Restore approved Object Storage artifacts.
4. Rebuild Redis ephemeral state.
5. Validate instance inventory and identity continuity.
6. Validate session availability and mark re-pair/action-required where needed.
7. Validate WorkerJob, retry, dead-letter, idempotency, and webhook delivery state.
8. Rebuild or mark projections stale.
9. Record recovery outcome in audit.

## Incident Response

| Incident Type | Response |
|---|---|
| P1 service unavailable | Page operator, freeze changes, identify dependency, restore service within 4-hour RTO target. |
| Data loss risk | Stop destructive operations, validate backup, preserve audit evidence, identify RPO exposure. |
| Secret exposure | Revoke/rotate affected secrets, audit access, invalidate sessions if required, produce incident record. |
| Queue backlog | Apply backpressure, scale Worker, isolate work type, check Redis/PostgreSQL/provider health. |
| Provider instability | Mark affected instances degraded/action-required, avoid aggressive reconnect, preserve user-visible status. |
| Webhook failure spike | Distinguish receiver failures from OmniWA transport failures, apply retry/backoff, monitor dead-letter growth. |
| Backup failure | Treat as production readiness incident; restore backup coverage before risky changes. |

## Maintenance Window

Maintenance windows are required for:

- database maintenance,
- backup/restore drills,
- secret rotation requiring runtime restart,
- provider adapter upgrade,
- Baileys upgrade validation,
- major observability/security changes,
- changes that affect Worker/Provider ownership.

Maintenance communication should include expected impact, rollback plan, health checks, and verification steps.

## Upgrade Strategy

| Upgrade Type | Strategy |
|---|---|
| Application/runtime upgrade | Rolling restart when compatible; otherwise maintenance window. |
| Provider/Baileys upgrade | Staged validation, provider capability refresh, reconnect monitoring, rollback path. |
| PostgreSQL minor maintenance | Backup before change, readiness checks, restore plan. |
| Redis maintenance | Ensure PostgreSQL durable state safe; expect cache/lock/queue-support rebuild. |
| Object Storage change | Validate artifact access, backup artifacts, cleanup behavior. |
| Secret provider change | Validate secret access and rotation without exposing values. |

## Rollback Strategy

Rollback is required when:

- API error rate exceeds rollback threshold,
- queue backlog grows unexpectedly,
- provider reconnect failure spikes,
- data safety/redaction uncertainty is detected,
- backup/restore validation fails,
- Secret handling becomes uncertain.

Rollback rules:

- Do not roll back by deleting accepted work.
- Preserve WorkerJob and owner lifecycle state.
- Preserve audit and recovery evidence.
- Do not resurrect expired data.
- Roll back runtime version before changing persistence state unless the failure is persistence-specific and reviewed.

## Operational Constraints

- API does not depend on Worker runtime for basic request handling and read of visible state.
- Worker must operate independently of API.
- One instance has only one active provider runtime owner.
- Runtime must not break Architecture Freeze.
- Infrastructure contains no business logic.
- Runtime does not access Domain directly outside Application Layer.
- Provider runtime state is not durable product truth.
- Redis loss must not lose accepted product work.
- Backup restore must be validated before production readiness is claimed.
