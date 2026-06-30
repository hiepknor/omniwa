# OmniWA Phase 5 Handoff

## Purpose

This document hands OmniWA from Phase 4 API Contract into Phase 5 - Persistence Design.

Phase 5 may design persistence strategy, repository-to-storage mapping, data ownership mapping, transaction persistence boundaries, retention persistence behavior, and recovery persistence requirements.

Phase 5 must not change frozen Product, Architecture, Domain, Application, or API decisions.

## Phase 5 Goal

Design persistence so OmniWA can reliably store, retrieve, recover, and query product state required by the frozen Domain, Application, and API contracts.

Phase 5 should answer:

- How approved aggregates map conceptually to durable storage.
- How repository ports map to persistence responsibilities.
- How query/read models support approved API queries.
- How idempotency, async visibility, audit, webhook retry, and recovery state are persisted.
- How retention and sensitive-data rules are enforced at storage boundaries.
- How persistence supports backup, recovery, and operational visibility without leaking implementation details into API or Domain.

## Required Reading

Before Phase 5 starts, read:

- `docs/FREEZE_PHASE_0.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/api/API_FREEZE.md`
- `docs/domain/AGGREGATES.md`
- `docs/domain/REPOSITORY_PORTS.md`
- `docs/domain/CONSISTENCY_BOUNDARIES.md`
- `docs/domain/IDENTITY_MODEL.md`
- `docs/domain/DOMAIN_INVARIANTS.md`
- `docs/domain/EVENT_CONTRACTS.md`
- `docs/application/TRANSACTION_STRATEGY.md`
- `docs/application/IDEMPOTENCY_STRATEGY.md`
- `docs/application/QUERY_CATALOG.md`
- `docs/api/RESOURCE_MODEL.md`
- `docs/api/PAGINATION_MODEL.md`
- `docs/api/FILTERING_AND_SORTING.md`
- `docs/api/ASYNC_OPERATION_MODEL.md`
- `docs/api/WEBHOOK_CONTRACT.md`

## Persistence Design Goals

| Goal | Description |
|---|---|
| Preserve aggregate ownership | Storage design must reflect approved aggregate and bounded context ownership. |
| Support repository ports | Persistence must implement repository needs without changing port semantics or leaking storage details. |
| Protect invariants | Persistence must support strong consistency where Domain/Application require it. |
| Preserve async visibility | Accepted work, WorkerJob lifecycle, retry, dead-letter, and action-required state must be durable and observable. |
| Support API query contracts | Read models must support approved status, history, metrics, pagination, filtering, and sorting contracts safely. |
| Enforce retention | Message, media, webhook, audit, session, and backup retention policies must be enforceable by design. |
| Protect sensitive data | Secret and Confidential data must be encrypted, redacted, excluded, or access-controlled according to classification. |
| Enable recovery | Backup and restore must preserve identity, idempotency, lifecycle, and retry/recovery state. |
| Avoid provider leakage | Provider-native payloads must not become product storage contract. |

## Repository Mapping Goals

Phase 5 must map approved repository ports to persistence responsibilities:

| Repository Port | Persistence Responsibility |
|---|---|
| InstanceRepositoryPort | Durable Instance lifecycle, metadata, readiness summary, action-required state. |
| SessionRepositoryPort | Secret-sensitive session lifecycle and safe session references without exposing session material. |
| MessageRepositoryPort | Message lifecycle, direction, supported type category, status, failure category, delivery history references. |
| MediaAssetRepositoryPort | Media metadata, processing lifecycle, retention state, diagnostic capture markers. |
| WebhookSubscriptionRepositoryPort | Subscription lifecycle, safe destination reference, activation/suspension/retirement state. |
| WebhookDeliveryRepositoryPort | Delivery lifecycle, attempt summary, retry, failure, dead-letter, and idempotency state. |
| GuardrailDecisionRepositoryPort | Guardrail evaluation outcome, throttle/block/action-required classifications. |
| ProviderProfileRepositoryPort | Provider compatibility/capability classification and safe failure language. |
| WorkerJobRepositoryPort | Queue-visible work lifecycle, reservation, retry, dead/dead-letter, owner context references. |
| AccessDecisionRepositoryPort | Access decision lifecycle, capability, expiry, privileged action marker, safe actor reference. |
| AuditRecordRepositoryPort | Secret-safe audit evidence, retention category, redaction marker. |
| HealthStatusRepositoryPort | Product/dependency health projection, stale/action-required markers. |
| ConfigurationSnapshotRepositoryPort | Validated/superseded/active configuration snapshot metadata and Secret references without values. |
| TelemetrySignalRepositoryPort | Sanitized telemetry projection state without raw Confidential values. |

## Storage Principles

- Storage is an Infrastructure concern implementing Domain/Application ports.
- Storage schema must not define Domain language; Domain language comes from frozen Domain docs.
- Storage IDs must not replace product IDs.
- API IDs remain opaque product identifiers, not database row IDs.
- Repository implementations must not become broad reporting/query services unless a query/read-model need is approved.
- Strong consistency is required where aggregate invariants and transaction boundaries require it.
- Eventual consistency is allowed for health, metrics, telemetry, and history projections where stale markers are supported.
- Persistence must support idempotency replay/conflict checks for duplicate-prone commands.
- Persistence must support correlation and request trace references without storing sensitive payloads.
- Persistence must make accepted async work recoverable after process crash.
- Persistence must preserve retention deletion/expiry markers where API needs safe visibility.

## Database Design Constraints

Phase 5 may design database concepts, but must not violate these constraints:

- Do not choose or require a concrete database technology before the phase explicitly evaluates options.
- Do not introduce Prisma, ORM, SQL, migrations, or schema files unless a later implementation phase asks for them.
- Do not expose database identifiers through API, webhook, Domain, or Application contracts.
- Do not use provider IDs, phone numbers, or JIDs as aggregate identity.
- Do not store raw message bodies by default.
- Do not store raw media binary by default after processing.
- Do not store raw provider payloads as product state.
- Do not store secrets in loggable or queryable fields.
- Do not allow persistence models to bypass Application transaction boundaries.
- Do not let read models mutate Domain state.
- Do not let analytics-style storage expand product scope.
- Do not let multi-tenant storage assumptions enter MVP unless a future product decision and ADR approve it.

## API-Driven Persistence Constraints

Persistence must support the frozen API contract:

| API Contract | Persistence Implication |
|---|---|
| Cursor pagination default | Read models/history must support stable opaque continuation without leaking database keys. |
| Safe filtering/sorting | Indexed/queryable fields must be safe product fields only. |
| Async accepted response | Owner state or WorkerJob state must be durable before accepted response. |
| Operation status polling | Status reads must be supported without mutation. |
| Error model | Persistence failures must be classifiable into safe Application/API error categories. |
| Idempotency-Key | Duplicate-prone commands require durable idempotency state or equivalent replay/conflict record. |
| Webhook delivery | Delivery identity, event identity, attempts, retry, and dead-letter state must be durable. |
| Retention markers | Expired data must not be resurrected by cursor/history reads. |
| Sensitive data restrictions | Query/read models must not expose Secret or raw Confidential data. |

## Things Persistence Must Not Break

Persistence must not break:

- Product MVP: Single Tenant + Multi Instance.
- MVP message types: text, image, video, document, audio only.
- API as an adapter over Application commands/queries.
- Application command/query boundary.
- Domain aggregate ownership and invariants.
- Repository port meaning.
- Application transaction strategy.
- Idempotency strategy.
- Async work visibility and recovery.
- Webhook asynchronous retry-visible delivery.
- Data classification and retention policies.
- Opaque public ID strategy.
- Cursor pagination opacity.
- Query side-effect freedom.
- Provider abstraction and Baileys isolation.
- Audit redaction and Secret-safe evidence rules.
- Guardrail enforcement before outbound message acceptance.

## Phase 5 Expected Deliverables

Phase 5 should produce persistence design documents such as:

- Persistence overview.
- Data ownership to persistence map.
- Repository mapping.
- Aggregate persistence boundaries.
- Transaction persistence strategy.
- Idempotency persistence strategy.
- Read model strategy.
- Retention and cleanup persistence strategy.
- Backup and recovery persistence strategy.
- Sensitive data persistence strategy.
- Persistence risks and constraints.

This handoff does not create those designs.

## Handoff Decision

Phase 4 API Contract is frozen.

**Project is ready for Phase 5 - Persistence Design.**
