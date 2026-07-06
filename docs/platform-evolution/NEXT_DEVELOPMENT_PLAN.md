# Next Development Plan

## Purpose

This document defines the next implementation direction after the current Platform Evolution
increments. It is an execution guide, not a new architecture decision.

The plan keeps OmniWA moving toward a platform backend that can support:

- REST API.
- OpenAPI.
- Official Rust SDK.
- `omniwa-tui`.
- Web dashboard.
- CLI.
- MCP server.
- Third-party integrations.

## Current Status

The platform foundation is active and usable for selected public read paths.

Implemented public surfaces currently include:

| Capability         | Public Surface                                                                                          | Status                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| Health             | `GET /v1/health`                                                                                        | Implemented            |
| Instances          | `GET /v1/instances`, `GET /v1/instances/{instanceId}`, `POST /v1/instances`                             | Implemented            |
| Sessions           | `GET /v1/instances/{instanceId}/sessions`                                                               | Implemented            |
| Messages           | `GET /v1/instances/{instanceId}/messages`, `GET /v1/messages/{messageId}`                               | Implemented            |
| Chats              | `GET /v1/instances/{instanceId}/chats`, `GET /v1/chats/{chatId}`                                        | Implemented            |
| Contacts           | `GET /v1/instances/{instanceId}/contacts`, `GET /v1/contacts/{contactId}`                               | Implemented            |
| Groups             | `GET /v1/instances/{instanceId}/groups`, `GET /v1/groups/{groupId}`, `GET /v1/groups/{groupId}/members` | Implemented            |
| Events             | `GET /v1/events`, `GET /v1/events/stream`                                                               | Implemented            |
| Jobs               | `GET /v1/jobs`, `GET /v1/jobs/{jobId}`                                                                  | Implemented            |
| Webhooks           | `GET /v1/webhooks`, `GET /v1/webhooks/{webhookId}`                                                      | Implemented            |
| Webhook Deliveries | `GET /v1/webhook-deliveries`, `GET /v1/webhook-deliveries/{deliveryId}/history`                         | Implemented            |
| Queue              | `GET /v1/queue`                                                                                         | Implemented            |
| API Keys           | `GET /v1/api-keys`, `POST /v1/api-keys`, revoke/rotate routes                                           | Implemented admin-only |

Current local runtime:

- Docker local stack runs API, worker, webhook dispatcher, and PostgreSQL.
- Local base URL is `http://127.0.0.1:3000`.
- Local API key is `local-dev-secret-change-me`.
- Public read surfaces must be consumed through REST or the official SDK, not internal handlers.
- VS02 real WhatsApp local live demo is complete for local operator validation.
- PostgreSQL repository completion for runtime-exposed paths is done. Foundation, Message, Session,
  Chat, Contact, Group, Webhook repositories, GuardrailDecision/HealthStatus repositories, webhook
  dispatcher PostgreSQL composition, API/worker hybrid removal, and real PostgreSQL CI are complete.
- GitHub Actions Quality Gate run `28701511362` passed real PostgreSQL contract tests before the full
  `pnpm check` gate.

## Development Strategy

The next work should prioritize platform-client read readiness before broad mutation surfaces.

Reasoning:

- TUI, Web, CLI, and third-party clients need stable list/detail/read models before actions are safe.
- Read-only endpoints reduce production risk and clarify DTO contracts.
- Public API, OpenAPI, SDK, and client-contract can evolve incrementally.
- Mutations should be enabled only after related read models expose visible state, status, and failures.

The preferred order is:

1. Complete TUI-critical read APIs.
2. Keep client-contract and SDK synchronized after every endpoint.
3. Keep production durability ahead of broader mutations; N8 completed PostgreSQL coverage for the
   runtime paths already exposed through the platform API.
4. Enable selected mutations after read visibility and durable state exist.
5. Harden production runtime, queueing, security, and observability.

## Immediate Next Increment

### Increment N11 - Production Hardening

Goal:

- Close the production blockers that remain after the platform API, local-live WhatsApp proof,
  PostgreSQL repository coverage for exposed runtime paths, and controlled mutations.

Scope:

- Reconcile production-readiness blockers with current implementation evidence before starting each
  hardening sprint.
- Keep production durability ahead of new client-facing feature breadth.
- Prioritize queue durability, event durability, secret/auth hardening, provider ownership,
  observability, backup/restore, and production regression gates.
- Keep public contract, client-contract fixtures, and SDK synchronized only when a hardening sprint
  changes a public surface.

Definition of Done:

- Every production hardening increment is traceable to `PRODUCTION_EXECUTION_PLAN.md`.
- No hardening increment bypasses Application, Repository Ports, provider isolation, redaction, or
  existing public contract rules.
- Durable production behavior is covered by restart, concurrency, failure, and regression tests where
  the increment changes runtime state.
- `pnpm check` and relevant narrow tests pass.

Rollback:

- Revert the specific hardening adapter/runtime commit and keep the prior local/dev behavior intact.

### N11 Execution Order

| Order | Increment                          | Goal                                                                 | Status                                                                                        |
| ----- | ---------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| N11.0 | Production plan reconciliation     | Align execution docs with N8/N9/N10 implementation evidence          | Done                                                                                          |
| N11.1 | Production queue foundation        | Replace in-memory-only queue semantics behind `QueueProviderPort`    | Done; PostgreSQL atomic reserve, durable retry visibility, and lease recovery covered locally |
| N11.2 | Durable EventLog / outbox / replay | Make event visibility and SSE replay survive restart                 | Done                                                                                          |
| N11.3 | Provider runtime ownership         | Add production ownership/lease guard for one active socket per unit  | Done                                                                                          |
| N11.4 | Secret and API-key hardening       | Move from local/dev secret posture toward hashed, rotatable secrets  | Done                                                                                          |
| N11.5 | Authorization and rate limits      | Harden ownership checks, throttling, and denied-decision evidence    | Done                                                                                          |
| N11.6 | Webhook reliability hardening      | Complete durable retry, dead-letter, signing, and replay protection  | Done                                                                                          |
| N11.7 | Production validation gates        | Add backup/restore, E2E, security, load, and release-readiness proof | Current                                                                                       |

N11.3 is done with durable local and PostgreSQL provider-runtime lease guards, active lease renewal
during the supervisor drain loop, and PostgreSQL contract coverage in `pnpm test:postgres`. N11.4
allows API runtime composition from `OMNIWA_API_KEY_HASH`,
`OMNIWA_API_KEY_LIFECYCLE_STORE_PATH`, and `SecretProvider` via `OMNIWA_API_KEY_SECRET_NAME` without
retaining plaintext API key configuration; the API process entrypoint now uses `EnvSecretProvider`
for that secret-name path; and provider runtime can encrypt durable Baileys auth-state JSON with
`OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY`. It also exposes admin-only `/v1/api-keys` lifecycle
routes for safe list, provision, revoke, and rotate flows when `OMNIWA_API_KEY_LIFECYCLE_STORE_PATH`
is configured. N11.5 is done for the current production-hardening scope. It wires opt-in API rate
limits from
`OMNIWA_API_RATE_LIMIT_MAX_REQUESTS` and `OMNIWA_API_RATE_LIMIT_WINDOW_MS`, plus optional
endpoint-class limits. It also wires opt-in in-memory denied-decision evidence through
`OMNIWA_API_SECURITY_AUDIT_IN_MEMORY=true`, durable JSON security-audit evidence through
`OMNIWA_API_SECURITY_AUDIT_LOG_PATH`, approved domain `AuditRecord` persistence through
`OMNIWA_API_SECURITY_AUDIT_RECORDS=true` through the selected repository profile's audit repository,
and opt-in repository-backed ownership resolution through
`OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY=true` for resources that already carry explicit or safely
derivable instance ownership, including attached media through its owning message and labels through
their aggregate `instanceId`. PostgreSQL repository coverage now includes Label and MediaAsset for
those ownership paths. Targetless global resources without current instance owner fields now fail
closed for instance-scoped credentials instead of being treated as globally readable. Future owner
modeling for currently global resources that later need instance-scoped access is deferred until the
product requires those filtered read models.
Rate-limit snapshots can now be exported as approved low-cardinality API metric points without raw
key, bucket, instance, or target identifiers. The rate-limit port is now async-compatible and has a
Redis script-store foundation plus the concrete `redis` npm client adapter contained at the approved
API runtime boundary. API runtime composition can select `OMNIWA_API_RATE_LIMIT_BACKEND=redis` from
`OMNIWA_API_RATE_LIMIT_REDIS_URL` or an injected approved Redis script client. Production API
composition now fails closed unless that Redis-backed limiter is configured, security-audit evidence
is routed to domain `AuditRecord` persistence, and repository-backed ownership resolution is
enabled. The Redis adapter remains governed by accepted
`docs/adr/ADR-0008-redis-rate-limit-client.md`.
Production external secret-provider selection and final production-profile validation remain later
hardening work.
N11.6 is done for the current production-hardening scope. The dispatcher runtime has durable restart recovery, retry/dead-letter,
HMAC/timestamp signing, replay verification, metrics, and audit evidence. The completed slice adds a
real `FetchWebhookHttpGateway` foundation with safe timeout/network failure mapping and opt-in local
dispatcher runtime wiring through `OMNIWA_WEBHOOK_DISPATCHER_HTTP_GATEWAY=fetch` plus
`OMNIWA_WEBHOOK_SIGNING_SECRET_NAME`. Controlled
`POST /v1/webhook-deliveries/{deliveryId}/retry` is now public for eligible pending/retrying
deliveries and `POST /v1/webhook-deliveries/{deliveryId}/redrive` is public for eligible
dead-lettered deliveries. `POST /v1/webhook-deliveries/redrive` is also public for selected bulk
redrive of dead-lettered deliveries through a safe operation intent, and
`GET /v1/webhook-deliveries?status=dead_letter` is now covered by a required client-contract
fixture plus Rust SDK helpers and safe remediation reason/category filters. These operations are
synchronized with client-contract fixtures and the Rust SDK.
Webhook dispatcher processing now persists `WebhookDelivery` dispatch outcomes for delivered,
retrying, and dead-lettered deliveries so read surfaces no longer depend only on `WorkerJob` state.
The dispatcher can now opt into `OMNIWA_WEBHOOK_DISPATCHER_QUEUE_PROFILE=durable-worker-job` for the
durable `WorkerJob`-backed queue provider. Webhook dispatcher production profile composition is now
guarded by fail-closed validation and requires PostgreSQL repositories, the durable worker-job queue
profile, fetch HTTP gateway, a configured signing secret value, metric recorder, and webhook dispatch
audit sink before composition is allowed. Runtime composition can satisfy the metric/audit
observability requirement from JSONL sinks configured with
`OMNIWA_WEBHOOK_DISPATCHER_METRICS_JSONL_PATH` and
`OMNIWA_WEBHOOK_DISPATCHER_AUDIT_JSONL_PATH`, and production composition rejects
a shared metric/audit JSONL target path or a configured JSONL target that cannot be opened for
append. `pnpm test:postgres` now includes a production-profile webhook dispatcher validation path
that dispatches through PostgreSQL-backed repositories, the durable worker-job queue profile, fetch
gateway, signing, and JSONL observability when `OMNIWA_POSTGRES_TEST_DATABASE_URL` is configured.
Remaining N11 hardening now moves to N11.7 production validation gates. Richer dead-letter
workflows, target-environment JSONL rotation, richer exporters, and any future receiver-failure
circuit breaker stay as follow-up capabilities unless target-environment evidence makes them
production blockers.
The API runtime production composition path now has an explicit
`OMNIWA_API_QUEUE_PROFILE=durable-worker-job` guard and can route enqueue-side work through the
durable `WorkerJob` queue provider. API request latency is now recorded through the approved
`MetricRecorder` port, and runtime composition can satisfy the API observability adapter requirement
with `OMNIWA_API_METRICS_JSONL_PATH` or an injected recorder. Production composition still fails
closed when the metric recorder is missing; target-environment validation remains required before a
broad production-ready claim.
The first N11.7 validation slice adds a dedicated `pnpm recovery:check` gate for backup/restore
drill evidence, deterministic recovery validation tests, and release-readiness wiring. This proves
the local deterministic recovery contract, while target-environment backup automation and restore
drills remain required before any broad production-ready claim.
The PostgreSQL migration hardening slice adds explicit `pnpm db:migrate:status` and
`pnpm db:migrate` commands backed by the versioned `omniwa_schema_migrations` ledger. Production
promotion still requires target-environment migration evidence, backup verification, and rollback
runbook validation before claiming the database path is production-ready.
The production Docker template hardening slice expands `deploy/docker/compose.production.yml` from
an API-only template to a full runtime template with API, worker, webhook dispatcher, provider
runtime, PostgreSQL, and Redis services. It intentionally keeps worker and provider runtime in
controlled-pilot profiles because true production profiles remain blocked until provider-runtime
IPC/shared socket ownership and target-environment evidence are complete.
The production compose validation slice adds `pnpm docker:production:check` and wires it into
`pnpm production:check`, so the checked-in production template must render successfully with
`deploy/docker/env/production.env.example` and preserve the required service set, hash-only API-key
posture, Redis rate limiting, disabled auto-migration, PostgreSQL API EventLog backend, and
controlled-pilot worker/provider runtime profiles before the root quality gate can pass.
The EventLog/outbox consumer hardening slice adds a generic `EventOutboxConsumer` foundation for
safe pending-outbox drain loops. `ADR-0009` is Accepted, so the async PostgreSQL EventLog backend
migration can proceed in small reviewed slices.
The first EventLog migration slice adds async EventLog/outbox port types plus a sync-to-async
compatibility adapter for the existing in-memory and durable JSON stores. This preserves local/dev
behavior while later slices add PostgreSQL EventLog storage, production runtime wiring, and backlog
metrics.
The follow-up EventLog migration slice makes the generic outbox consumer async-compatible while
retaining sync-store compatibility, so the same consumer can drain future PostgreSQL-backed outbox
records without introducing a parallel runtime loop.
The PostgreSQL EventLog backend slice adds versioned SQL migrations and a
`PostgresqlEventLogStore` behind `AsyncEventLogPort`, with `pnpm test:postgres` proving append
idempotency, monotonic replay cursors, not-found/expired cursor semantics, durable outbox records,
generic outbox consumer drain, and safe failure summaries. Remaining EventLog hardening is now
production runtime wiring plus backlog metrics.
The API EventLog runtime wiring slice makes Application event publication, `GET /v1/events`, and
`/v1/events/stream` async-compatible, adds `OMNIWA_EVENT_LOG_BACKEND=postgresql`, and makes the API
production profile fail closed unless the PostgreSQL EventLog backend is selected. Remaining
EventLog hardening is now production outbox runtime wiring plus backlog metrics.
The production compose validation gate now also verifies `OMNIWA_EVENT_LOG_BACKEND=postgresql`, so
the deployment template cannot drift back to a JSON EventLog path for the API production profile.
The EventLog backlog metrics slice adds the approved `eventlog.outbox.records` catalog metric and
an infrastructure observability helper that records pending/published counts from sync or async
outbox ports without exporting event ids. The background EventLog outbox runtime loop now drains
pending records through an injected publisher and records scheduled backlog metrics. The production
Docker template now declares a background service that wires the PostgreSQL EventLog backend to a
JSONL EventLog outbox publisher and JSONL backlog metrics, and the compose checker verifies that
wiring. Remaining EventLog hardening is now target-environment wiring evidence, dashboards, and
alerting.
Target-environment evidence validation now also requires `Background Runtime` as a first-class
component so the outbox consumer process, publisher evidence, backlog metrics, and shutdown behavior
cannot be omitted from production proof.
The observability validation slice adds a dedicated `pnpm observability:check` gate for metric
catalog, alert definition, dashboard/alert-routing catalog coverage, dependency-readiness, metrics
runtime, health runtime, and release-readiness evidence. It keeps P0-13 visible in the root quality
gate while leaving target-environment dashboard access proof, alert-routing dry-runs, exporter
operations, and sustained SLO monitoring as production-readiness evidence.
The metrics runtime smoke path now exports every approved production catalog metric, including
`eventlog.outbox.records`, through the Prometheus text exporter so local exporter coverage matches
the current metric catalog.
The next N11.7 validation slice adds a dedicated `pnpm e2e:check` gate for deterministic vertical
path evidence. It requires the REST platform regression spec plus the local vertical-slice runtime
spec that proves Application, durable JSON state, queue, worker, provider fake socket, and EventLog
safety without calling the real WhatsApp network.
The security validation slice adds a dedicated `pnpm security:check` gate for API auth, API-key
lifecycle, rate limiting, security audit evidence, resource ownership, webhook signing/replay,
redaction, object-path secrecy, and Baileys auth-state safety.
The performance validation slice adds a dedicated `pnpm performance:check` gate that wraps the local
load baseline and production-cut load evidence. It keeps the deterministic performance floor in the
root quality gate while leaving target-environment load tests and sustained SLO observation as
production-readiness evidence.
The production-cut validation slice now requires explicit target-environment, production-load, and
SLO-evidence proof states. The current review keeps all three as `NO`, which preserves
`CONDITIONALLY_READY` and prevents a future `PRODUCTION_READY` claim until the target environment is
actually exercised.
The target-environment evidence slice adds `pnpm target-env:check` and
`docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` so the remaining proof has a single structured
source. The current status is `NOT_PROVEN`; future production promotion must change that file with
real runtime, load, and SLO evidence.
It also provides the optional `pnpm target-env:smoke` command for deployed API smoke evidence against
`/v1/health`, `/v1/health/readiness`, and `/v1/instances`; the command is operator-run only and is
not executed by the default local quality gate. Operators can set
`OMNIWA_TARGET_ENV_SMOKE_REPORT_PATH` to persist the sanitized smoke summary as target-environment
review evidence.
It also provides the optional `pnpm target-env:load` command for bounded deployed API load evidence
against the same approved public GET endpoint set; the command is operator-run only and is not
executed by the default local quality gate. Operators can set
`OMNIWA_TARGET_ENV_LOAD_REPORT_PATH` to persist the sanitized load summary as target-environment
review evidence, but sustained SLO observation and external dependency capacity proof remain
required before a `PRODUCTION_READY` claim.
It also validates an optional sanitized alert/SLO dry-run artifact through
`OMNIWA_TARGET_ENV_ALERT_SLO_DRY_RUN_REPORT_PATH`, covering dashboard access checks, alert-route
dry-runs, and SLO window/error-budget policy checks without storing dashboard URLs, notification
destinations, raw IDs, JIDs, message text, provider payloads, API keys, or secrets.
It also validates an optional sanitized runtime evidence artifact through
`OMNIWA_TARGET_ENV_RUNTIME_EVIDENCE_REPORT_PATH`, covering runtime startup/readiness/shutdown,
dependency connectivity, migration-status checks, and backup/restore drill references without
storing target URLs, connection strings, raw runtime logs, raw IDs, JIDs, message text, provider
payloads, API keys, session material, or secrets.
It also provides the optional `pnpm target-env:bundle` command for creating a sanitized
operator-maintained evidence bundle from the checked-in `NOT_PROVEN` template and any already
sanitized smoke, load, alert/SLO dry-run, and runtime evidence summaries. The generated bundle
remains non-proving evidence until an operator updates the proof states and component statuses with
target-environment evidence.
When that bundle is supplied back to `pnpm target-env:check`, the gate cross-checks it against
`TARGET_ENVIRONMENT_VALIDATION.md` so review state and artifact state cannot drift.
The required component set includes `Background Runtime`, matching the production compose service
that drains the PostgreSQL EventLog outbox and records backlog metrics.
The production-cut gate also requires the smoke and bundle workflows to be present in the root
scripts and acknowledged by `PRODUCTION_CUT_REVIEW.md`.

## Planned Increments

| Order | Increment                        | Goal                                                                  | Primary Client Value                              | Notes                                                                                                                                                                                                                           |
| ----- | -------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1    | Queue Read Summary               | Implement `GET /v1/queue`                                             | Queue screen can show system state                | Done; keep read-only; no pause/resume yet                                                                                                                                                                                       |
| N2    | Message Read APIs                | Implement message list/status reads                                   | Message screen can render history/status          | Done; read-only; no raw text/JID/provider payload exposed                                                                                                                                                                       |
| N3    | Chat Read APIs                   | Implement chat list/detail reads                                      | Chat navigation becomes usable                    | Done; read-only; no raw JID/provider payload exposed                                                                                                                                                                            |
| N4    | Contact Read APIs                | Implement contact list/detail reads                                   | Send-message UX can select recipients safely      | Done; raw phone/JID not exposed                                                                                                                                                                                                 |
| N5    | Group Read APIs                  | Implement group list/detail/member reads                              | Groups screens become usable                      | Done; no admin mutations yet                                                                                                                                                                                                    |
| N6    | SDK/Client Contract Sync         | Regenerate/check SDK and fixtures for N1-N5                           | `omniwa-tui` can follow contract without guessing | Done inside each increment unless OpenAPI changes                                                                                                                                                                               |
| N7    | VS02 Real WhatsApp Local Demo    | Prove QR, auth persistence, restart, send text, inbound/status events | Runtime confidence before broad mutations         | Done; local live demo only, not production                                                                                                                                                                                      |
| N8    | PostgreSQL Repository Completion | Remove repository durability gaps and runtime hybrid fallbacks        | Platform state survives restart under PostgreSQL  | Done; GitHub Quality Gate `28701511362` passed                                                                                                                                                                                  |
| N9    | Controlled Message Mutations     | Expand send/retry/cancel where state is visible                       | TUI can enable actions safely                     | Done; send/retry/cancel promoted in client contract                                                                                                                                                                             |
| N10   | Controlled Group Mutations       | Add group admin actions behind capability checks                      | Professional group management                     | Done; metadata/local-state/member actions promoted with safe intent storage and audit evidence                                                                                                                                  |
| N11   | Production Hardening             | Close production blockers                                             | Platform moves toward production readiness        | Current; queue, provider ownership, event replay, EventLog outbox loop/production-template wiring, secrets, authorization foundations, and controlled webhook retry are done; target-environment evidence and validation remain |

## Read API Design Rules

Every new read endpoint must satisfy:

- Public REST path is resource-oriented.
- Route does not expose internal command/query handler names.
- API layer calls Interface/Application boundary only.
- Application orchestrates repository/query ports.
- Domain remains free of REST, DTO, database, queue, and provider details.
- Provider/Baileys details do not leak into Domain/Application/API DTOs.
- Response uses the standard success or collection envelope.
- Error uses the standard error envelope.
- Request ID and correlation ID are preserved.
- Pagination, sorting, filtering, and search follow existing API conventions when applicable.

## Client Contract Rules

Every public endpoint promoted to `implemented_public` must update:

- `docs/api/client-contract/omniwa-tui-capabilities.json`.
- `docs/api/client-contract/fixtures/*` with safe sample envelopes.
- `docs/api/OMNIWA_TUI_INTEGRATION.md`.
- OpenAPI if the route does not already exist.
- Rust SDK generated operations if OpenAPI changed.
- Client contract checker allowlist when the endpoint is newly implemented.

`omniwa-tui` should use the capability manifest to feature-gate screens and actions.

## Testing And Quality Gates

Each increment must run the narrow tests for touched packages and then the full gate before commit.

Required final gate:

```sh
pnpm check
```

Expected checks include:

- Lint.
- Typecheck.
- Unit and integration tests.
- Architecture boundary check.
- OpenAPI validation.
- OpenAPI compatibility.
- Client contract check.
- SDK check and SDK tests.
- Regression check.
- Production cut check.
- Release readiness check.

## VS02 Position

VS02 is complete for local live operator validation. It should not be treated as production readiness.

VS02 proved:

- Real QR from `RealBaileysSocketProvider`.
- QR scan works locally.
- Durable JSON auth state persists.
- Restart can reuse auth state.
- Real text send works.
- Inbound/status/connection events enter EventLog/SSE safely.

VS02 does not solve:

- Production encryption for auth state.
- Multi-process socket bridge.
- Production queue engine.
- Production secret management.

## Production Readiness Position

The project should not claim production readiness until the production gates in
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` and formal reviews pass.

Production hardening is now the active track after the platform-client read surface, VS02 local
runtime proof, PostgreSQL repository completion for runtime-exposed paths, controlled message
mutations, and controlled group mutations.

## Decision Summary

The remaining implementation track is:

```text
Message reads
  -> Chat reads
  -> Contact reads
  -> Group reads
  -> SDK/client-contract sync
  -> VS02 real WhatsApp local demo
  -> PostgreSQL repository completion (done)
  -> Controlled mutations
  -> Production hardening (current: N11.7 production validation gates)
```

This order is intentionally incremental, rollbackable, testable, and compatible with the frozen
architecture.
