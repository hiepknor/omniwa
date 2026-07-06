# N11 Production Hardening Log

This is the historical record of completed N11 production-hardening work. It consolidates the
increment narratives that previously accumulated inside `docs/IMPLEMENTATION_STATUS.md` and
`docs/platform-evolution/NEXT_DEVELOPMENT_PLAN.md`.

This file is append-only history. Current state, open gaps, and the authoritative progress snapshot
live in `docs/IMPLEMENTATION_STATUS.md`. Do not record new status here first; record it there and
move completed increment narratives here when they close.

## N11.0 - Production Plan Reconciliation

Aligned execution docs with N8/N9/N10 implementation evidence before starting the hardening sprints.

## N11.1 - Production Queue Foundation

- Added the durable `WorkerJob`-backed queue provider behind `QueueProviderPort` alongside
  `InMemoryQueueProvider`, with PostgreSQL-backed `WorkerJobRepositoryPort` source state.
- API runtime composition can opt into the same durable WorkerJob-backed queue provider with
  `OMNIWA_API_QUEUE_PROFILE=durable-worker-job`, and production API runtime validation fails closed
  unless that queue profile is selected. This closed the API enqueue-side queue-profile gap.
- Queue hardening later added local PostgreSQL proof for single-reservation concurrency
  (`FOR UPDATE SKIP LOCKED` atomic reservation), durable retry visibility across queue-provider
  restarts, and expired lease recovery, with
  `OMNIWA_POSTGRES_TEST_DATABASE_URL=postgresql://omniwa:omniwa-local-password@127.0.0.1:55432/omniwa pnpm test:postgres`
  passing 41 tests at that point.
- Queue observability now emits approved `queue.backlog.depth` and
  `queue.backlog.oldest_pending_age` catalog metrics from the durable WorkerJob queue provider using
  only the low-cardinality `work_type` label, covered by the observability catalog, dashboard
  routing, metrics runtime smoke path, and durable queue provider tests.

## N11.2 - Durable EventLog / Outbox / Replay

- Durable EventLog/outbox/SSE replay foundation: webhook dispatcher runtime, durable JSON
  EventLog/outbox, SSE read surfaces, restart replay tests, and safe provider signal ingestion.
- Added a generic `EventOutboxConsumer` foundation that drains pending outbox records through an
  injected publisher, marks successful records as published, keeps failed records pending, and
  returns safe failure summaries without raw provider payload exposure.
- `ADR-0009` was accepted for the async PostgreSQL EventLog backend migration. Application exposes
  async EventLog/outbox port types, and infrastructure provides a sync-to-async compatibility
  adapter so existing in-memory and durable JSON stores keep local/dev behavior behind the new async
  boundary.
- The generic `EventOutboxConsumer` can drain through either the synchronous outbox port or the new
  async outbox port, so PostgreSQL EventLog/outbox stores plug into the same consumer without a
  second drain loop.
- The PostgreSQL EventLog backend foundation exists behind `AsyncEventLogPort`, with versioned SQL
  migrations for `omniwa_event_log` and `omniwa_event_outbox`. Local `pnpm test:postgres` passed 48
  tests at that point, covering PostgreSQL EventLog append idempotency, monotonic cursor replay,
  not-found/expired cursor semantics, durable outbox state, generic outbox consumer drain, and safe
  failure summaries.
- API runtime composition can select `OMNIWA_EVENT_LOG_BACKEND=postgresql` and wire
  `PostgresqlEventLogStore` into Application event publication, `GET /v1/events`, and
  `/v1/events/stream`. The production API profile fails closed unless that PostgreSQL EventLog
  backend is configured, and the production Docker template/check declares and verifies that
  backend so the deployment template cannot drift back to a JSON EventLog path.
- EventLog outbox backlog metrics have an approved `eventlog.outbox.records` catalog entry and an
  infrastructure observability helper that records pending/published outbox counts from sync or
  async outbox ports without exporting raw event ids.
- Background runtime has an `EventOutboxRuntimeLoop` foundation that drains pending outbox records
  through an injected publisher and records scheduled backlog metrics without returning raw event
  ids in its tick summary.
- Background runtime composition supports a production EventLog outbox profile backed by the
  PostgreSQL EventLog backend plus JSONL outbox publication evidence and JSONL backlog metrics. The
  production Docker template declares the background service and the compose checker verifies the
  EventLog outbox publisher/metrics wiring.
- Target-environment evidence validation treats `Background Runtime` as a required runtime
  component, so production proof must explicitly cover EventLog outbox drain, outbox publication
  evidence, backlog metrics, and shutdown behavior.

## N11.3 - Provider Runtime Ownership

- Added durable local and PostgreSQL provider-runtime ownership lease guards, active lease renewal
  during the supervisor drain loop, and PostgreSQL contract coverage in `pnpm test:postgres`.
- Provider Runtime production profile wiring is guarded; final target-environment validation remains
  tracked in `docs/IMPLEMENTATION_STATUS.md`.

## N11.4 - Secret And API-Key Hardening

- API runtime composition can be built from `OMNIWA_API_KEY_HASH`,
  `OMNIWA_API_KEY_LIFECYCLE_STORE_PATH`, or `SecretProvider` via `OMNIWA_API_KEY_SECRET_NAME`
  without keeping plaintext API key configuration. The API process entrypoint selects
  `EnvSecretProvider` for the secret-name path.
- Provider runtime can encrypt durable Baileys auth-state JSON with
  `OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY`; older unencrypted local auth-state files remain
  readable for compatibility.
- Admin `/v1/api-keys` lifecycle routes can list, provision, revoke, and rotate safe key records
  when the lifecycle store is configured; responses do not expose plaintext keys or `sha256:`
  hashes.

## N11.5 - Authorization And Rate Limits

- API runtime composition wires the in-memory fixed-window limiter from
  `OMNIWA_API_RATE_LIMIT_MAX_REQUESTS` and `OMNIWA_API_RATE_LIMIT_WINDOW_MS`, with optional
  per-endpoint-class limits for read, write, message-send, admin, and event-stream traffic.
- Opt-in denied-decision evidence: in-memory through `OMNIWA_API_SECURITY_AUDIT_IN_MEMORY=true`,
  durable JSON through `OMNIWA_API_SECURITY_AUDIT_LOG_PATH`, or approved domain `AuditRecord`
  persistence through `OMNIWA_API_SECURITY_AUDIT_RECORDS=true` through the selected repository
  profile's `AuditRecordRepositoryPort`.
- Opt-in repository-backed resource ownership resolution through
  `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true` for session, message, attached media, chat,
  contact, label, group, and job resources with explicit or safely derivable instance ownership
  (attached media through its owning message; labels through their aggregate `instanceId`).
  Unattached media and resources without current owner fields fail closed when this resolver is
  enabled. PostgreSQL repository coverage includes Label and MediaAsset for those ownership paths.
- Targetless global resources such as webhooks, deliveries, events, jobs, metrics, audit records,
  API keys, settings, and provider status fail closed for instance-scoped credentials unless an
  explicit owner can be supplied through a future resource model. Owner modeling for future
  instance-scoped access to those currently global resources is deferred until the product requires
  those filtered read models.
- Rate-limit snapshots can be exported as approved low-cardinality API metric points without
  exporting API key ids, bucket keys, instance refs, or target refs.
- The rate-limit boundary is async-compatible and includes a shared counter-store limiter plus a
  Redis script store that hashes cache keys instead of writing key ids or instance refs into Redis
  keys. API runtime composition selects `OMNIWA_API_RATE_LIMIT_BACKEND=redis` from
  `OMNIWA_API_RATE_LIMIT_REDIS_URL` or an injected approved Redis script client, and fails closed if
  that backend is requested without either source. The concrete `redis` npm dependency is contained
  in the API runtime adapter boundary approved by accepted
  `docs/adr/ADR-0008-redis-rate-limit-client.md`.
- Production API composition validates that PostgreSQL configuration does not use local hosts or
  known development credentials and rejects production profiles that do not configure
  `OMNIWA_API_RATE_LIMIT_BACKEND=redis` (with Redis URL or injected script client),
  `OMNIWA_API_SECURITY_AUDIT_RECORDS=true`, `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true`,
  `OMNIWA_API_QUEUE_PROFILE=durable-worker-job`, and `OMNIWA_API_METRICS_JSONL_PATH` or an injected
  API metric recorder.

## N11.6 - Webhook Reliability Hardening

- The dispatcher runtime has durable restart recovery, retry/dead-letter handling, HMAC/timestamp
  signing, replay verification, metrics, and audit evidence.
- Added a real `FetchWebhookHttpGateway` foundation with safe timeout/network failure mapping and
  opt-in local dispatcher runtime wiring through `OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch` plus
  `OMNIWA_WEBHOOK_SIGNING_SECRET_NAME`.
- Public contract promotions: `POST /v1/webhook-deliveries/{deliveryId}/retry` is
  `implemented_public` for eligible pending/retrying deliveries with `webhooks:retry`;
  `POST /v1/webhook-deliveries/{deliveryId}/redrive` is `implemented_public` for eligible
  dead-lettered deliveries with `webhooks:redrive`; `POST /v1/webhook-deliveries/redrive` is
  `implemented_public` for selected bulk redrive through a safe operation intent; and
  `GET /v1/webhook-deliveries?status=dead_letter` is covered by a required client-contract fixture
  plus Rust SDK helpers with safe remediation reason/category filters. Mutating operations require
  `idempotency-key` and are synchronized across client-contract fixtures and the Rust SDK.
- Webhook dispatcher processing persists `WebhookDelivery` dispatch outcomes for delivered,
  retrying, and dead-lettered deliveries so read surfaces no longer depend only on `WorkerJob`
  state.
- The dispatcher can opt into `OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job` for the
  durable `WorkerJob`-backed queue provider.
- Webhook dispatcher production profile composition is fail-closed and requires PostgreSQL
  repositories, the durable worker-job queue profile, fetch gateway, configured signing secret
  value, metric recorder, and webhook dispatch audit sink before composition is allowed. Runtime
  composition can create JSONL metric and webhook dispatch audit adapters from
  `OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH` and `OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH`;
  production composition rejects a shared metric/audit JSONL target path or a configured JSONL
  target that cannot be opened for append.
- `pnpm test:postgres` includes a production-profile webhook dispatcher validation path that
  persists `WebhookDelivery` and `WorkerJob` outcomes through PostgreSQL and records JSONL
  metric/audit evidence when `OMNIWA_POSTGRES_TEST_DATABASE_URL` is configured.
- Richer dead-letter workflows, target-environment JSONL rotation, richer exporters, and any future
  receiver-failure circuit breaker stay as follow-up capabilities unless target-environment evidence
  makes them production blockers.

## N11.7 - Production Validation Gates (completed slices)

### Validation gate foundation

- `pnpm recovery:check` verifies the recovery readiness checker, deterministic backup/restore drill
  tests, recovery validation tests, and release-readiness wiring.
- `pnpm observability:check` verifies the readiness checker, metric catalog, alert definitions,
  dependency readiness behavior, dashboard/alert-routing catalog coverage, metrics runtime smoke,
  health runtime smoke, and release-readiness wiring. `pnpm slo:check` verifies the approved
  SLI/SLO/error-budget table, alert runbook coverage, dashboard/alert-routing catalog coverage,
  production-cut SLO proof state, and root gate wiring.
- The metrics runtime smoke path exports all approved production catalog metrics, including
  `eventlog.outbox.records`, through the Prometheus text exporter without raw event ids, target
  identifiers, JIDs, message text, provider payloads, API keys, or secrets.
- API request latency metrics are wired into the HTTP transport through the approved
  `MetricRecorder` port. Local and production API runtimes can use `OMNIWA_API_METRICS_JSONL_PATH`
  for a JSONL metric sink; production API composition fails closed unless a writable metrics path or
  injected recorder is present. Recorded labels are method, normalized route, and outcome only.
- `pnpm e2e:check` requires the REST platform regression spec and the local vertical-slice runtime
  spec that proves Application, durable JSON state, queue, worker, provider fake socket, and
  EventLog safety without calling the real WhatsApp network.
- `pnpm security:check` requires API auth, API-key lifecycle, rate limiting, security audit
  evidence, resource ownership, webhook signing/replay, redaction, object-path secrecy, and Baileys
  auth-state safety tests.
- `pnpm performance:check` verifies the performance readiness checker, delegates to
  `pnpm load:check`, and requires the load baseline and production cut checker tests.

### PostgreSQL migrations

- Explicit `pnpm db:migrate:status` and `pnpm db:migrate` operator commands backed by the versioned
  `omniwa_schema_migrations` ledger, `runPostgresqlSqlMigrations`, and
  `getPostgresqlSqlMigrationStatus`. The CLI reads `OMNIWA_POSTGRES_DATABASE_URL` and redacts
  credentials from command output.

### Production Docker template

- `deploy/docker/compose.production.yml` expanded from an API-only template to a full runtime
  template with API, worker, webhook dispatcher, provider runtime, background, PostgreSQL, and Redis
  services. The template uses hashed API-key input, Redis API rate limiting, PostgreSQL
  repositories, durable WorkerJob queue profiles where available, webhook dispatcher production
  composition, Worker production profile validation, shared outbound intent storage, and Provider
  Runtime production profile validation guarded by encrypted auth state, PostgreSQL ownership,
  explicit owner identity, and command bridge authentication.
- `pnpm docker:production:check` is wired into `pnpm production:check` and the root `pnpm check`
  path. The gate renders the checked-in production compose template with
  `deploy/docker/env/production.env.example` and verifies required services, hash-only API-key
  posture, Redis API rate limiting, disabled auto-migration, the PostgreSQL API EventLog backend,
  shared outbound intent storage, Worker production bridge wiring, and Provider Runtime production
  profile wiring without printing rendered secret material.
- Worker production profile validation fails closed unless Worker uses PostgreSQL repositories, the
  durable WorkerJob queue profile, `provider-runtime-bridge` mode with endpoint and token
  configuration, a durable `OMNIWA_EVENT_LOG_PATH`, and
  `OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH`.

### Provider Runtime Worker Bridge (`ADR-0010`)

- `ADR-0010` is accepted. `@omniwa/infrastructure-provider-bridge` provides the internal Provider
  Command Bridge contract, a `MessagingProviderPort` adapter, and fake in-memory transport tests
  without importing Baileys, plus a framework-agnostic HTTP transport/handler foundation with
  internal token authentication and safe failure mapping.
- Provider Runtime has a command receiver that maps bridge commands to `ProviderRuntimeApp`
  lifecycle operations and safe provider outcomes, and an opt-in internal HTTP bridge server
  endpoint that fails closed when the bridge token or transport is missing.
- Worker runtime has an explicit `provider-runtime-bridge` mode that routes through an injected
  `ProviderCommandTransport`, fails closed when that transport is missing, and can compose a
  `FetchProviderCommandTransport` from bridge endpoint/token env configuration.
- API, Worker, and Provider Runtime production composition require a shared
  `OMNIWA_OUTBOUND_MESSAGE_INTENT_STORE_PATH` so API-created outbound intents are resolvable across
  process boundaries.
- The production compose template/check declares Worker production bridge wiring to the Provider
  Runtime production profile, and target-environment runtime evidence requires sanitized bridge
  client/server/auth/round-trip proof.

### Target-environment evidence tooling

- `pnpm target-env:check` plus `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` keep the current
  `NOT_PROVEN` status explicit while requiring a runtime/dependency evidence matrix before any
  future `PROVEN` claim.
- Operator commands (all operator-run only, never part of the default local quality gate):
  - `pnpm target-env:smoke` — deployed API smoke evidence against `/v1/health`,
    `/v1/health/readiness`, and `/v1/instances`, validating the public response envelope and
    request/correlation metadata; sanitized summary via `OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH`.
  - `pnpm target-env:load` — bounded deployed API load evidence against approved public GET
    endpoints; sanitized summary via `OMNIWA_TARGET_ENV_LOAD_REPORT_PATH`.
  - `pnpm target-env:alert-slo` — normalizes sanitized alert/SLO dry-run input
    (`OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_INPUT_PATH` →
    `OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`) covering dashboard access checks, alert-route
    dry-runs, and SLO window/error-budget policy checks. Template:
    `docs/reviews/TARGET_ENVIRONMENT_ALERT_SLO_DRY_RUN_INPUT_TEMPLATE.json`.
  - `pnpm target-env:runtime` — normalizes sanitized runtime evidence input
    (`OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_INPUT_PATH` →
    `OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`) covering startup/readiness/shutdown,
    dependency connectivity, migration-status checks, provider-command bridge proof refs, queue
    runtime proof refs (durable profile selection, atomic reservation, retry recovery, dead-letter,
    expired lease recovery), observability signal proof refs (metrics exporter, structured logging,
    queue backlog metrics, EventLog outbox metrics, redaction review), a `credentialBoundary` proof
    section (Secret Provider selection, platform credential source, delivery signing credential
    access, Baileys state encryption, rotation procedure), an `eventStream` proof section (durable
    EventLog backend selection, replay cursor, expired cursor handling, SSE cursor resume, public
    event envelope), and backup/restore drill references. Emits a failed safe skeleton when no input
    is supplied; `pending` refs keep the artifact failed. Template:
    `docs/reviews/TARGET_ENVIRONMENT_RUNTIME_EVIDENCE_INPUT_TEMPLATE.json`.
  - `pnpm target-env:bundle` — writes a sanitized initial evidence bundle to
    `OMNIWA_TARGET_ENV_EVIDENCE_BUNDLE_OUTPUT_PATH` from the checked-in `NOT_PROVEN` template
    (`docs/reviews/TARGET_ENVIRONMENT_EVIDENCE_BUNDLE_TEMPLATE.json`), embedding already-sanitized
    smoke/load/alert-SLO/runtime summaries when their report path variables are present.
  - `pnpm target-env:summary` — emits a safe readiness summary from
    `TARGET_ENVIRONMENT_VALIDATION.md`, supplied artifact booleans, and evidence-gate finding codes
    without printing target URLs, artifact paths, API keys, raw IDs, JIDs, message text, provider
    payloads, auth state, or secret material.
- All sanitized artifacts must exclude target URLs, API keys, response bodies, raw IDs, QR/JID/text
  payloads, provider payloads, session material, webhook secrets, connection strings, and raw
  runtime logs. Artifact JSON schemas are validated when their env vars are supplied to
  `pnpm target-env:check`, and unsafe fields are rejected without recording operator artifact paths
  in findings.
- Anti-drift rules: when a bundle path is supplied, bundle status, proof booleans, and component
  statuses must match `TARGET_ENVIRONMENT_VALIDATION.md`; a future `PROVEN` review requires a
  matching sanitized bundle artifact (markdown-only proof promotion cannot pass); a future `PROVEN`
  bundle requires every evidence/component reference non-pending and `passed` summaries for smoke,
  load, alert/SLO dry-run, and runtime evidence entries; `Background Runtime` is a required
  component in both the review file and bundles.
- Checker/bundle functions are isolated from ambient operator artifact path environment variables;
  the CLI entrypoints still consume those env vars, but unit tests and fixture evaluations do not
  fail when an operator runs `pnpm target-env:check` with artifact paths set.
- `docs/runbooks/TARGET_ENVIRONMENT_EVIDENCE_COLLECTION.md` gives operators the ordered
  smoke/load/alert-SLO/runtime/bundle workflow and review-update rules. `pnpm release:check` guards
  that runbook plus `docs/runbooks/LOAD_BASELINE_AND_PRODUCTION_CUT.md` against missing commands,
  artifact path variables, template refs, and review refs, and guards `.gitignore` so operator
  artifacts under `artifacts/` stay ignored.

### Production-cut alignment

- Production cut validation requires explicit `Target Environment Proven`, `Production Load Proven`,
  and `SLO Evidence Proven` states in `PRODUCTION_CUT_REVIEW.md`, plus acknowledgement of the
  target-env smoke, load, alert/SLO dry-run, bundle, and summary workflows and the presence of their
  root scripts. All three proof states remain `NO`, preserving `CONDITIONALLY_READY`.
- `pnpm release:check` guards `IMPLEMENTATION_STATUS.md` and `NEXT_DEVELOPMENT_PLAN.md` against
  stale current-increment references (both must agree production hardening is at N11.7).

## CI Hardening Notes

- N11.7 PostgreSQL CI runs `pnpm test:postgres` with Vitest file parallelism disabled, so repository
  contract truncation cannot race the webhook dispatcher PostgreSQL runtime proof in the shared CI
  database.
- CI scopes `OMNIWA_POSTGRES_TEST_DATABASE_URL` to the dedicated `pnpm test:postgres` step only; the
  generic `pnpm check` step does not re-run PostgreSQL contract specs against the same service
  database after the sequential contract gate has passed.

## Pre-N11 Milestone Evidence

- `ee96d0f` added the local-live embedded API and real send pipeline.
- `85fd094` closed the VS02 local live demo documentation.
- `3730a5a` through `19a4f71` added and wired PostgreSQL repository coverage.
- `6efbf4e`, `49fecfa`, and `338ba1b` added and fixed the GitHub Actions quality gate with real
  PostgreSQL repository contract tests.
- GitHub Actions Quality Gate run `28701511362` was the first post-normalization run that passed
  PostgreSQL contract tests and the full repository quality gate.
- N9 controlled message mutations were verified locally with `pnpm check`, covering
  send/retry/cancel handlers, public client contract fixtures, OpenAPI compatibility, Rust SDK
  checks, and release gates.
- N10 controlled group mutations were verified locally with `pnpm check`, covering
  metadata/local-state/member actions, capability checks, audit actor requirements, client contract
  fixtures, OpenAPI compatibility, Rust SDK checks, and release gates.
