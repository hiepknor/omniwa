# Infrastructure Context Summary

## Runtime Platform

Approved runtime roles:

- API Runtime.
- Worker Runtime.
- Scheduler.
- Provider Runtime.
- Webhook Dispatcher.
- Projection Builder.
- Background Jobs.
- Metrics Exporter.
- Health Runtime.

Runtimes are operational roles, not permission to bypass architecture. Runtime composition must still route product behavior through Application and approved ports.

## Infrastructure Components

Approved infrastructure areas include API runtime, PostgreSQL, Redis, Object Storage, Reverse Proxy, Metrics, Logging, Backup, Secret Provider, and Observability systems.

Technology decisions are documented in infrastructure design. Concrete implementation files are deferred until requested in implementation.

## Security Runtime

Security priorities:

- Secret management.
- Key rotation.
- API key and admin key handling.
- Session protection.
- Data encryption boundary.
- Runtime isolation.
- Least privilege.
- Audit logging.

Secret/raw Confidential data must never appear in logs, metrics, traces, alerts, object paths, cache keys, public responses, or normal audit payloads.

## Operations

Operations cover startup, shutdown, rolling restart, recovery, backup, restore, incident response, maintenance windows, upgrade strategy, rollback strategy, and Baileys upgrade policy.

Normal PR checks must not require real WhatsApp accounts or real provider credentials.

## Scalability

MVP can start single-node, but design must allow future worker scaling, read replicas, queue scaling, multi-node, cluster worker, future Multi Tenant, and future multi-region decisions without breaking frozen boundaries.

Redis remains ephemeral. PostgreSQL remains durable source of truth. Object Storage remains artifact-only.

## Escalation

Stop if a task requires:

- changing runtime roles,
- exposing internal data services publicly,
- new secret or backup posture,
- new deployment topology,
- new queue/cache/runtime framework,
- making provider runtime own product policy,
- weakening observability redaction.

