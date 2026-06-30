# Persistence Context Summary

## Persistence Role

Persistence stores state. It does not decide business behavior, publish Domain Events, validate business invariants, orchestrate workflows, or expose API contracts.

Repository implementations belong to Infrastructure. Repository ports preserve Domain semantics.

## Storage Responsibilities

Approved responsibilities:

- PostgreSQL is the MVP durable source of truth.
- Redis is ephemeral for cache, coordination, lock, TTL, and queue support only.
- Object Storage is for artifacts such as media and encrypted backup artifacts only.
- Read projections are derived and must not become source of truth.
- Future analytics storage is deferred and must not be introduced through operational queries.

## Repository Mapping

Repositories persist aggregate roots according to aggregate boundaries. They must not become broad reporting, search, campaign, analytics, or provider payload APIs.

Repository mappings trace from aggregate -> repository port -> persistence unit -> storage owner -> physical storage.

## Read Models and Projections

Read projections may support instance status, message history, webhook delivery history, media metadata, operational dashboard, health status, queue metrics, and audit views.

Projection rules:

- Projection does not mutate aggregates.
- Projection does not contain business rules.
- Projection failures are observable.
- Projection reads must respect retention and redaction.
- Projection corruption is an operational incident, not a reason to silently repair during user reads.

## Data Safety

Secret and raw Confidential data must not be logged, cached, projected, traced, exposed, archived in plaintext, or placed in object paths.

Recovery must not resurrect expired data. Redis failure must not lose accepted work. Object Storage must not contain business metadata.

## Escalation

Stop if a task requires:

- a new durable storage responsibility,
- changing source-of-truth ownership,
- direct API access to storage,
- repository port expansion for reporting,
- storing provider-native payloads as product state,
- changing retention, backup, RPO, or RTO.

