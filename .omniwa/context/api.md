# API Context Summary

## API Role

The API is an Interface adapter over Application commands and queries. It serves API clients, developers, operators, webhook configuration flows, health checks, and monitoring access according to frozen API boundaries.

API does not call Domain, Provider, Baileys, database, queue, Redis, Object Storage, or Infrastructure directly for product behavior.

## API Surface

Primary resource areas:

- Instance.
- Session.
- QR.
- Message.
- Media.
- Webhook.
- Delivery.
- Provider.
- Health.
- Metrics.

Resource and endpoint groups must trace to Product Scope, Application use cases, commands/queries, and Domain contexts.

## Versioning and Auth

The approved strategy is URL major versioning for MVP. API keys and admin keys are the MVP authentication model, with future OAuth deferred.

Authorization is operation-level and instance-aware. Domain must not know API keys, admin keys, scopes, or HTTP concepts.

## Request and Response Model

The contract model defines command requests, query requests, async requests, admin requests, success responses, resource responses, collection responses, async accepted responses, operation status, metadata, and trace metadata.

No implementation should expose raw exceptions, provider payloads, session secrets, webhook secrets, API/admin key secrets, raw phone/JID, raw message body, media binary, or raw Confidential payloads.

## Async and Webhook Contract

API must not block on external provider final completion. Send message, media upload, webhook retry, reconnect, and long-running operations use async operation semantics where needed.

Webhook delivery is outbound integration behavior. It is not an inbound public API. Webhook delivery must be async, signed/verifiable, versioned, correlated, and retry-visible.

## Escalation

Stop if a task requires:

- a public contract change,
- a new endpoint group or resource,
- a changed versioning strategy,
- a new auth/authz model,
- exposing new data categories,
- synchronous provider delivery semantics.

