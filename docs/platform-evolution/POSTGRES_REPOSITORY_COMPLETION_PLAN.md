# PostgreSQL Repository Completion Plan

## Purpose

This document is an execution guide for finishing the PostgreSQL persistence adapters. It is not a
new architecture decision: the repository boundaries, aggregate ownership, consistency models, and
forbidden-data rules are already frozen in `packages/infrastructure-persistence/src/repository-adapter-plan.ts`
and in `docs/persistence/`. This plan only sequences the remaining adapter implementation and closes
the correctness and data-durability gaps that exist today.

## Problem Statement

`InstanceRepositoryPort` and `WorkerJobRepositoryPort` were the first PostgreSQL adapters. The
repository completion work has now added the shared PostgreSQL aggregate base plus Message, Session,
WebhookSubscription, and WebhookDelivery adapters. The API and worker composition still run a
**hybrid** repository set under the `postgresql` profile until the remaining projection/guardrail
adapters are implemented and runtime wiring is switched over.

Reference: `apps/api/src/runtime-composition.ts` (`createRuntimeRepositories`, `postgresql` branch)
assigns `localProjectionRepositories = createInMemoryRepositorySet()` to `healthStatus`, `session`,
`message`, `chat`, `contact`, `group`, `guardrailDecision`, `webhookSubscription`, and
`webhookDelivery`.

Original consequences:

- Operators who select `OMNIWA_API_REPOSITORY_PROFILE=postgresql` believe they run a durable
  database, but 9 of the 11 wired repositories lose all data on restart.
- The worker composition (`apps/worker/src/runtime-composition.ts`, `createWorkerRuntimeRepositories`)
  shares the same limitation for session/message/guardrail/health state.

Current consequences after the completed increments:

- The webhook dispatcher can compose with PostgreSQL repositories.
- Message, Session, WebhookSubscription, and WebhookDelivery adapters exist and have contract
  coverage, but API/worker runtime composition has not yet switched all available adapters into the
  `postgresql` profile.
- Chat, Contact, Group, GuardrailDecision, and HealthStatus PostgreSQL adapters are still missing.

This plan finishes the remaining adapters, removes the hybrid fallback, and enables the existing
(currently skipped) real-PostgreSQL contract tests in CI.

## Implementation Status Snapshot

Status date: 2026-07-04.

| Area                                      | Status   | Evidence                                                                                                                                        |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared PostgreSQL aggregate base          | Complete | `PostgresqlAggregateRepository` extracted and Instance/WorkerJob refactored.                                                                    |
| Message adapter                           | Complete | `PostgresqlMessageRepository`, migration, idempotency side-channel, contract tests.                                                             |
| Session adapter                           | Complete | `PostgresqlSessionRepository`, migration, contract tests.                                                                                       |
| Webhook adapters                          | Complete | `PostgresqlWebhookSubscriptionRepository`, `PostgresqlWebhookDeliveryRepository`, migrations, signal/idempotency side-channels, contract tests. |
| Webhook dispatcher PostgreSQL composition | Complete | `OMNIWA_WEBHOOK_DISPATCHER_REPOSITORY_PROFILE=postgresql` now composes with PostgreSQL repositories.                                            |
| Read projection / guardrail adapters      | Partial  | Chat, Contact, and Group adapters are complete; GuardrailDecision and HealthStatus adapters remain.                                             |
| API/worker hybrid fallback removal        | Pending  | Runtime composition still needs to replace in-memory fallbacks with PostgreSQL adapters after remaining adapters land.                          |
| Real PostgreSQL CI service                | Pending  | Env-gated real PostgreSQL tests still require CI provisioning with `OMNIWA_POSTGRES_TEST_DATABASE_URL`.                                         |

## Scope

In scope — 9 repository adapters (the ports wired into the API/worker repository set):

| Port                                | Aggregate           | Consistency model         | Owner context    | Status   |
| ----------------------------------- | ------------------- | ------------------------- | ---------------- | -------- |
| `SessionRepositoryPort`             | Session             | `application_coordinated` | session          | Complete |
| `MessageRepositoryPort`             | Message             | `strong_owner`            | messaging        | Complete |
| `ChatRepositoryPort`                | Chat                | `eventual_projection`     | chat             | Complete |
| `ContactRepositoryPort`             | Contact             | `eventual_projection`     | contact          | Complete |
| `GroupRepositoryPort`               | Group               | `application_coordinated` | group            | Complete |
| `WebhookSubscriptionRepositoryPort` | WebhookSubscription | `strong_owner`            | webhook_delivery | Complete |
| `WebhookDeliveryRepositoryPort`     | WebhookDelivery     | `application_coordinated` | webhook_delivery | Complete |
| `GuardrailDecisionRepositoryPort`   | GuardrailDecision   | `strong_owner`            | guardrails       | Pending  |
| `HealthStatusRepositoryPort`        | HealthStatus        | `eventual_projection`     | health           | Pending  |

Consistency models are taken verbatim from `repositoryAdapterPlans` in `repository-adapter-plan.ts`.

Out of scope (not currently in the API/worker repository set; note for a later increment):
`MediaAsset`, `Label`, `ProviderProfile`, `AccessDecision`, `AuditRecord`, `ConfigurationSnapshot`,
`TelemetrySignal`. These 7 ports plus the 2 done + 9 here complete the 18-port catalog. See
[Follow-up work](#follow-up-work).

## Governing Constraints

These constraints are already established in the repository and must not be weakened.

1. **PostgreSQL is the only source-of-truth store** for repository adapters
   (`physicalDataModelReview.sourceOfTruthStore === "postgresql"`).
2. **Forbidden data must never be denormalized into columns.** `sharedForbiddenData` in
   `repository-adapter-plan.ts` forbids `provider_native_payload`, `session_secret_plaintext`,
   `raw_confidential_payload`, `raw_phone_or_jid`, `raw_message_body`, `raw_media_binary`. JID and
   subject references stored as index columns must be the redaction-safe references already present
   on the aggregate — never raw phone numbers, raw JIDs, or raw bodies.
3. **Allowed operations per adapter are fixed** by each port's `allowedOperations` list. Do not add
   query paths beyond the port interface.
4. **Read the schema-review docs before writing migrations**: `docs/persistence/INDEX_STRATEGY.md`,
   `QUERY_ACCESS_PATTERNS.md`, `REPOSITORY_MAPPING.md`, `AGGREGATE_PERSISTENCE.md`, and
   `PERSISTENCE_FREEZE.md`. Migrations must align with the frozen index strategy.
5. **Baileys / provider-specific code stays out of persistence.** No change to this boundary.

## Reference Implementation

The two existing adapters in `packages/infrastructure-persistence/src/postgresql-repositories.ts`
are the template. Each adapter is:

- One table `omniwa_<name>` with `id text PRIMARY KEY`, a small set of **denormalized, indexed
  columns** that back the port query methods, an `aggregate jsonb NOT NULL` column holding the full
  aggregate, and `updated_at timestamptz`.
- `load` / `save` (idempotent `INSERT ... ON CONFLICT (id) DO UPDATE`) / `exists`, plus one method
  per port query.
- A `decode<Aggregate>` function that rebuilds the aggregate from the jsonb column.
- An `ensureReady()` migration barrier (`createPostgresqlMigrationBarrier`).

Migrations are declared inline in `postgresqlRepositoryMigrations` and applied by
`runPostgresqlSqlMigrations` inside an explicit transaction with a `omniwa_schema_migrations` ledger.

## Known Correctness Hazard: Side-Channel Idempotency

`recordIdempotencyKey`, `recordSignalSelection`, `recordTargetContext`, and `recordSourceSignal` are
**not** declared on the repository port interfaces. Application code calls them via optional chaining,
for example `send-text-message.handler.ts:156`:

```
await this.messageRepository.recordIdempotencyKey?.(input.idempotencyKey, message.id);
```

If a PostgreSQL adapter omits the method, the call silently no-ops, `findByIdempotencyKey` never
returns a match, and **duplicate messages can be sent**. The existing `WorkerJob` adapter handles this
correctly with a dedicated `idempotency_key text NULL UNIQUE` column and a `recordIdempotencyKey`
method. The same pattern is mandatory for:

- `MessageRepository.recordIdempotencyKey` (message idempotency).
- `WebhookDeliveryRepository.recordIdempotencyKey` (delivery idempotency).
- `WebhookSubscriptionRepository.recordSignalSelection` (`signal_refs`) — implement for parity even
  though no production caller exists yet, so `findActiveForSignal` behaves like the durable-json
  adapter.

Every adapter that owns a side-channel column must ship a contract test asserting that
`find...` returns the saved aggregate after the record call.

## Per-Adapter Schema Mapping

Denormalized columns are derived from the query methods implemented by the durable-json reference
(`durable-json-repositories.ts`). Everything else lives in `aggregate jsonb`.

| Adapter             | Denormalized columns (indexed)                          | Query methods                                                       | Notes                                                                                                                                                              |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session             | `instance_id`, `status`, `requires_recovery boolean`    | `findByInstance`, `findByStatusForInstance`, `findRecoveryRequired` |                                                                                                                                                                    |
| Message             | `status`, `idempotency_key UNIQUE`                      | `findByStatus`, `findByIdempotencyKey`, `findRecoverableByOwner`    | `findRecoverableByOwner` returns `status IN ('queued','processing','failed')` only when owner context is `messaging`, else empty. Requires `recordIdempotencyKey`. |
| Chat                | `instance_id`, `status`, `jid`, `label_ids jsonb`       | `findByInstance`, `findByStatus`, `findByJid`, `findByLabel`        | `findByLabel` uses jsonb containment (`label_ids @> $1`) with a GIN index, unless `INDEX_STRATEGY.md` prescribes a join table.                                     |
| Contact             | `instance_id`, `status`, `jid`                          | `findByInstance`, `findByStatus`, `findByJid`                       |                                                                                                                                                                    |
| Group               | `instance_id`, `status`, `jid`                          | `findByInstance`, `findByStatus`, `findByJid`                       |                                                                                                                                                                    |
| WebhookSubscription | `status`, `signal_refs jsonb`                           | `findByStatus`, `findActiveForSignal`                               | `findActiveForSignal` = `status = 'active'` AND `signal_refs` contains ref. Requires `recordSignalSelection`.                                                      |
| WebhookDelivery     | `status`, `source_signal_ref`, `idempotency_key UNIQUE` | `findByStatus`, `findBySourceSignal`, `findByIdempotencyKey`        | Requires `recordIdempotencyKey`.                                                                                                                                   |
| GuardrailDecision   | `evaluated_intent_ref`                                  | `findByEvaluatedIntent`                                             |                                                                                                                                                                    |
| HealthStatus        | `subject_ref`, `category`                               | `findBySubject`, `findByCategory`                                   |                                                                                                                                                                    |

All `jid` / `source_signal_ref` / `subject_ref` values must be the safe references already carried on
the aggregate (see governing constraint 2).

## Design Decision: Decode Strategy

Two decode strategies exist in the codebase today:

- **Strategy A — factory reconstruct.** The existing Instance/WorkerJob adapters rebuild each field
  through domain factories (`createInstanceId`, `createRetryPolicy`, ...). This validates and re-brands
  on read, at a cost of roughly 40–90 lines of decode code per aggregate, including nested value
  objects (e.g. Group member roles, WebhookDelivery retry state).
- **Strategy B — trust jsonb.** The durable-json adapters `JSON.parse` the persisted blob, freeze it,
  and return it as the aggregate type. This is the already-shipped, already-tested behavior for the
  durable option, with almost no decode code, but no read-time validation.

**Recommendation.** Use Strategy A for the `strong_owner` / `application_coordinated` aggregates with
sensitive or nested value objects (`Message`, `WebhookDelivery`, `GuardrailDecision`, `Session`), and
Strategy B for the `eventual_projection` aggregates (`Chat`, `Contact`, `Group`, `HealthStatus`,
`WebhookSubscription`). This matches read-time rigor to the consistency model. If schedule pressure
dominates, Strategy B for all nine is acceptable because durable-json already relies on it. **This is
the one decision to confirm before implementation begins.**

## Structural Prerequisite: Extract a Shared Base

Unlike the durable-json adapters, which share `DurableJsonAggregateRepository`, the PostgreSQL
adapters have **no shared base class**; Instance and WorkerJob duplicate `ensureReady` and helper
logic. Implementing nine more adapters without a base would multiply that duplication.

Before adding adapters, extract `PostgresqlAggregateRepository<TAggregate, TId>` that provides:

- `load` / `save` / `exists` against a configured table name.
- An upsert builder taking the list of denormalized columns plus per-column value extractors.
- The `ensureReady` migration barrier.
- An injectable `decode` function.

Refactor Instance and WorkerJob onto the base and keep their tests green. This is a pure refactor with
no behavior change.

## Execution Increments

### Phase 0 — Foundation — Complete

1. Read the schema-review docs listed under Governing Constraints (4).
2. Extract `PostgresqlAggregateRepository` and refactor Instance/WorkerJob onto it. Tests stay green.

### Phase 1 — Send Pipeline — Complete

3. `PostgresqlMessageRepository` + `recordIdempotencyKey` + migration.
4. `PostgresqlSessionRepository` + migration.

### Phase 2 — Webhook Pipeline — Complete

5. `PostgresqlWebhookSubscriptionRepository` and `PostgresqlWebhookDeliveryRepository` + migrations.
6. Remove the `postgresql not supported` throw in `apps/webhook-dispatcher/src/runtime-composition.ts`
   and wire the PostgreSQL repository set.

### Phase 3 — Read Projections — Partial

7. `Chat`, `Contact`, `Group`, `HealthStatus`, `GuardrailDecision` adapters + migrations.
   `Chat`, `Contact`, and `Group` are complete. `HealthStatus` and `GuardrailDecision` remain.

### Phase 4 — Wiring and Hybrid Removal — Pending

8. In `apps/api/src/runtime-composition.ts` and `apps/worker/src/runtime-composition.ts`, replace the
   `localProjectionRepositories.*` (in-memory) assignments with the new PostgreSQL adapters. Delete the
   hybrid fallback entirely so the `postgresql` profile is fully durable.
9. Extend `PostgresqlRepositorySet`, `createPostgresqlRepositorySet`, and `postgresqlRepositoryMigrations`
   with the nine new adapters and migrations (ids following the `pgm_<date>_<seq>_<name>` convention).

### Phase 5 — Tests and CI — Partial

10. Add real-PostgreSQL contract tests per adapter, following `postgresql-repositories.spec.ts`
    (env-gated on `OMNIWA_POSTGRES_TEST_DATABASE_URL`). Each idempotency/signal side-channel gets an
    explicit round-trip assertion.
11. Provision a PostgreSQL service and set `OMNIWA_POSTGRES_TEST_DATABASE_URL` in CI so the contract
    tests actually run. This closes the current gap where the whole suite passes in ~3s because all
    real-PostgreSQL tests skip.

Completed adapters now have repository contract coverage across in-memory, durable-json, and
PostgreSQL implementations. The remaining Phase 5 work is to extend those tests to Phase 3 adapters
and provision the CI PostgreSQL service so env-gated tests run continuously rather than skipping.

## Completed Work Log

| Commit    | Increment | Result                                                                                                                 |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `3730a5a` | Phase 0   | Extracted shared PostgreSQL aggregate repository base.                                                                 |
| `8fc1b29` | Phase 1   | Added PostgreSQL Message repository, migration, and idempotency contract coverage.                                     |
| `d6b9d94` | Phase 1   | Added PostgreSQL Session repository, migration, and contract coverage.                                                 |
| `a8b4b1c` | Phase 2   | Added PostgreSQL WebhookSubscription and WebhookDelivery repositories, migrations, and side-channel contract coverage. |
| `579b608` | Phase 2   | Enabled webhook dispatcher PostgreSQL repository composition.                                                          |

## Definition of Done

| DoD item                                                                                                                     | Status                         | Notes                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| All nine adapters implement their full port interface plus required side-channel methods.                                    | Partial                        | Message, Session, Chat, Contact, Group, WebhookSubscription, and WebhookDelivery are complete; GuardrailDecision and HealthStatus remain. |
| The `postgresql` profile in API and worker exposes zero in-memory repositories; no aggregate is lost on restart.             | Pending                        | Requires Phase 3 adapters and Phase 4 wiring.                                                                                             |
| The webhook dispatcher runs under the `postgresql` profile.                                                                  | Complete                       | Composition now accepts PostgreSQL and uses the PostgreSQL repository set.                                                                |
| Real-PostgreSQL contract tests run in CI and pass, including idempotency round-trips.                                        | Pending                        | Tests are env-gated; CI PostgreSQL service still required.                                                                                |
| `pnpm check` passes, including `arch:check`, `openapi:*`, `client-contract:check`, `sdk:*`, and regression/production gates. | Complete for current increment | Last checked after Phase 2 completion: 108 test files, 598 passed, 1 skipped.                                                             |
| No forbidden data is stored in any denormalized column.                                                                      | Complete for current adapters  | Current denormalized columns use safe refs/status/idempotency metadata only.                                                              |

## Risks and Watch-Items

- **Silent idempotency no-op** (highest): a missing side-channel method compiles and passes shallow
  tests. Mitigated by the mandatory round-trip contract tests.
- **`Chat.findByLabel`** requires a jsonb containment strategy and index choice that must match
  `INDEX_STRATEGY.md`.
- **Migration governance**: `createPostgresqlAdapterFoundation()` reports `blocked_by_schema_review`
  while `physicalDataModelReview.schemaCreationAllowed === false`. The two shipped adapters already
  declare migrations inline, setting precedent. Follow that precedent, or update
  `physicalDataModelReview` first if the team wants the gate enforced.
- **Consistency-model drift**: projection adapters (`Chat`, `Contact`, `Health`) are
  `eventual_projection` and may later be rebuilt from events rather than treated as source of truth.
  Keep their write paths free of business invariants so a future projection rebuild remains possible.

## Follow-up Work

After the nine adapters land, the remaining seven ports (`MediaAsset`, `Label`, `ProviderProfile`,
`AccessDecision`, `AuditRecord`, `ConfigurationSnapshot`, `TelemetrySignal`) complete the 18-port
catalog defined in `repositoryPortNames`. Note that `authorization-audit-service.ts` calls
`recordTargetContext` and `recordSourceSignal` **without** optional chaining, so the `AccessDecision`
and `AuditRecord` PostgreSQL adapters must implement those methods before the audit service can run on
PostgreSQL. Durable message queueing (currently in-memory only) is tracked separately from this plan.
