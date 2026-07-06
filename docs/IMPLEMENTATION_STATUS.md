# OmniWA Implementation Status

This document is the single source of truth for current implementation progress. It is not a design
freeze document and it does not change frozen product, architecture, domain, application, API,
persistence, infrastructure, or engineering decisions.

Every progress update must be recorded here instead of being scattered across unrelated documents.

## Last Verified

- Date: 2026-07-06
- Branch: `main`
- Evidence basis: source file counts, recent git history, runtime composition files, provider/queue
  adapters, PostgreSQL repository code, local `pnpm check`, and CI workflow status.

## Current Platform Increment

| Increment                             | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Next                          |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| N11 - Production Hardening            | Active | N11 starts after N8/N9/N10 are complete. N11.0 reconciled the backlog, N11.1 added durable WorkerJob queue foundation, N11.2 confirmed durable EventLog replay, N11.3 added provider runtime ownership hardening, N11.4 added hashed/lifecycle/SecretProvider-backed API-key runtime configuration, API process SecretProvider wiring, encrypted durable Baileys auth-state support, admin API-key lifecycle routes, N11.5 added Redis-backed API rate limiting, durable security audit evidence, repository-backed ownership resolution, and fail-closed targetless global resources for instance-scoped credentials, N11.6 completed the current webhook reliability scope by promoting controlled webhook delivery retry, single-delivery redrive, selected bulk redrive, dead-letter filtered operator listing with safe remediation reason/category filters, persisted `WebhookDelivery` dispatch outcomes, durable worker-job webhook queue profile, fail-closed webhook dispatcher production profile validation, JSONL metric/audit observability wiring, and a production-profile webhook dispatcher validation path in `pnpm test:postgres`, and N11.7 now has explicit `observability:check`, `security:check`, `e2e:check`, `recovery:check`, and `performance:check` gates plus an API runtime `OMNIWA_API_QUEUE_PROFILE=durable-worker-job` production guard, PostgreSQL API EventLog selection, EventLog outbox backlog metrics, a background outbox runtime loop foundation wired into the production compose template with JSONL publisher/metrics paths, shared outbound intent storage for cross-runtime message dispatch, and Provider Runtime production bridge composition guardrails for observability/dependency evidence, security controls, deterministic vertical path, backup/restore drill, recovery validation, durable API enqueue semantics, and load baseline evidence. | N11.7 - Production Validation |
| N10 - Controlled Group Mutations      | Done   | Local `pnpm check` passed after enabling metadata/local-state/add/remove/promote/demote group mutations with safe intent storage, group capability checks, audit action evidence, client-contract fixtures, and Rust SDK fixture coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | N11 - Production Hardening    |
| N9 - Controlled Message Mutations     | Done   | Local `pnpm check` passed after enabling controlled text send, retry, and cancel handlers, client-contract fixtures, checker allowlist, TUI integration docs, and Rust SDK retry/cancel fixture coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Completed predecessor for N10 |
| N8 - PostgreSQL Repository Completion | Done   | Local `pnpm test:postgres` passed against `127.0.0.1:55432`; GitHub Actions Quality Gate run `28701511362` passed with real PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Completed predecessor for N9  |

## Verification Snapshot

The counts below use two views:

- **Runtime source:** `.ts` files excluding `.spec.ts`, `.test.ts`, and `.d.ts`.
- **Implementation survey:** `.ts` files excluding `.test.ts`; this includes `.spec.ts` contract and
  runtime tests because several implementation packages keep executable evidence in specs.

| Area                                           | Runtime source | Implementation survey |
| ---------------------------------------------- | -------------- | --------------------- |
| `packages/domain/src`                          | 71             | 90                    |
| `packages/application/src`                     | 36             | 48                    |
| `packages/infrastructure-persistence/src`      | 15             | 25                    |
| `packages/infrastructure-provider-bridge/src`  | 3              | 5                     |
| `packages/infrastructure-provider-baileys/src` | 5              | 9                     |
| `packages/infrastructure-queue/src`            | 3              | 5                     |
| `packages/interface-api/src`                   | 2              | 3                     |
| `apps/api/src`                                 | 10             | 20                    |
| `apps/worker/src`                              | 6              | 11                    |
| `apps/webhook-dispatcher/src`                  | 4              | 7                     |
| `apps/provider-runtime/src`                    | 13             | 25                    |

Verification commands used:

```sh
for d in packages/domain/src packages/application/src packages/infrastructure-persistence/src packages/infrastructure-provider-bridge/src packages/infrastructure-provider-baileys/src packages/infrastructure-queue/src packages/interface-api/src apps/api/src apps/worker/src apps/webhook-dispatcher/src apps/provider-runtime/src; do
  printf '%-48s ' "$d"
  find "$d" -type f -name '*.ts' ! -name '*.spec.ts' ! -name '*.test.ts' ! -name '*.d.ts' | wc -l | tr -d ' '
done

for d in packages/domain/src packages/application/src packages/infrastructure-persistence/src packages/infrastructure-provider-bridge/src packages/infrastructure-provider-baileys/src packages/infrastructure-queue/src packages/interface-api/src apps/api/src apps/worker/src apps/webhook-dispatcher/src apps/provider-runtime/src; do
  printf '%-48s ' "$d"
  find "$d" -type f -name '*.ts' | rg -v '\.test\.' | wc -l | tr -d ' '
done
```

## Design vs Implementation Status

| Area                                                                                             | Design status               | Implementation status                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Known gaps                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product / Architecture / Domain / Application / API / Persistence / Infrastructure / Engineering | Frozen                      | Baseline constraints remain active                                                                                           | Freeze documents under `docs/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Do not edit freeze docs for implementation convenience.                                                                                                                           |
| Domain                                                                                           | Frozen                      | Substantial implementation present                                                                                           | 71 runtime source files; aggregates, value objects, events, policies, repository ports, queue/job concepts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Further behavior must remain inside approved domain boundaries; production readiness is not implied.                                                                              |
| Application                                                                                      | Frozen                      | Substantial implementation present                                                                                           | 34 runtime source files; dispatcher, command/query handling, send/retry/cancel text workflows, guardrail flow, event publishing, active session and outbound intent resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Production hardening remains incremental work.                                                                                                                                    |
| API / Interface                                                                                  | Frozen                      | Public platform API implemented for core read surfaces, selected commands, and admin API-key lifecycle operations            | `apps/api/src`, `packages/interface-api/src`, OpenAPI checks, client contract checks, API process composition that can read API key material through `EnvSecretProvider` when `OMNIWA_API_KEY_SECRET_NAME` is configured, admin `/v1/api-keys` lifecycle routes, env-configured in-memory or Redis-backed API rate limiting, opt-in in-memory or durable JSON security-audit capture, opt-in domain `AuditRecord` security-audit persistence, opt-in repository-backed ownership resolution for instance-scoped resources, and fail-closed targetless global-resource authorization for instance-scoped credentials.                                                                                                                                                                                                                                                                                      | Broad mutation surface, permission/capability UX, full ownership resolver coverage for future instance-owned resources, and production-hardening details remain incremental work. |
| Persistence                                                                                      | Frozen                      | Partial production path implemented                                                                                          | Durable JSON adapters plus PostgreSQL repository set for Instance, WorkerJob, Message, Session, MediaAsset, Label, WebhookSubscription, WebhookDelivery, Chat, Contact, Group, GuardrailDecision, AuditRecord, and HealthStatus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | PostgreSQL does not yet cover all catalog ports; ProviderProfile, AccessDecision, ConfigurationSnapshot, and TelemetrySignal remain follow-up work.                               |
| Queue / Jobs                                                                                     | Frozen                      | Durable queue foundation present                                                                                             | `InMemoryQueueProvider`, `DurableWorkerJobQueueProvider`, PostgreSQL-backed `WorkerJobRepositoryPort` source state, PostgreSQL atomic reservation with `FOR UPDATE SKIP LOCKED`, durable retry visibility, and expired lease recovery covered by local `pnpm test:postgres`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Oldest-pending-age metrics and final production queue validation remain follow-up hardening work.                                                                                 |
| Provider / Baileys                                                                               | Frozen                      | Real Baileys provider exists and is isolated                                                                                 | `RealBaileysSocketProvider` imports `makeWASocket` only inside `packages/infrastructure-provider-baileys`; provider runtime composes durable local and PostgreSQL ownership lease guards with active lease renewal, optional encrypted durable Baileys auth-state storage, production-profile guardrails, and command bridge wiring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Target-environment live-network regression automation remains follow-up work.                                                                                                     |
| Runtime apps                                                                                     | Frozen                      | API, worker, webhook dispatcher, provider runtime, background, scheduler, health, metrics, and projection-builder apps exist | `apps/*/src`, runtime composition tests, provider-runtime command receiver tests, worker provider-runtime bridge mode tests, `@omniwa/infrastructure-provider-bridge` bridge contract/fake tests, and a production Docker template that includes API, worker, webhook dispatcher, provider runtime, background, PostgreSQL, and Redis services.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Target-environment orchestration evidence is not complete.                                                                                                                        |
| Webhooks / Events / Realtime                                                                     | Frozen                      | Durable EventLog/replay and webhook dispatcher reliability foundations present                                               | Webhook dispatcher runtime, durable JSON EventLog/outbox, generic EventOutboxConsumer foundation, PostgreSQL EventLog backend, background outbox runtime loop foundation with scheduled backlog metric recording, JSONL outbox publication evidence, production compose background service validation, SSE read surfaces, restart replay tests, safe provider signal ingestion, retry/dead-letter tests, persisted `WebhookDelivery` status updates for delivered/retrying/dead-letter dispatch outcomes, controlled retry, single-delivery redrive, selected bulk redrive operations, dead-letter filtered operator list contract with safe remediation reason/category filters, durable worker-job webhook queue profile, HMAC/timestamp signing, replay verification, `FetchWebhookHttpGateway` timeout/network failure mapping, and opt-in local dispatcher runtime fetch gateway wiring through env. | Production scaling, target-environment proof, dashboards, and alerting need further hardening.                                                                                    |
| PostgreSQL migrations                                                                            | Frozen                      | Explicit operational migration path present                                                                                  | Versioned `omniwa_schema_migrations` ledger, `runPostgresqlSqlMigrations`, `getPostgresqlSqlMigrationStatus`, and root `pnpm db:migrate:status` / `pnpm db:migrate` commands using `OMNIWA_POSTGRES_DATABASE_URL` with credential-redacted output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Production deployment still needs target-environment migration evidence and backup/rollback procedure validation.                                                                 |
| SDK / Client contract                                                                            | Active implementation track | Rust SDK foundation and client contract checks present                                                                       | `sdks/rust/omniwa-sdk`, `tooling/sdk`, `docs/api/client-contract`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | SDK must stay generated/checked as public API evolves.                                                                                                                            |
| CI / Quality gates                                                                               | Active implementation track | GitHub Actions quality gate passing                                                                                          | `.github/workflows/quality-gate.yml`; run `28701511362` passed PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | CI success does not by itself mean production readiness.                                                                                                                          |

## Recent Implementation Evidence

Recent history confirms the repository is no longer a bootstrap-only skeleton:

- `ee96d0f` added the local-live embedded API and real send pipeline.
- `85fd094` closed the VS02 local live demo documentation.
- `3730a5a` through `19a4f71` added and wired PostgreSQL repository coverage.
- `6efbf4e`, `49fecfa`, and `338ba1b` added and fixed the GitHub Actions quality gate with real
  PostgreSQL repository contract tests.
- `28701511362` is the first post-normalization GitHub Actions Quality Gate run that passed
  PostgreSQL contract tests and the full repository quality gate after the documentation cleanup
  commits were pushed.
- N9 controlled message mutations were verified locally with `pnpm check`, covering send/retry/cancel
  handlers, public client contract fixtures, OpenAPI compatibility, Rust SDK checks, and release gates.
- N10 controlled group mutations were verified locally with `pnpm check`, covering
  metadata/local-state/member actions, capability checks, audit actor requirements, client contract
  fixtures, OpenAPI compatibility, Rust SDK checks, and release gates.
- N11.7 PostgreSQL CI hardening now runs `pnpm test:postgres` with Vitest file parallelism disabled,
  so repository contract truncation cannot race the webhook dispatcher PostgreSQL runtime proof in
  the shared CI database.
- N11.7 CI also scopes `OMNIWA_POSTGRES_TEST_DATABASE_URL` to the dedicated `pnpm test:postgres`
  step only. The generic `pnpm check` step no longer re-runs PostgreSQL contract specs in parallel
  against the same service database after the sequential contract gate has passed.
- N11 queue hardening now has local PostgreSQL proof for single-reservation concurrency and durable
  retry visibility across queue-provider restarts, plus expired lease recovery, with
  `OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa pnpm test:postgres`
  passing 41 tests.
- N11 PostgreSQL migration hardening now exposes explicit `pnpm db:migrate:status` and
  `pnpm db:migrate` operator commands backed by the versioned migration ledger. The CLI reads
  `OMNIWA_POSTGRES_DATABASE_URL` and redacts credentials from command output.
- N11 production compose hardening now expands `deploy/docker/compose.production.yml` beyond the API
  service to include API, worker, webhook dispatcher, provider runtime, PostgreSQL, and Redis. The
  template uses hashed API-key input, Redis API rate limiting, PostgreSQL repositories, durable
  WorkerJob queue profiles where available, webhook dispatcher production composition, Worker
  production profile validation, shared outbound intent storage, and Provider Runtime production
  profile validation guarded by encrypted auth state, PostgreSQL ownership, explicit owner identity,
  and command bridge authentication.
- N11 production compose validation now has a dedicated `pnpm docker:production:check` gate wired
  into `pnpm production:check` and the root `pnpm check` path. The gate renders the checked-in
  production compose template with `deploy/docker/env/production.env.example` and verifies required
  services, hash-only API-key posture, Redis API rate limiting, disabled auto-migration, the
  PostgreSQL API EventLog backend, shared outbound intent storage, Worker production bridge wiring,
  and Provider Runtime production profile wiring without printing rendered secret material.
- N11 Worker production profile validation now fails closed unless Worker uses PostgreSQL
  repositories, the durable WorkerJob queue profile, `provider-runtime-bridge` mode with endpoint
  and token configuration, a durable `OMNIWA_EVENT_LOG_PATH`, and
  `OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH`.
- N11 EventLog/outbox hardening now adds a generic `EventOutboxConsumer` foundation that drains
  pending outbox records through an injected publisher, marks successful records as published, keeps
  failed records pending, and returns safe failure summaries without raw provider payload exposure.
- N11 EventLog production-backend migration has started after `ADR-0009` was accepted. Application
  now exposes async EventLog/outbox port types, and infrastructure provides a sync-to-async
  compatibility adapter so existing in-memory and durable JSON stores can keep local/dev behavior
  while PostgreSQL EventLog work proceeds behind the new async boundary.
- The generic `EventOutboxConsumer` can now drain through either the existing synchronous outbox port
  or the new async outbox port, so future PostgreSQL EventLog/outbox stores can plug into the same
  consumer without a second drain loop.
- The PostgreSQL EventLog backend foundation now exists behind `AsyncEventLogPort`, with versioned
  SQL migrations for `omniwa_event_log` and `omniwa_event_outbox`. Local
  `pnpm test:postgres` with
  `OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa`
  passed 48 tests covering PostgreSQL EventLog append idempotency, monotonic cursor replay,
  not-found/expired cursor semantics, durable outbox state, generic outbox consumer drain, and safe
  failure summaries.
- API runtime composition can now select `OMNIWA_EVENT_LOG_BACKEND=postgresql` and wire
  `PostgresqlEventLogStore` into Application event publication, `GET /v1/events`, and
  `/v1/events/stream`. The production API profile now fails closed unless that PostgreSQL EventLog
  backend is configured, and the production Docker template/check now declares and verifies that
  backend.
- EventLog outbox backlog metrics now have an approved catalog entry and infrastructure
  observability helper that can record pending/published outbox counts from sync or async outbox
  ports without exporting raw event ids.
- Background runtime now has an `EventOutboxRuntimeLoop` foundation that drains pending outbox
  records through an injected publisher and records scheduled backlog metrics without returning raw
  event ids in its tick summary.
- Background runtime composition now supports a production EventLog outbox profile backed by the
  PostgreSQL EventLog backend plus JSONL outbox publication evidence and JSONL backlog metrics. The
  production Docker template declares the background service and the compose checker verifies the
  EventLog outbox publisher/metrics wiring.
- Target-environment evidence validation now treats `Background Runtime` as a required runtime
  component, so production proof must explicitly cover EventLog outbox drain, outbox publication
  evidence, backlog metrics, and shutdown behavior before any future production-ready claim.

## Known Gaps

- N8 PostgreSQL repository completion is done for the runtime paths already exposed through the
  platform API. PostgreSQL coverage is still not complete for the full 18-port catalog.
- PostgreSQL has an explicit migration command path, but production migration execution still needs
  target-environment evidence, backup verification, and rollback runbook validation.
- N11.1 adds a durable WorkerJob-backed queue provider. PostgreSQL-backed atomic reservation,
  durable retry visibility, and expired lease recovery now have local contract coverage; final
  production queue validation remains open hardening work.
- API runtime composition can now opt into the same durable WorkerJob-backed queue provider with
  `OMNIWA_API_QUEUE_PROFILE=durable-worker-job`, and production API runtime validation fails closed
  unless that queue profile is selected. This closes the API enqueue-side queue-profile gap, while
  cross-process worker/provider runtime proof remains target-environment validation work.
- N11.2 durable EventLog/outbox/SSE replay foundation is present. A generic async-compatible outbox
  consumer, async EventLog compatibility boundary, PostgreSQL EventLog backend foundation, API
  runtime PostgreSQL EventLog selection, EventLog backlog metric definitions/helpers, and a
  background outbox runtime loop with scheduled backlog metric recording, JSONL outbox publication
  evidence, and production compose service validation now exist. Target-environment wiring
  evidence, dashboards, and alerting remain open hardening work.
- Production Docker template coverage is broader than the API service now, but it is still a
  deployment template. Target-environment startup, production load, SLO evidence, Provider Runtime
  runtime proof, and provider-runtime bridge evidence remain open before any production-ready claim.
- `ADR-0010` is accepted, and `@omniwa/infrastructure-provider-bridge` now provides the internal
  Provider Command Bridge contract, a `MessagingProviderPort` adapter, and fake in-memory transport
  tests without importing Baileys. It also has a framework-agnostic HTTP transport/handler
  foundation with internal token authentication and safe failure mapping. Provider Runtime now has a
  command receiver that maps bridge commands to `ProviderRuntimeApp` lifecycle operations and safe
  provider outcomes. Worker runtime now has an explicit `provider-runtime-bridge` mode that routes
  through an injected `ProviderCommandTransport` and fails closed when that transport is missing.
  Provider Runtime now has an opt-in internal HTTP bridge server endpoint that fails closed when the
  bridge token or transport is missing, and Worker runtime can compose a
  `FetchProviderCommandTransport` from bridge endpoint/token env configuration in
  `provider-runtime-bridge` mode. Worker production profile composition now fails closed unless
  PostgreSQL repositories, the durable WorkerJob queue profile, provider-runtime bridge
  endpoint/token, a durable EventLog path, and shared outbound intent storage are configured. The
  production compose template/check now declares Worker production bridge wiring to the Provider
  Runtime production profile, and target-environment runtime evidence now requires sanitized bridge
  client/server/auth/round-trip proof. Actual target-environment evidence collection remains open
  follow-up work.
- N11.3 added durable local and PostgreSQL provider-runtime ownership lease guards, active lease
  renewal during the supervisor drain loop, and PostgreSQL contract coverage in `pnpm test:postgres`.
  Provider Runtime production profile wiring is guarded; final production validation remains open.
- Integration and live-network tests intentionally avoid requiring real WhatsApp credentials in normal
  PR validation.
- Controlled message retry is intentionally text-only in the current N9 scope; media retry remains a
  follow-up capability.
- Provider-runtime bridge target-environment proof remains open.
- N11.4 allows API runtime composition from `OMNIWA_API_KEY_HASH`,
  `OMNIWA_API_KEY_LIFECYCLE_STORE_PATH`, and `SecretProvider` via `OMNIWA_API_KEY_SECRET_NAME`
  without keeping plaintext API key configuration. The API process entrypoint now selects
  `EnvSecretProvider` for that secret-name path. Provider runtime can also encrypt durable Baileys
  auth-state JSON with `OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY`; older unencrypted local auth-state
  files remain readable for compatibility. Admin `/v1/api-keys` lifecycle routes can list,
  provision, revoke, and rotate safe key records when the lifecycle store is configured; responses do
  not expose plaintext keys or `sha256:` hashes. Production external secret provider selection and
  final production-profile validation remain open hardening items.
- N11.5 authorization and rate limits is done for the current production-hardening scope. API runtime
  composition can now wire the existing
  in-memory fixed-window limiter from `OMNIWA_API_RATE_LIMIT_MAX_REQUESTS` and
  `OMNIWA_API_RATE_LIMIT_WINDOW_MS`, with optional per-endpoint-class limits for read, write,
  message-send, admin, and event-stream traffic. It can also wire opt-in in-memory denied-decision
  evidence through `OMNIWA_API_SECURITY_AUDIT_IN_MEMORY=true`, durable JSON security-audit evidence
  through `OMNIWA_API_SECURITY_AUDIT_LOG_PATH`, or approved domain `AuditRecord` persistence through
  `OMNIWA_API_SECURITY_AUDIT_RECORDS=true` through the selected repository profile's
  `AuditRecordRepositoryPort`. Runtime composition also supports opt-in repository-backed resource
  ownership resolution through `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true` for session, message,
  attached media, chat, contact, label, group, and job resources with explicit or safely derivable
  instance ownership. Unattached media and resources without current owner fields fail closed when
  this resolver is enabled. Rate-limit snapshots can now be converted into approved low-cardinality
  API metric points without exporting API key ids, bucket keys, instance refs, or target refs. API
  production runtime composition now validates that PostgreSQL configuration does not use local
  hosts or known development credentials and rejects production profiles that do not configure
  `OMNIWA_API_RATE_LIMIT_BACKEND=redis` with either `OMNIWA_API_RATE_LIMIT_REDIS_URL` or an injected
  Redis script client,
  `OMNIWA_API_SECURITY_AUDIT_RECORDS=true`,
  `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true`,
  `OMNIWA_API_QUEUE_PROFILE=durable-worker-job`, and
  `OMNIWA_API_METRICS_JSONL_PATH` or an injected API metric recorder. The rate-limit boundary is now
  async-compatible and includes a shared counter-store limiter plus a Redis script store that hashes
  cache keys instead of writing key ids or instance refs into Redis keys. API runtime composition can
  select `OMNIWA_API_RATE_LIMIT_BACKEND=redis` from explicit Redis URL configuration or an injected
  approved Redis script client, and fails closed if that backend is requested without either source.
  The concrete `redis` npm dependency is contained in the API runtime adapter boundary approved by
  accepted `docs/adr/ADR-0008-redis-rate-limit-client.md`. Production API composition also fails
  closed unless the Redis-backed limiter, AuditRecord-backed security-audit evidence, and
  repository-backed resource ownership resolver are configured. PostgreSQL repository coverage now
  includes Label and MediaAsset for ownership
  resolution where those aggregates carry or can safely derive an instance owner. Targetless global
- Targetless global resources such as webhooks, deliveries, events, jobs, metrics, audit records,
  API keys, settings, and provider status now fail closed for instance-scoped credentials unless an
  explicit owner can be supplied through a future resource model. Owner modeling for future
  instance-scoped access to those currently global resources is deferred until the product requires
  those filtered read models.
- N11.6 webhook reliability is done for the current production-hardening scope. The dispatcher runtime already has durable restart recovery,
  retry/dead-letter handling, HMAC/timestamp signing, replay verification, metrics, and audit
  evidence. The current implementation now includes a real `FetchWebhookHttpGateway` foundation with
  safe timeout/network failure mapping and opt-in local dispatcher runtime wiring through
  `OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch` plus
  `OMNIWA_WEBHOOK_SIGNING_SECRET_NAME`. `POST /v1/webhook-deliveries/{deliveryId}/retry` is now
  `implemented_public` for eligible pending/retrying deliveries with `webhooks:retry`, and
  `POST /v1/webhook-deliveries/{deliveryId}/redrive` is `implemented_public` for eligible
  dead-lettered deliveries with `webhooks:redrive`; `POST /v1/webhook-deliveries/redrive` is also
  `implemented_public` for selected bulk redrive of dead-lettered deliveries through a safe operation
  intent, and the client contract now includes a required
  `GET /v1/webhook-deliveries?status=dead_letter` fixture plus Rust SDK helpers for dead-letter
  listing with safe remediation reason/category filters and bulk redrive. These operations require
  `idempotency-key` where mutating and are synchronized across client-contract fixtures and the Rust SDK. The webhook dispatcher can now opt
  into `OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job` to use the durable
  `WorkerJob`-backed queue provider. Webhook dispatcher production profile composition is now
  fail-closed and requires PostgreSQL repositories, the durable worker-job queue profile, fetch
  gateway, configured signing secret value, metric recorder, and webhook dispatch audit sink before
  the runtime can be composed. Runtime composition can now create JSONL metric and webhook dispatch
  audit adapters from `OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH` and
  `OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH`, so production composition no longer depends only on
  test-injected observability adapters, and production composition now rejects a shared metric/audit
  JSONL target path or a configured JSONL target that cannot be opened for append. The PostgreSQL
  test gate now includes a production-profile webhook dispatcher dispatch path that persists
  `WebhookDelivery` and `WorkerJob` outcomes through PostgreSQL and records JSONL metric/audit
  evidence when `OMNIWA_POSTGRES_TEST_DATABASE_URL` is configured. Remaining production proof now
  moves to N11.7; richer dead-letter workflows, target-environment JSONL rotation, and richer
  exporters stay as P1/P0-13 follow-up capabilities.
- N11.7 production validation is active. Backup/restore recovery drill evidence now has a dedicated
  `pnpm recovery:check` root gate that verifies the recovery readiness checker, deterministic
  backup/restore drill tests, recovery validation tests, and release-readiness wiring. The gate
  proves the deterministic recovery contract; target-environment backup automation and restore
  drills are still required before a broad production-ready claim.
- N11.7 also has dedicated `pnpm observability:check` and `pnpm slo:check` root gates for
  deterministic observability, dependency-readiness, and SLO evidence. The observability gate
  verifies the readiness checker, metric catalog, alert definitions, dependency readiness behavior,
  dashboard/alert-routing catalog coverage, metrics runtime smoke, health runtime smoke, and
  release-readiness wiring. The SLO gate verifies the approved SLI/SLO/error-budget table, alert
  runbook coverage, dashboard/alert-routing catalog coverage, production-cut SLO proof state, and
  root gate wiring. These gates do not replace target-environment dashboard access proof,
  alert-routing dry-runs, exporter operations, or sustained SLO monitoring.
- The metrics runtime smoke path now exports all approved production catalog metrics, including
  `eventlog.outbox.records`, through the Prometheus text exporter without raw event ids, target
  identifiers, JIDs, message text, provider payloads, API keys, or secrets.
- N11.7 now wires API request latency metrics into the HTTP transport through the approved
  `MetricRecorder` port. Local and production API runtimes can use
  `OMNIWA_API_METRICS_JSONL_PATH` for a JSONL metric sink, and production API composition fails
  closed unless a writable metrics path or injected recorder is present. The recorded labels are
  method, normalized route, and outcome only; raw ids, query strings, request bodies, JIDs, and
  provider payloads are not metric labels.
- N11.7 also has a dedicated `pnpm e2e:check` root gate for deterministic E2E evidence. The gate
  requires the REST platform regression spec and the local vertical-slice runtime spec that proves
  Application, durable JSON state, queue, worker, provider fake socket, and EventLog safety. It does
  not replace target-environment smoke tests or production-like load tests.
- N11.7 also has a dedicated `pnpm security:check` root gate for deterministic security-control
  evidence. The gate requires API auth, API-key lifecycle, rate limiting, security audit evidence,
  resource ownership, webhook signing/replay, redaction, object-path secrecy, and Baileys auth-state
  safety tests. It does not replace external penetration testing or deployment-specific security
  review.
- N11.7 also has a dedicated `pnpm performance:check` root gate for deterministic load/performance
  evidence. The gate verifies the performance readiness checker, delegates to `pnpm load:check`, and
  requires the load baseline and production cut checker tests. It does not replace
  target-environment load tests, sustained SLO observation, or external dependency capacity testing.
- N11.7 production cut validation now requires explicit `Target Environment Proven`,
  `Production Load Proven`, and `SLO Evidence Proven` states in the production cut review. The
  current values remain `NO`, so `PRODUCTION_READY` cannot be claimed until target-environment
  runtime startup, production-like load, and SLO/alert evidence are recorded.
- N11.7 target-environment validation now has a dedicated `pnpm target-env:check` root gate and
  `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` evidence file. The gate keeps the current
  `NOT_PROVEN` status explicit while requiring a runtime/dependency evidence matrix before any
  future `PROVEN` claim.
- N11.7 also provides an optional `pnpm target-env:smoke` runner for deployed API smoke evidence
  against `/v1/health`, `/v1/health/readiness`, and `/v1/instances`. The runner is intentionally not
  part of the default `pnpm check` path because it needs a target deployment and API key; its unit
  tests and release evidence remain covered by `pnpm target-env:check` and `pnpm release:check`.
  Operators can set `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` to write the sanitized smoke summary as a
  review artifact without storing the target URL, API key, response bodies, raw IDs, QR/JID/text
  payloads, provider payloads, or secrets.
- N11.7 also provides an optional `pnpm target-env:load` runner for bounded deployed API load
  evidence against approved public GET endpoints. The runner is intentionally not part of the
  default `pnpm check` path because it needs a target deployment and API key; its unit tests and
  release/performance evidence are covered by `pnpm performance:check` and `pnpm release:check`.
  Operators can set `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` to write the sanitized load summary as a
  review artifact without storing the target URL, API key, response bodies, raw IDs, query strings,
  QR/JID/text payloads, provider payloads, or secrets. This still does not prove sustained SLOs or
  external dependency capacity.
- N11.7 production cut validation now also requires `PRODUCTION_CUT_REVIEW.md` to acknowledge
  target-environment load evidence and requires the root `target-env:load` script to exist. This
  keeps the production-cut decision gate aligned with the optional deployed API load runner without
  running target-environment traffic in the default local quality gate.
- N11.7 release readiness now also guards implementation-progress documents against stale current
  increment references. `pnpm release:check` requires `IMPLEMENTATION_STATUS.md` and
  `NEXT_DEVELOPMENT_PLAN.md` to agree that production hardening is currently at N11.7 production
  validation gates.
- N11.7 target-environment evidence validation now requires both optional operator commands
  (`pnpm target-env:smoke` and `pnpm target-env:load`) plus their sanitized artifact path
  environment variables to be documented in `TARGET_ENVIRONMENT_VALIDATION.md`; the gate runs only
  local checker/unit tests and still does not contact a target deployment.
- N11.7 target-environment evidence validation now also validates optional smoke/load artifact JSON
  schemas when `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` or `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` is
  supplied to `pnpm target-env:check`. The validator rejects unsafe URL, API key, QR/JID/text,
  provider payload, auth-state, and session-material fields without recording the operator artifact
  path in findings.
- N11.7 target-environment evidence validation now also validates an optional sanitized alert/SLO
  dry-run artifact when `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH` is supplied. The artifact
  covers dashboard access checks, alert-route dry-runs, and SLO window/error-budget policy checks
  without storing dashboard URLs, notification destinations, raw IDs, JIDs, message text, provider
  payloads, API keys, or secrets.
- N11.7 target-environment evidence tooling now also provides `pnpm target-env:runtime`, which
  normalizes sanitized operator runtime evidence input from
  `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH` into
  `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`. The artifact covers runtime
  startup/readiness/shutdown checks, dependency connectivity, migration-status checks,
  provider-command bridge startup/client/server/auth/round-trip proof refs, and backup/restore drill
  references without storing target URLs, connection strings, raw runtime logs, API keys, JIDs,
  message text, provider payloads, session material, or secrets. If no input is supplied, the
  command emits a failed safe skeleton instead of claiming proof, and bridge proof refs that still
  contain `pending` keep the artifact failed.
- N11.7 target-environment evidence validation now keeps
  `docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json` under the local evidence
  gate as a safe failed skeleton. Operators should copy and populate that template into an external
  artifact path before passing it through `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH`.
- N11.7 release readiness now also guards
  `docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md` against runtime-evidence workflow drift. The
  runbook must document `pnpm target-env:runtime`, the runtime evidence input/report paths, and the
  checked-in safe input template.
- N11.7 now also has `docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md` as the operator
  sequence for collecting smoke, load, runtime, and bundle evidence before any future production
  readiness claim. `pnpm release:check` guards that runbook against missing target-environment
  commands, artifact path variables, template references, and review-update references.
- N11.7 target-environment smoke evidence now validates the deployed API public response envelope and
  request/correlation metadata for successful `/v1/health`, `/v1/health/readiness`, and
  `/v1/instances` checks while still excluding response bodies, target URLs, API keys, raw IDs,
  QR/JID/text payloads, provider payloads, and secrets from the sanitized artifact.
- N11.7 target-environment evidence validation now also accepts
  `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH` for an operator-maintained sanitized evidence bundle
  manifest. The bundle schema ties runtime component statuses to deployment profile, runtime
  versions, startup, health/readiness, dependency connectivity, backup/restore, production-load,
  alert/SLO dry-run, runtime evidence, rollback or forward-fix references, and smoke/load artifact
  refs without storing raw environment details.
- N11.7 target-environment evidence validation now also keeps
  `docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json` under the local evidence gate as a
  safe `NOT_PROVEN` skeleton. Operators should copy and populate that template into an external
  artifact path before passing it through `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH`.
- N11.7 target-environment evidence tooling now also provides `pnpm target-env:bundle`, which writes
  a sanitized initial bundle to `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH` from the checked-in
  template and can embed already-sanitized smoke, load, alert/SLO dry-run, and runtime evidence
  summaries when their report path variables are present. The generated bundle remains `NOT_PROVEN`
  until an operator supplies target-environment evidence and updates the proof states.
- N11.7 target-environment evidence validation now also cross-checks optional evidence bundles
  against `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md`; bundle status, proof booleans, and
  component statuses must match the review document when
  `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_PATH` is supplied.
- N11.7 target-environment evidence validation now also requires `Background Runtime` in both
  `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` and sanitized evidence bundles. This prevents the
  EventLog outbox runtime from being skipped during production evidence collection.
- N11.7 production-cut validation now also requires `target-env:bundle` tooling and a production-cut
  review acknowledgement for sanitized target-environment evidence bundles, keeping
  `PRODUCTION_CUT_REVIEW.md` aligned with the target-environment evidence workflow.
- N11.7 production-cut validation now also requires `target-env:smoke` tooling and a production-cut
  review acknowledgement for deployed API smoke evidence, keeping the production-cut gate aligned
  with all target-environment operator evidence commands.
- N11.7 production compose validation now also runs as part of `pnpm production:check`. This keeps
  the expanded production compose template under an automated local release gate while preserving
  the current `CONDITIONALLY_READY` posture until target-environment startup evidence is supplied.

## Update Rule

Record every progress change here instead of scattering status across other documents.
