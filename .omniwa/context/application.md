# Application Context Summary

## Application Responsibility

Application orchestrates product use cases. It coordinates commands, queries, workflows, transaction timing, idempotency, authorization decisions, event publication timing, and port usage.

Application does not own aggregate invariants, provider integration details, database schemas, HTTP contracts, queue engine behavior, or business policy.

## Use Case Model

Use cases are grouped around Instance, Messaging, Media, Webhook, Provider, Monitoring, and Administration.

Examples include creating and connecting instances, QR authentication, reconnect, send message, retry message, receive message, register webhook, deliver webhook, process media, refresh provider capability, and query operational status.

Every implementation task should map to a frozen use case, workflow, command, or query.

## Command and Query Boundary

Commands change state. Queries read state.

Rules:

- Commands must go through Application services/workflows.
- Queries must not mutate Domain, projections, queue, provider state, audit evidence, or runtime state.
- Commands must not become read optimization mechanisms.
- Queries must not call provider, queue engine, storage adapter, or webhook transport to refresh state.
- Query results must not expose Secret/raw Confidential data.

## Workflow Rules

Application workflows coordinate steps, dependencies, retries, compensation, and failure visibility. They do not redefine business rules.

Long-running workflows include QR login, reconnect, message retry, webhook retry, media processing, and recovery paths.

Accepted async work must be durable and visible before returning accepted/queued outcomes.

## Application Services

Approved service areas include Instance, Messaging, Media, Webhook, Provider, Operations, and Administration application services.

Services depend on Domain, ports, Clock, UUID, EventBus, QueueProvider, SecretProvider, and related abstractions. They do not depend on concrete adapters.

## Escalation

Stop if a task requires:

- a new use case,
- a new command/query,
- a changed workflow state,
- a different idempotency or transaction boundary,
- Application calling concrete Infrastructure,
- Query mutation or provider refresh.

