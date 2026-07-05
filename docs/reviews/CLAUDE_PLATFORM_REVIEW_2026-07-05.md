# OmniWA Platform Backend Review — 2026-07-05

| Item              | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Review date       | 2026-07-05 Asia/Ho_Chi_Minh                                           |
| Reviewer          | Claude (code + docs review, no source changes)                        |
| Branch            | `main` @ `78fdca2`                                                     |
| Scope             | Architecture, runtime, queue/worker, events/webhooks, persistence, security, observability, production readiness |
| Gates executed    | `pnpm check` = PASS (exit 0), `pnpm test:postgres` = PASS (exit 0, 37 tests, PostgreSQL `127.0.0.1:55432`) |

This review verifies claims against real code, not only documentation. It does not modify runtime
code, freeze documents, or accepted ADRs.

---

## Executive Summary

OmniWA is a well-structured Clean Architecture / DDD monorepo with genuinely enforced boundaries and
a mature, fail-closed production-composition posture. The deterministic local quality gate is broad
and green, PostgreSQL contract tests pass against a real database, and Baileys is fully contained in
its provider adapter. The implementation matches its own status documents honestly — the docs do not
over-claim.

The platform is **conditionally ready for a controlled, single-process internal pilot** with operator
oversight. It is **not production-ready**, and the code confirms the exact blockers the project has
already documented: the durable queue is not safe under concurrent/multi-process workers, the
selected production EventLog/queue durability is partial, and there is no target-environment runtime
evidence. The production Docker compose currently defines only the API service, so the full
multi-process runtime is not yet deployable as-is.

No architecture boundary violations were found. No Baileys leakage was found. No secret-exposure
pattern was found in the reviewed paths.

**Verdict: CONDITIONALLY_READY** — approved only for a controlled internal pilot running a *single*
worker and *single* provider-runtime instance under operator oversight. Explicitly **NOT
PRODUCTION_READY**.

---

## Findings

### Critical

#### C1 — Durable queue is not safe under concurrent or multi-process workers

The `DurableWorkerJobQueueProvider` reserves work with a non-atomic read-then-write and no leasing
primitive:

- `reserve()` calls `findReservableWorkerJob()` (two `findByStatus` reads) and then
  `reserveWorkerJob(...)` + `save(...)` as separate steps, with no `SELECT ... FOR UPDATE SKIP
  LOCKED`, no conditional update, and no lease token.
  `packages/infrastructure-queue/src/durable-worker-job-queue-provider.ts:113`–`139`, `:317`–`329`.
- The persistence layer offers no optimistic concurrency to compensate. `save()` is a plain
  `INSERT ... ON CONFLICT (id) DO UPDATE` (last-write-wins), with no version/`updated_at` guard in
  the `WHERE`/`SET`. `packages/infrastructure-persistence/src/postgresql-aggregate-repository.ts:73`–`80`, `:108`–`146`.
- Reservation identity is deterministic (`reservationRefFor = workType:id:attempt:N`), so two
  workers that both reserve the same queued job compute the *same* `attempt` and `reservationRef`,
  and both pass `assertActiveReservation` at `acknowledge`. Result: the same job can be processed
  and acknowledged twice.
  `durable-worker-job-queue-provider.ts:454`–`476`, `:482`–`484`.

**Impact:** running more than one worker (or provider-runtime consumer) against the same PostgreSQL
`WorkerJob` table can double-send / double-process. This is the documented "cross-process atomic
leasing" gap, now confirmed in code. It caps the pilot at a single worker instance.

#### C2 — Retry back-off / visibility timing is in-process only (not durable, not cross-process)

Retry visibility is stored in a per-instance in-memory map, not in the durable record:

- `private readonly retryVisibleAtByJobId = new Map<string, number>()`
  `durable-worker-job-queue-provider.ts:72`.
- Written on `releaseForRetry` (`:210`), read in `isWorkerJobVisible` for `retrying` jobs (`:356`–`369`).

**Impact:** after a restart the map is empty, so a `retrying` job becomes immediately visible with no
back-off; and a second process never observes the delay set by the first. This breaks retry pacing
and dead-letter timing guarantees across restart/scale, compounding C1. The delay must be persisted
on the `WorkerJob` (e.g. a durable `visibleAt`) for the durable queue to be honest.

### Major

#### M1 — Production runtime is not deployable end-to-end from the shipped compose

`deploy/docker/compose.production.yml` defines **only** the `api` service — there is no `worker`,
`webhook-dispatcher`, `provider-runtime`, PostgreSQL, or Redis. It also injects a **plaintext**
`OMNIWA_API_KEY` and a JSON `OMNIWA_EVENT_LOG_PATH`, and does not set any of the env vars the
production API profile requires (`OMNIWA_API_RATE_LIMIT_BACKEND=redis`,
`OMNIWA_API_SECURITY_AUDIT_RECORDS`, `OMNIWA_API_RESOURCE_OWNERSHIP_REPOSITORY`,
`OMNIWA_API_QUEUE_PROFILE=durable-worker-job`, metrics sink). `deploy/docker/compose.production.yml:1`–`45`.

The file's own comment admits the API rejects `OMNIWA_API_RUNTIME_PROFILE=production` "until
production adapters are wired." This is consistent with `TARGET_ENVIRONMENT_VALIDATION.md` (all rows
PENDING) and is not a boundary violation — but it means the multi-process runtime has never been
exercised together, matching the outstanding N11.7 blocker.

#### M2 — Selected production durability backends for EventLog and queue are still JSON/local

- EventLog is an in-memory store with a JSON persistence subclass and a default retention of **1000
  events**; events beyond that are dropped and replay cursors return `expired`.
  `packages/infrastructure-persistence/src/event-log-store.ts:48`, `:208`–`221`, `:440`–`444`.
- The outbox model exists (`pending`/`published`) but the append path runs in-process handlers
  synchronously; there is no durable outbox *consumer* loop in this path.
  `event-log-store.ts:326`–`352`. Documented as "production outbox consumers" pending.

These are acceptable for a deterministic pilot but are not a production event backbone. Event volume
above the retention window will silently truncate SSE replay history.

#### M3 — No persisted schema-migration path for production PostgreSQL

Schema is created via an opt-in `autoMigrate` barrier
(`postgresql-aggregate-repository.ts:104`–`106`, `runtime-composition.ts:714`–`717`), and
`compose.production.yml` sets `OMNIWA_POSTGRES_AUTO_MIGRATE=false`. There is no versioned migration
tool or forward/rollback migration story for production, so target-environment schema provisioning is
undefined. Track as a production-cut prerequisite (not a code defect).

### Minor

- **N1 — Queue/depth operations are full-table scans.** `enqueue`, `reserve`, `snapshot`, and
  `recordDepthMetric` each issue several `findByStatus` calls and filter in memory
  (`durable-worker-job-queue-provider.ts:289`–`329`, `:371`–`380`). Fine for pilot volumes; will not
  scale and blocks the documented "oldest-pending-age" metric. Pairs with the C1 fix (indexed,
  lease-aware `SELECT`).
- **N2 — Architecture fitness function is import-specifier regex only.**
  `tooling/architecture/check-boundaries.mjs` scans import strings. It reliably catches package-level
  leakage (and correctly enforces Baileys containment) but cannot see type-only re-export coupling or
  runtime indirection. Adequate as a guard; do not treat as a full dependency proof.
- **N3 — Read-only production container with a mounted data volume.** `compose.production.yml` sets
  `read_only: true` plus `OMNIWA_EVENT_LOG_PATH`/`OMNIWA_API_REPOSITORY_STATE_DIR` under a volume; on
  the postgresql profile the JSON paths are unused, so the config is inconsistent/confusing. Clean up
  when M1 is addressed.

### Suggestion

- **S1** — Add an explicit single-worker/single-provider-runtime guardrail (config assertion or
  documented operational constraint) so the pilot cannot accidentally run concurrent consumers before
  C1/C2 are fixed.
- **S2** — When implementing C1, persist a durable `visibleAt`/lease-expiry on `WorkerJob` so C2 is
  resolved in the same change, and add a concurrency contract test that runs two providers against one
  PostgreSQL table asserting single delivery.
- **S3** — Extend `pnpm test:postgres` (or a new gate) with a webhook/worker *concurrency* proof once
  leasing exists, so the multi-process claim can be evidenced locally before target-environment.

---

## Boundary & Isolation Verification (all PASS)

| Check                                       | Result | Evidence                                                                                     |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Baileys contained in provider adapter       | PASS   | No `whiskeysockets/baileys` / `makeWASocket` import outside `packages/infrastructure-provider-baileys` |
| API → Application only (no domain/infra)    | PASS   | `arch:check` rule `api-calls-application-only`; passes in `pnpm check`                        |
| Application uses ports, not adapters        | PASS   | `arch:check` rule `application-uses-ports-not-adapters`                                       |
| Domain has no outer dependencies            | PASS   | `arch:check` rule `domain-has-no-outer-dependencies`                                          |
| Provider payloads not leaked to DTO/persist | PASS   | Public DTO allowlist (`public-resource-dto.ts`), redaction + object-path secrecy tests green |
| API key handling                            | PASS   | sha256 + `timingSafeEqual`, constant-time loop (`apps/api/src/api-key-auth.ts:78`–`105`)      |
| Production API fail-closed guard            | PASS   | Non-local DB creds, Redis limiter, audit records, ownership repo, durable queue, metrics required (`apps/api/src/runtime-composition.ts:776`–`949`) |
| Webhook dispatcher fail-closed guard        | PASS   | Requires PG + durable queue + fetch gateway + signing secret + metric/audit sinks (`apps/webhook-dispatcher/src/runtime-composition.ts:357`–`425`) |

---

## Focus-Area Assessment

1. **Clean Architecture / DDD boundaries** — Strong and enforced. No violations.
2. **Dependency direction (API→Interface→Application→Domain)** — Correct; composition wiring is in
   apps, ports in application, adapters in infrastructure.
3. **Provider / Baileys isolation** — Fully contained.
4. **Runtime composition readiness** — Excellent fail-closed guards; but not exercised as a full
   multi-process deployment (M1).
5. **Queue / worker / retry / dead-letter** — Deterministic single-worker path is correct and tested;
   concurrent/multi-process is unsafe (C1, C2). **Top blocker.**
6. **EventLog / SSE / webhook** — Webhook reliability (retry/dead-letter/signing/replay) is solid;
   EventLog/outbox durability is partial (M2).
7. **PostgreSQL persistence consistency** — 14 aggregates covered and contract-tested; no optimistic
   concurrency (feeds C1); 4 ports + migration story outstanding (M3).
8. **Security** — Strong: hashed/timing-safe API keys, production guards reject dev/local creds,
   opt-in audit/ownership/rate-limit, secret-provider path, optional auth-state encryption.
9. **Observability / SLO / recovery** — Deterministic gates exist and pass; target-environment
   dashboards/alert routing/exporters and sustained SLO observation are not proven (as documented).
10. **N11.7 production blockers** — Confirmed open: Target Environment Proven / Production Load Proven
    / SLO Evidence Proven all `NO`.

---

## Production Blockers (must clear before PRODUCTION_READY)

1. **C1 + C2** — Atomic, durable, cross-process queue leasing with persisted visibility/back-off.
2. **M1** — Full multi-process production deployment definition exercised in the target environment.
3. **M2** — Selected production EventLog/outbox backend with durable consumers and adequate retention.
4. **M3** — Versioned production schema migration path.
5. **Target-environment evidence** — Runtime/dependency matrix, production-like load, and SLO/alert
   dry-run recorded in `TARGET_ENVIRONMENT_VALIDATION.md` (currently `NOT_PROVEN`).

---

## Top 10 Next Actions (incremental, rollbackable)

1. Add a durable `visibleAt` (and lease token/expiry) column to `WorkerJob`; persist retry back-off
   there instead of the in-memory map (fixes C2). Rollback: drop column, revert provider.
2. Implement lease-based `reserve()` using `SELECT ... FOR UPDATE SKIP LOCKED` (or conditional
   `UPDATE ... WHERE status='queued'/'retrying' AND visibleAt<=now RETURNING`) in a PostgreSQL-aware
   queue path (fixes C1). Keep the in-memory provider for tests. Rollback: revert to scan-based path.
3. Add a two-consumer concurrency contract test in `pnpm test:postgres` asserting single delivery
   (evidence for C1/C2).
4. Add an explicit single-worker/single-provider operational guard + doc note for the pilot (S1)
   until 1–3 land.
5. Select and wire a production EventLog/outbox backend (or PostgreSQL-backed EventLog) with a
   durable outbox consumer and configurable retention (M2). Rollback: env-flag back to JSON.
6. Add a versioned migration tool and a `migrate`/`migrate:status` script; set the production path to
   apply migrations explicitly (M3).
7. Expand `compose.production.yml` to the full runtime (api, worker, webhook-dispatcher,
   provider-runtime, external PostgreSQL + Redis references) with the required production env vars, so
   the production profile is composable (M1). Rollback: keep pilot compose alongside.
8. Reconcile `compose.production.yml` env (plaintext key, unused JSON paths, `read_only` + volume) to
   match the postgresql/production profile (N3).
9. Add oldest-pending-age and queue-depth metrics from an indexed query once leasing exists (N1),
   feeding the SLO catalog.
10. Run the operator target-environment workflow (`pnpm target-env:smoke` / `:load` / `:bundle`) in a
    real deployment and populate `TARGET_ENVIRONMENT_VALIDATION.md` toward `PROVEN`.

---

## Verdict

**CONDITIONALLY_READY** (maps to **READY_FOR_INTERNAL_PILOT** under strict constraints):

- Allowed: single-tenant, single-environment internal pilot, single worker + single provider-runtime,
  limited traffic, explicit operator oversight.
- Not allowed: concurrent/multi-worker operation (C1/C2), public production platform claim,
  enterprise/customer-critical use, unbounded traffic.

**NOT PRODUCTION_READY.** Target-environment runtime, production-like load, and SLO/alert evidence are
absent, and the durable queue is not multi-process safe. These are correctly reflected in the
project's own status and cut-review documents; this review found no dishonest readiness claims.

---

## Gate Evidence (this review)

| Command              | Result                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `pnpm check`         | PASS (exit 0) — lint, typecheck, tests, arch, OpenAPI, SDK, security, e2e, recovery, performance, target-env, production, release gates |
| `pnpm test:postgres` | PASS (exit 0) — 37 tests across PostgreSQL repositories, provider-runtime ownership guard, webhook dispatcher PostgreSQL composition, DB `127.0.0.1:55432` |
