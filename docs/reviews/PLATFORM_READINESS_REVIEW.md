# OmniWA Platform Architecture Readiness Review

## Review Metadata

| Item            | Value                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Review date     | 2026-07-01 Asia/Ho_Chi_Minh                                                                                                            |
| Review stance   | Production-grade platform backend readiness                                                                                            |
| Review roles    | Principal Software Architect, Platform Architect, Distributed Systems Reviewer, API Architect, Security Reviewer, Reliability Engineer |
| Scope           | `apps/`, `packages/`, `docs/`, `docs/platform-evolution/`, `docs/adr/`, `sdk/`, and repo quality gates                                 |
| Output decision | This is a review only. No code, API, schema, or runtime implementation was changed.                                                    |

## Executive Summary

OmniWA is a strong platform architecture foundation, but it is not yet a production-grade platform backend.

The repository has good architecture discipline: package boundaries are explicit, Baileys is isolated to one provider adapter, the Domain model is meaningful, the Application layer has coherent command/query catalogs and ports, REST/OpenAPI/SDK foundations exist, and automated architecture/OpenAPI/release gates pass.

The main blocker is not architecture direction. The blocker is implementation depth. The platform still lacks a real production composition path:

- no concrete Application command/query dispatcher that executes approved use cases end to end,
- API standalone runtime falls back to an unavailable dispatcher,
- worker, provider-runtime, webhook-dispatcher, metrics, and health apps are still shells or partial runtime helpers,
- durable persistence is file-backed JSON, not the approved PostgreSQL production source of truth,
- no migration/schema management,
- no production queue engine,
- no real API key lifecycle, hashing, rotation, revocation, or rate limiting,
- public API response bodies still expose generic Application outcome shapes instead of stable resource DTOs.

Production-grade verdict: **NOT READY**.

Development readiness verdict: **Development Ready** with good architecture guardrails.

## Evidence Base

The findings below are based on these current repository facts:

| Area               | Evidence                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root gates         | `package.json` has `lint`, `typecheck`, `test`, `arch:check`, `openapi:check`, `sdk:check`, `release:check`, and `check`.                                                                                                                                                         |
| Architecture gate  | `tooling/architecture/check-boundaries.mjs` enforces key forbidden imports across `apps/` and `packages/`.                                                                                                                                                                        |
| API runtime        | `apps/api/src/http-server.ts` implements Node `http` REST/SSE routing, API key auth, envelopes, request IDs, and Application adapter mapping.                                                                                                                                     |
| API fallback       | `apps/api/src/http-server.ts` creates `createUnavailableDispatcher()` when no dispatcher is injected.                                                                                                                                                                             |
| Interface boundary | `packages/interface-api/src/api-interface-adapter.ts` maps API requests to Application command/query envelopes and enforces scopes/boundaries.                                                                                                                                    |
| Domain model       | `packages/domain/src/index.ts` exports Instance, Session, Message, Media, Group, Chat, Contact, Label, Webhook, WorkerJob, ProviderProfile, Audit, Health, Configuration, Telemetry, Guardrails, Access, events, policies, specs, factories, and repository ports.                |
| Application model  | `packages/application/src/commands/command-catalog.ts` and `packages/application/src/queries/query-catalog.ts` define approved commands and queries.                                                                                                                              |
| Persistence        | `packages/infrastructure-persistence/src/in-memory-repositories.ts` and `durable-json-repositories.ts` implement in-memory and JSON-backed repositories.                                                                                                                          |
| Provider           | `packages/infrastructure-provider-baileys/src/baileys-messaging-provider.adapter.ts` isolates Baileys behind `MessagingProviderPort`.                                                                                                                                             |
| Queue              | `packages/infrastructure-queue/src/in-memory-queue-provider.ts` implements an in-memory queue provider.                                                                                                                                                                           |
| Webhook            | `packages/infrastructure-webhook/src/webhook-transport.adapter.ts` and `webhook-dispatcher-runtime.ts` implement transport and dispatcher helpers.                                                                                                                                |
| SDK                | `sdk/rust/omniwa-sdk` has generated operations, resource wrappers, typed envelopes, blocking HTTP transport, and tests.                                                                                                                                                           |
| OpenAPI            | `docs/api/openapi/omniwa-v1.openapi.json` defines 71 operations with `/v1` paths and generic envelope schemas.                                                                                                                                                                    |
| Runtime apps       | `apps/worker/src/index.ts`, `apps/provider-runtime/src/index.ts`, `apps/webhook-dispatcher/src/index.ts`, `apps/metrics/src/index.ts`, and `apps/health/src/index.ts` are empty exports; `apps/scheduler`, `apps/background`, and `apps/projection-builder` have runtime helpers. |
| Design freezes     | Architecture, Domain, Application, API, Persistence, Infrastructure, and Engineering planning are frozen in `docs/*_FREEZE.md`.                                                                                                                                                   |
| Platform ADRs      | `docs/adr/ADR-0001..0007` define proposed platform boundary, REST API, SDK, query model, realtime, groups domain, and public contract.                                                                                                                                            |

## 1. Architecture Review

### Summary

| Area                   | Result   | Assessment                                                                                                                |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Clean Architecture     | KEEP     | Package direction is mostly correct and enforced by tooling.                                                              |
| DDD                    | KEEP     | Domain types, aggregates, policies, specs, and events are explicit and test-covered.                                      |
| Hexagonal Architecture | KEEP     | Ports exist for provider, queue, media, session store, webhook transport, read model, and event bus.                      |
| Ports and Adapters     | KEEP     | Infrastructure packages implement ports without interface imports; Baileys is isolated.                                   |
| CQRS                   | WARNING  | Command/query catalogs and read model ports exist, but query projections are generic and not fully runtime-wired.         |
| Modular Monolith       | KEEP     | Monorepo package layout supports modular monolith boundaries.                                                             |
| Dependency Inversion   | KEEP     | Domain/Application do not depend on concrete infrastructure or Baileys.                                                   |
| Runtime composition    | CRITICAL | There is no production composition that wires REST -> dispatcher -> application use cases -> repositories/queue/provider. |

### Dependency Direction

Current direction is strong:

```text
shared
  <- domain
  <- application
  <- interface-api

infrastructure-* -> application/domain/shared
apps/* -> selected public packages
Baileys -> only infrastructure-provider-baileys
```

The architecture boundary check enforces:

- Domain must not import Application, Interface, Infrastructure, or Baileys.
- Application must not import Interface, Infrastructure, or Baileys.
- Interface API must not bypass Application.
- Infrastructure must not import Interface API.
- Baileys imports are limited to `packages/infrastructure-provider-baileys`.

### Coupling and Cohesion

KEEP:

- Domain cohesion is high. Aggregates are small and lifecycle-focused.
- Infrastructure adapters are separated by technical concern.
- Interface API has a clear adapter role.
- SDK has no backend package dependency and uses public OpenAPI operation IDs.

WARNING:

- `apps/api/src/http-server.ts` contains a large route table, validation, auth extraction, envelope mapping, and SSE handling in one file. It is acceptable for a foundation but will become hard to maintain.
- The OpenAPI checker validates route coverage and envelope presence, but not semantic compatibility or response DTO stability.
- No general circular dependency detector exists beyond the custom forbidden-import rules.

CRITICAL:

- Application layer has catalogs, envelopes, ports, and strategies, but no complete command/query handler implementation for production behavior.
- API runtime cannot execute real product behavior unless an external dispatcher is injected. The standalone server defaults to unavailable responses.

## 2. Domain Review

### Domain Quality

| Domain                    | Verdict           | Notes                                                                                                                       |
| ------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Instance                  | KEEP              | Clear lifecycle aggregate with status transitions and action-required state.                                                |
| Session                   | KEEP              | Correctly separated from Instance; protects recovery and session lifecycle semantics.                                       |
| Message                   | KEEP              | Good message lifecycle model with guardrail acceptance and status transitions.                                              |
| MediaAsset                | KEEP              | Correct supporting aggregate for metadata/retention separate from Message.                                                  |
| WebhookSubscription       | KEEP              | Good lifecycle ownership for webhook configuration.                                                                         |
| WebhookDelivery           | KEEP              | Good retry/dead-letter visibility model.                                                                                    |
| GuardrailDecision         | KEEP              | Correct core domain for compliance/product guardrails.                                                                      |
| ProviderProfile           | KEEP              | Useful anti-corruption vocabulary for capability and provider health.                                                       |
| WorkerJob                 | KEEP              | Good visible async work lifecycle; should remain durable and source-of-truth.                                               |
| AccessDecision            | KEEP              | Correct supporting domain for privileged/capability decisions.                                                              |
| AuditRecord               | KEEP              | Good concept, but production audit generation across all public operations is not complete.                                 |
| HealthStatus              | KEEP              | Useful supporting health projection domain.                                                                                 |
| ConfigurationSnapshot     | KEEP              | Good validated configuration concept; runtime activation is not fully wired.                                                |
| TelemetrySignal           | WARNING           | Acceptable as generic observability domain, but must not become business state.                                             |
| Group                     | KEEP WITH WARNING | Good first-class domain; embedded `members` and `actions` arrays may grow unbounded under real high-volume group admin use. |
| Chat                      | KEEP              | Useful navigation/read domain, not core business.                                                                           |
| Contact                   | KEEP              | Useful navigation/read domain; needs stricter PII handling in public DTOs.                                                  |
| Label                     | KEEP              | Useful navigation/read domain; low risk.                                                                                    |
| Broadcast/Campaign        | REMOVE/DO NOT ADD | Correctly out of scope for responsible-use posture.                                                                         |
| EventLog                  | ADD               | Required for replayable realtime/platform event visibility; current event stream is static source based.                    |
| Log Query                 | ADD               | Required for operational platform support; logger contracts exist but no log store/read API exists.                         |
| API Key / Client Identity | ADD               | Required for production auth lifecycle, hashing, rotation, revocation, and audit.                                           |

### Aggregate Review

Strengths:

- Aggregates are immutable-style objects with explicit transition functions.
- Invalid lifecycle transitions are centralized through `transitionStatus`.
- Value objects exist for IDs, JID, phone number, retry policy, idempotency key, webhook URL, and safe domain codes.
- Domain events are aggregate-created facts.
- Repository ports map to aggregate roots.

Warnings:

- Many aggregate operations throw `TypeError`; production Application handling must convert these into explicit domain/application errors.
- `Group` currently owns members, actions, invite link, and local state in one aggregate. This is acceptable now, but high-volume member events or audit history may require splitting action history into a separate aggregate/read model.
- Domain model is stronger than the Application implementation. The domain is ready to be used, but many use cases are still cataloged rather than executed.

Missing for production:

- EventLog aggregate/projection with retention and replay cursor semantics.
- API key/client identity aggregate.
- Operational log record model.
- Concrete domain/application service implementations that execute the command catalog against repositories and ports.

## 3. Platform Boundary Review

| Boundary      | Result  | Assessment                                                                                                                |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Public API    | WARNING | Resource paths are public and do not expose command names, but response data still contains generic Application outcomes. |
| Internal API  | KEEP    | `ApiInterfaceAdapter` is internal and maps to command/query names.                                                        |
| Transport     | WARNING | Node `http` transport exists and is testable; production middleware stack is minimal.                                     |
| Provider      | KEEP    | Baileys is isolated behind `MessagingProviderPort` and adapter/gateway types.                                             |
| Persistence   | WARNING | Ports are clean, but implementation is in-memory/JSON, not production DB.                                                 |
| Configuration | WARNING | Contracts exist, but runtime provider and activation wiring are incomplete.                                               |
| SDK           | KEEP    | SDK boundary exists and does not contain business logic.                                                                  |

The platform boundary is correctly designed but not fully implemented as a production platform.

Most important leak: public REST `data` contains `ApplicationCommandOutcome` or `ApplicationQueryOutcome` shapes such as `kind: "query_outcome"` and `outcome: "result"` in current route tests. That is internal orchestration vocabulary leaking through public API responses.

## 4. Public Contract Review

### Current Public Surface

Current OpenAPI has 71 operations covering:

- health/readiness/action-required,
- metrics/dashboard/queue,
- instances/sessions,
- messages/media,
- jobs,
- webhooks/webhook deliveries,
- provider capabilities,
- settings,
- audit records,
- events/SSE,
- groups,
- chats,
- contacts,
- labels.

### Contract Assessment

| Contract Area          | Result       | Notes                                                                                                                                                |
| ---------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST API               | WARNING      | Routes exist, but some are explicit `501` partials and no production dispatcher is wired by default.                                                 |
| OpenAPI                | KEEP/WARNING | OpenAPI 3.1 exists and is checked, but most response schemas use `PublicData` rather than typed resource DTOs.                                       |
| Versioning             | KEEP         | `/v1` major versioning exists.                                                                                                                       |
| Backward compatibility | WARNING      | Policy exists, but no OpenAPI diff/breaking-change gate exists.                                                                                      |
| Error model            | KEEP         | Standard error envelope exists with code/message/details/meta.                                                                                       |
| Response model         | WARNING      | Envelope exists; payload is not stable resource DTO.                                                                                                 |
| Pagination             | WARNING      | Cursor params are documented; HTTP runtime does not pass list query params into Application criteria.                                                |
| Filtering              | WARNING      | Documented conceptually; runtime route handlers do not implement filters.                                                                            |
| Sorting                | WARNING      | Documented conceptually; runtime route handlers do not implement sorting.                                                                            |
| Cursor                 | WARNING      | SSE cursor is implemented; collection cursor is schema/documentation-level only.                                                                     |
| Authentication         | WARNING      | `x-api-key` exists; only env/static key source exists.                                                                                               |
| Authorization          | WARNING      | Scopes and boundary checks exist; ownership checks are shallow and instance-boundary checks only inspect `targetRef` values that start with `inst_`. |
| Rate limiting          | CRITICAL     | Documented but no runtime implementation.                                                                                                            |
| Idempotency            | WARNING      | Header is passed to Application; no durable idempotency store or replay/conflict semantics are complete.                                             |
| Request ID             | KEEP         | `x-request-id` is accepted and returned.                                                                                                             |
| Correlation ID         | KEEP         | `x-correlation-id` is accepted or generated and returned.                                                                                            |
| Contract stability     | WARNING      | OpenAPI/SDK drift gate exists; semantic compatibility and DTO stability are not mature.                                                              |

### Public Contract Blockers

1. Replace generic Application outcome response data with typed resource DTOs.
2. Implement query parameter mapping for cursor, limit, filters, search, and sorting.
3. Add API key resource lifecycle, hash storage, rotation, revocation, and audit.
4. Add rate limiting and abuse throttling at the API boundary.
5. Add OpenAPI breaking-change/diff gate.
6. Add ownership-aware authorization for non-instance IDs such as `messageId`, `groupId`, `webhookId`, and `deliveryId`.

## 5. Persistence Review

### Current State

KEEP:

- Repository ports are Domain-owned and aggregate-specific.
- In-memory repositories are good for tests.
- Durable JSON adapter is useful as a transitional contract adapter.
- Durable JSON writes via temp-file replace, which is better than direct overwrite.
- Read projection catalog is extensive and maps queries to projections.

CRITICAL:

- No PostgreSQL implementation exists despite Persistence Freeze selecting PostgreSQL as durable source of truth.
- No schema, migrations, table design, indexes, partitioning, or migration runner exist.
- No real transaction/unit-of-work implementation exists.
- No concurrency control, optimistic locking, leasing, or multi-process safety exists for repository writes.
- Durable JSON storage rewrites whole files and has no cross-repository atomicity.

WARNING:

- JSON repositories persist implementation indexes but not production indexes.
- Query methods scan in-memory maps or JSON-loaded records, unsuitable for large datasets.
- Projection store is generic and key-based; it does not yet provide production read model query behavior.
- The design docs are much stronger than the implementation.

Production-grade persistence requires a reviewed PostgreSQL adapter, migration strategy, repository contract tests, rollback plan, backup/restore integration, and operational metrics.

## 6. Messaging and Event Review

| Area               | Result   | Assessment                                                                                    |
| ------------------ | -------- | --------------------------------------------------------------------------------------------- |
| Domain Events      | KEEP     | Event contracts and domain events are well-modeled.                                           |
| Integration Events | WARNING  | Conceptual and SSE-safe event envelopes exist, but production event log/outbox is missing.    |
| Webhook Events     | WARNING  | Webhook transport and dispatcher helper exist; runtime app wiring is missing.                 |
| Queue              | WARNING  | In-memory QueueProvider exists; production Redis/queue adapter is missing.                    |
| Worker             | CRITICAL | Worker runtime is an empty app; no job handler composition exists.                            |
| Retry              | WARNING  | Domain retry policy and queue retry exist; no production worker retry orchestration.          |
| Dead Letter        | WARNING  | Domain/queue helpers exist; no operational dead-letter management surface.                    |
| Ordering           | CRITICAL | No production event/job ordering guarantees are implemented.                                  |
| Idempotency        | WARNING  | Key types and maps exist; no durable platform-wide idempotency semantics.                     |
| Replay             | WARNING  | SSE static replay by cursor exists; event persistence and retention-bound replay are missing. |
| Event Versioning   | KEEP     | Event versioning is documented and SSE event types include `.v1`.                             |

The event model is good. The runtime event pipeline is not production-grade.

## 7. Provider Architecture

KEEP:

- Provider integration is isolated in `@omniwa/infrastructure-provider-baileys`.
- Baileys imports are contained by architecture checks.
- `MessagingProviderPort` is Application-owned.
- Adapter converts provider failures into safe `ApplicationPortFailure`.
- Provider capability summary exists.

WARNING:

- `BaileysSocketGateway` depends on externally provided socket/resolver abstractions; there is no concrete provider runtime that owns socket lifecycle, reconnection, QR state, session restore, backpressure, or signal subscription.
- Group provider capabilities exist at the domain/profile level, but no runtime implementation proves group admin/message operations against provider capability.
- Provider versioning/upgrade policy is documented but not enforced by tests beyond dependency pinning and adapter tests.

CRITICAL:

- `apps/provider-runtime/src/index.ts` is empty. There is no production provider runtime process.
- No one-active-provider-runtime-per-instance enforcement exists in runtime code.
- No real Baileys connection manager, session persistence integration, or provider signal loop exists.

## 8. Security Review

KEEP:

- Secret values are wrapped by `SecretValue` and redact through `toJSON`/`toString`.
- Observability redaction exists for public/internal/confidential/secret values.
- API uses `x-api-key` and scopes.
- API differentiates public/admin/monitoring/internal runtime boundaries.
- Webhook transport supports signing-secret references and does not expose the secret value.
- Path segments are constrained to safe token characters.
- Request body size limit exists at 1 MB.

WARNING:

- API key comparison uses direct string equality, not a constant-time hash-based verification flow.
- API key source is static env/config injection; no key resource lifecycle exists.
- Default env scopes for `OMNIWA_API_KEY` are broad, including group admin and webhook write/read.
- No replay protection for mutating API requests beyond idempotency key forwarding.
- No runtime CSRF/CORS/TLS/reverse-proxy trust boundary implementation.
- Validation is structural/minimal; no schema-level DTO validation.
- No audit trail is wired for every public operation.
- Webhook verification is outbound-signature-reference oriented; concrete HMAC/timestamp/replay behavior is deferred.

CRITICAL:

- No rate limiter exists.
- No production secret provider adapter exists; `packages/infrastructure-secrets/src/index.ts` is empty.
- No API key hashing, storage, rotation, revocation, or least-privilege management surface exists.
- No ownership-aware authorization for all resource IDs exists.

## 9. Reliability Review

KEEP:

- WorkerJob, retry policy, dead-letter reason, queue reservation, and webhook retry concepts are modeled.
- Scheduler helper can enqueue scheduled work using idempotent windows.
- Background recovery validation logic exists.
- Health state model and in-memory observability runtime exist.

WARNING:

- API has no graceful shutdown logic beyond Node server basics.
- HTTP transport does not implement server-level timeouts, keep-alive policy, request concurrency limit, or backpressure.
- SDK blocking transport has timeout support but no retry/circuit breaker.
- Queue provider is in-memory and not multi-process.
- Durable JSON adapter has no lock/lease model.
- No central runbook-backed incident/rollback implementation.

CRITICAL:

- Worker runtime is not implemented.
- Provider runtime is not implemented.
- Production queue, retry, timeout, circuit breaker, and dead-letter operation are not wired end to end.
- No actual readiness endpoint checks dependencies because standalone API has no dependency graph.

## 10. Observability Review

KEEP:

- Structured logger interface exists.
- Metrics and tracing model exists.
- Redaction rules exist and are tested.
- Health checks and in-memory observability runtime exist.
- Request/correlation IDs are carried through API and SDK.

WARNING:

- No production logger/exporter backend is wired.
- No metrics app runtime implementation exists.
- No tracing exporter/OpenTelemetry runtime is wired.
- No alerting rules, dashboards, or SLO enforcement exist.
- Logs are write-only/in-memory contract level; no safe log query/read model exists.
- API route handlers do not emit structured logs/metrics/spans for all operations.

## 11. Performance Review

WARNING:

- Node `http` foundation is lightweight, but route matching is a long sequential if-chain.
- Request bodies are fully buffered up to 1 MB; no streaming upload handling for media.
- JSON persistence rewrites whole aggregate repository/projection files.
- In-memory repositories scan records for many queries.
- Read projections are generic and not optimized for large list/search/sort use cases.
- No batching, paging enforcement, or max-limit runtime policy exists for list APIs.
- SSE replay uses retained in-memory/static event arrays.

CRITICAL:

- No production database indexes or query plans exist.
- No load tests or performance budgets are enforced.
- No production queue/backpressure implementation exists.

## 12. Testing Strategy Review

Current test evidence:

- 49 package spec files under `packages/**/src`.
- 6 app spec files under `apps/**/src`.
- 3 Rust SDK test files under `sdk/rust/omniwa-sdk/tests`.
- `pnpm check` runs lint, typecheck, Vitest, architecture check, OpenAPI check, SDK check, and release readiness.
- `cargo test` validates Rust SDK tests.

KEEP:

- Good unit/model tests for Domain, Application catalogs, adapters, queue, persistence, webhook, observability, API transport, and SDK fixtures.
- Architecture check catches major dependency violations.
- OpenAPI route coverage check exists.
- Release readiness check verifies required runtime/package evidence.

WARNING:

- Tests are mostly unit/contract level; few end-to-end runtime tests exist.
- No real Application dispatcher/use-case integration tests.
- No real API -> application -> repository -> queue/provider path test.
- No database migration/repository integration tests for PostgreSQL.
- No provider runtime integration tests.
- No load/performance tests.
- No security tests for rate limiting, auth replay, key rotation, webhook signature verification, or log leakage beyond redaction unit tests.
- No chaos/recovery tests for worker/provider/webhook runtime.

## 13. Documentation Review

KEEP:

- Documentation depth is unusually strong.
- Freeze documents cover product, architecture, domain, application, API, persistence, infrastructure, and engineering planning.
- ADRs exist for architecture and platform evolution.
- Platform evolution docs explain incremental migration and risks.
- README is a good project portal.
- AI Runtime Kit exists for agent workflows.

WARNING:

- Some `docs/platform-evolution/*` files are stale relative to current code. Example: `ARCHITECTURE_INVENTORY.md`, `PLATFORM_GAP_REPORT.md`, and `RECOMMENDATION.md` still state no REST/OpenAPI/SDK or fixture-only SDK in places, while the repo now has REST/OpenAPI/SDK hardening.
- ADR-0001..0007 are still marked `Proposed` even though several decisions have been implemented.
- There is no production operations runbook tied to concrete runtime commands.
- No migration docs for actual DB schema because no schema exists.
- No API Explorer docs or generated human API reference beyond OpenAPI.

## 14. Production Readiness

| Level                     | Verdict | Reason                                                                                                                                                                |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development Ready         | YES     | Architecture, docs, tests, and package boundaries are strong enough for continued implementation.                                                                     |
| Internal Production Ready | NO      | No production dispatcher, runtime composition, DB, queue, provider runtime, auth lifecycle, rate limiting, or operational observability.                              |
| Public Platform Ready     | NO      | Public contract lacks typed DTO stability, durable idempotency, key lifecycle, rate limits, production docs/runbooks, and reliable runtime paths.                     |
| Enterprise Ready          | NO      | Missing HA, multi-node coordination, audit completeness, compliance hardening, SSO/OAuth/RBAC, backups/restore implementation, security program, and SLO enforcement. |

## 15. Top 20 Technical Debt

| Priority | Debt                                                                        | Impact                                                                          |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P0       | No concrete Application command/query dispatcher/use-case implementation    | API cannot execute real product behavior end to end.                            |
| P0       | API standalone runtime uses unavailable dispatcher fallback                 | Starting `apps/api` alone does not produce a working platform backend.          |
| P0       | Worker runtime app is empty                                                 | Async accepted work cannot be processed in production.                          |
| P0       | Provider runtime app is empty                                               | WhatsApp/Baileys connection lifecycle and provider signals are not operational. |
| P0       | No PostgreSQL adapter/schema/migrations                                     | Durable production state cannot be managed or evolved.                          |
| P0       | No production queue engine                                                  | WorkerJob semantics cannot survive multi-process production operation.          |
| P0       | No API key lifecycle, hashing, rotation, revocation, or management API      | Authentication is not production secure.                                        |
| P0       | No rate limiting or abuse throttling                                        | Platform can be abused and cannot enforce guardrails at transport level.        |
| P1       | Public response payloads expose generic Application outcomes                | Public contract is not stable resource-oriented API.                            |
| P1       | No typed resource DTOs in OpenAPI/SDK                                       | Client compatibility and developer experience remain weak.                      |
| P1       | Query params for pagination/filter/sort are not wired into runtime requests | List APIs are not production useful for large datasets.                         |
| P1       | No ownership-aware authorization for all resource IDs                       | Cross-resource access control can be incomplete.                                |
| P1       | Webhook dispatcher app is empty despite package helper                      | Webhook delivery is not an operational runtime.                                 |
| P1       | Metrics and health apps are empty                                           | Operational visibility cannot be exported/run independently.                    |
| P1       | EventLog/outbox/replay persistence is missing                               | Realtime/SSE cannot be reliable or replayable across restarts.                  |
| P1       | No production secret provider adapter                                       | Session/API/webhook secrets cannot be managed safely.                           |
| P2       | Route table and validation in one large file                                | Maintainability risk as API grows.                                              |
| P2       | `dist/` and `tsconfig.tsbuildinfo` are present in repo                      | Source/build artifact boundary is noisy and can cause churn.                    |
| P2       | Platform ADRs remain Proposed after implementation                          | Governance state is ambiguous.                                                  |
| P3       | Some platform-evolution docs are stale                                      | Reviewers may rely on outdated status.                                          |

## 16. Risk Assessment

| Risk Category         | Level  | Assessment                                                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Architecture risk     | Medium | Direction is good; implementation is incomplete. Main risk is drift while filling runtime gaps.               |
| Operational risk      | High   | Runtime composition, workers, provider lifecycle, queues, DB, metrics, health, and runbooks are incomplete.   |
| Security risk         | High   | API key lifecycle, rate limit, secret provider, resource authorization, and audit completeness are missing.   |
| Maintenance risk      | Medium | Good docs and package boundaries reduce risk; large route file and stale docs increase it.                    |
| Scalability risk      | High   | JSON/in-memory adapters, no indexes, no queue engine, and no event log are not scalable.                      |
| Migration risk        | Medium | Repository ports help future DB migration; lack of current schema means first migration is still significant. |
| Compatibility risk    | High   | Public DTOs are generic; OpenAPI/SDK exists but resource model is not stable enough.                          |
| Future evolution risk | Medium | Modular architecture supports growth, but missing production foundations block safe expansion.                |

## 17. Recommendation: Incremental Roadmap

Do not rewrite. Evolve in small, rollbackable phases.

### Phase K - Application Dispatcher and Use Case Execution

Goal:

- Implement concrete Application dispatcher for the highest-priority command/query paths.

Deliverables:

- Dispatcher composition package.
- Use-case handlers for health, instance list/status, create/connect/disconnect, message send, jobs, webhooks.
- Repository/queue/provider ports injected.
- Contract tests for command/query outcomes.

Rollback:

- Keep current `ApiInterfaceAdapter`; disable new dispatcher injection.

### Phase L - Production Runtime Composition

Goal:

- Turn runtime apps into executable processes.

Deliverables:

- API app wired to dispatcher and dependencies.
- Worker app with job handler registry.
- Provider runtime app with socket lifecycle boundary.
- Webhook dispatcher app wiring package runtime helper.
- Health/metrics runtime wiring.

Rollback:

- Per-app process disable and dependency injection fallback.

### Phase M - PostgreSQL Persistence Adapter

Goal:

- Replace JSON adapter for production state.

Deliverables:

- Physical model review.
- Migration runner.
- PostgreSQL repository adapter.
- Transaction/unit-of-work implementation.
- Repository contract tests against PostgreSQL.

Rollback:

- Adapter-level rollback to durable JSON in non-production environments.

### Phase N - Production Queue and Worker Reliability

Goal:

- Implement durable queue mechanics behind `QueueProviderPort`.

Deliverables:

- Redis-backed or reviewed queue implementation.
- Lease/visibility timeout, retry, dead-letter, idempotency, concurrency controls.
- Worker recovery and metrics.

Rollback:

- Route selected work types back to in-memory only for local/dev.

### Phase O - Public Contract Stabilization

Goal:

- Make REST/OpenAPI/SDK stable for platform clients.

Deliverables:

- Resource DTOs for each public resource.
- Request DTO validation.
- Pagination/filter/search/sort runtime mapping.
- OpenAPI breaking-change gate.
- SDK typed resource models.

Rollback:

- Additive endpoint versions or feature flags for unstable DTOs.

### Phase P - Security Hardening

Goal:

- Make auth/authz/rate-limit/secrets audit-ready.

Deliverables:

- API key aggregate/repository/service.
- Hash-based constant-time verification.
- Rotation/revocation.
- Rate limiter.
- Resource ownership resolver.
- Audit for public operations.
- Secret provider adapter.

Rollback:

- Keep env key only for local development profile.

### Phase Q - EventLog, Realtime, and Webhook Reliability

Goal:

- Make events replayable and operationally reliable.

Deliverables:

- EventLog/outbox persistence.
- SSE backed by retained event log.
- Webhook signature HMAC/timestamp/replay policy.
- Webhook dispatcher process and DLQ management.

Rollback:

- Disable SSE stream; preserve polling APIs.

### Phase R - Observability and Operations

Goal:

- Make the platform operable.

Deliverables:

- Structured logs to runtime backend.
- Prometheus/OpenTelemetry exporters or compatible adapters.
- SLI/SLO dashboards.
- Health/readiness dependency checks.
- Backup/restore runbooks and restore drills.
- Load/performance baseline.

Rollback:

- Keep in-memory observability for local tests.

## 18. Final Assessment Scores

| Area                     | Score / 100 | Rationale                                                                                                       |
| ------------------------ | ----------: | --------------------------------------------------------------------------------------------------------------- |
| Architecture             |          78 | Strong package boundaries and ADRs; runtime composition missing.                                                |
| Domain Design            |          76 | Good aggregates and policies; some domains need production splitting/read models later.                         |
| API Design               |          61 | Broad REST/OpenAPI surface exists; resource DTOs, query params, and contract stability are incomplete.          |
| Security                 |          42 | Good redaction concepts; missing rate limit, key lifecycle, secret provider, ownership auth, replay protection. |
| Reliability              |          38 | Retry/job concepts exist; worker/provider/queue/db runtime reliability missing.                                 |
| Performance              |          40 | No production DB/index/query/queue/load path; JSON/in-memory adapters only.                                     |
| Observability            |          50 | Models exist; exporters, metrics app, logs store, alerting, and runtime instrumentation incomplete.             |
| Maintainability          |          74 | Good docs and package structure; route file size, stale docs, and generated artifacts add friction.             |
| Documentation            |          82 | Very strong design docs; platform-evolution drift and Proposed ADR statuses need cleanup.                       |
| Testing                  |          64 | Good unit/contract tests; no end-to-end production path, load, DB, provider, or security tests.                 |
| Overall Platform Quality |          57 | Solid architecture foundation, not production-grade runtime platform yet.                                       |

## FINAL VERDICT

**NOT READY**

OmniWA is not production-grade as an independent platform backend today.

It is ready for continued implementation under strong architecture controls, but it is not ready for internal production, public platform use, or enterprise use.

### Production Blockers

Before OmniWA can be considered a professional production platform, these blockers must be resolved:

1. Implement real Application dispatcher/use-case handlers.
2. Wire API runtime to real dispatcher and dependencies by default for non-test profiles.
3. Implement Worker runtime and job handler registry.
4. Implement Provider runtime with Baileys socket lifecycle, session restore, signal translation, and one-owner-per-instance guard.
5. Implement PostgreSQL persistence adapter, migrations, transaction strategy, indexes, and repository contract tests.
6. Implement production queue adapter with leasing, retry, dead-letter, concurrency, recovery, and metrics.
7. Replace generic public response payloads with stable typed resource DTOs.
8. Implement list pagination/filter/search/sort in runtime, not only docs/OpenAPI.
9. Implement API key lifecycle with hashed storage, constant-time verification, rotation, revocation, least privilege, and audit.
10. Implement API rate limiting and abuse/guardrail throttling.
11. Implement ownership-aware authorization for all resource IDs.
12. Implement production SecretProvider adapter.
13. Implement EventLog/outbox persistence and SSE replay from durable events.
14. Wire webhook dispatcher as an app and complete concrete signing/replay verification.
15. Add production observability exporters, health/readiness dependency checks, dashboards, and alerts.
16. Add backup/restore implementation and restore drills.
17. Add E2E tests for REST -> Application -> Domain -> Persistence/Queue/Provider paths.
18. Add security tests for auth, rate limit, replay, redaction, webhook signing, and resource ownership.
19. Add load/performance tests and baseline budgets.
20. Update stale platform-evolution docs and ADR statuses.

## Quality Gate Report

These gates were run after the review document was created.

| Gate                | Result | Notes                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check` | FAIL   | Prettier reported 192 existing files that are not formatted, including many `.omniwa/*`, `docs/*`, and a few source files. The new review file was formatted separately with `pnpm exec prettier --write docs/reviews/PLATFORM_READINESS_REVIEW.md`. This is a repository hygiene failure, not a functional test failure.               |
| `pnpm check`        | PASS   | `lint`, `typecheck`, `test`, `arch:check`, `openapi:check`, `sdk:check`, and `release:check` passed. Vitest: 56 test files passed, 210 tests passed. Architecture boundary check passed for 211 source files. OpenAPI check passed for 71 operations. Rust SDK foundation check passed. Release readiness check passed with 0 findings. |
| `cargo test`        | PASS   | Rust SDK tests passed: 0 library tests, 9 `fixture_client` tests, 2 `http_transport` tests, 3 `platform_clients` tests, and 0 doc tests.                                                                                                                                                                                                |
| `git diff --check`  | PASS   | No whitespace errors were found in the current diff.                                                                                                                                                                                                                                                                                    |

## Files Changed

| File                                        | Purpose                                     |
| ------------------------------------------- | ------------------------------------------- |
| `docs/reviews/PLATFORM_READINESS_REVIEW.md` | Production-grade platform readiness review. |
