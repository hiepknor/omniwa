# OmniWA Implementation Status

This document is the single source of truth for current implementation progress. It is not a design
freeze document and it does not change frozen product, architecture, domain, application, API,
persistence, infrastructure, or engineering decisions.

This file records the current snapshot only. Completed increment narratives live in
`docs/platform-evolution/N11_HARDENING_LOG.md`.

## Last Verified

- Date: 2026-07-06
- Branch: `main`
- Evidence basis: source file counts, recent git history, runtime composition files, provider/queue
  adapters, PostgreSQL repository code, local `pnpm check`, and CI workflow status.

## Current Platform Increment

N11.7 production validation is active. It is the final N11 hardening increment before
target-environment evidence collection can drive a production-readiness decision.

| Increment                             | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Next                          |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| N11 - Production Hardening            | Active | N11.0-N11.6 are done (queue foundation, durable EventLog/outbox, provider ownership, secret/API-key hardening, authorization/rate limits, webhook reliability). N11.7 validation gates, production compose template, PostgreSQL EventLog backend, migrations CLI, provider bridge, and target-environment evidence tooling are in place. See `docs/platform-evolution/N11_HARDENING_LOG.md`. | N11.7 - Production Validation |
| N10 - Controlled Group Mutations      | Done   | See `docs/platform-evolution/N11_HARDENING_LOG.md` (Pre-N11 Milestone Evidence).                                                                                                                                                                                                                                                                                                             | N11 - Production Hardening    |
| N9 - Controlled Message Mutations     | Done   | See `docs/platform-evolution/N11_HARDENING_LOG.md` (Pre-N11 Milestone Evidence).                                                                                                                                                                                                                                                                                                             | Completed predecessor for N10 |
| N8 - PostgreSQL Repository Completion | Done   | Local `pnpm test:postgres` passed against `127.0.0.1:55432`; GitHub Actions Quality Gate run `28701511362` passed with real PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                                                                   | Completed predecessor for N9  |

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

| Area                                                                                             | Design status               | Implementation status                                                                                                        | Evidence                                                                                                                                                                                                                                                                                          | Known gaps                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product / Architecture / Domain / Application / API / Persistence / Infrastructure / Engineering | Frozen                      | Baseline constraints remain active                                                                                           | Freeze documents under `docs/`                                                                                                                                                                                                                                                                    | Do not edit freeze docs for implementation convenience.                                                                                             |
| Domain                                                                                           | Frozen                      | Substantial implementation present                                                                                           | 71 runtime source files; aggregates, value objects, events, policies, repository ports, queue/job concepts.                                                                                                                                                                                       | Further behavior must remain inside approved domain boundaries; production readiness is not implied.                                                |
| Application                                                                                      | Frozen                      | Substantial implementation present                                                                                           | Dispatcher, command/query handling, send/retry/cancel text workflows, guardrail flow, event publishing, active session and outbound intent resolution, async EventLog/outbox ports.                                                                                                               | Production hardening remains incremental work.                                                                                                      |
| API / Interface                                                                                  | Frozen                      | Public platform API implemented for core read surfaces, selected commands, and admin API-key lifecycle operations            | `apps/api/src`, `packages/interface-api/src`, OpenAPI/client-contract checks, SecretProvider-backed API-key composition, admin `/v1/api-keys` routes, Redis-backed rate limiting, AuditRecord security-audit persistence, repository-backed ownership resolution, fail-closed production profile. | Broad mutation surface, permission/capability UX, and full ownership resolver coverage for future instance-owned resources remain incremental work. |
| Persistence                                                                                      | Frozen                      | Partial production path implemented                                                                                          | Durable JSON adapters plus PostgreSQL repository set for Instance, WorkerJob, Message, Session, MediaAsset, Label, WebhookSubscription, WebhookDelivery, Chat, Contact, Group, GuardrailDecision, AuditRecord, and HealthStatus.                                                                  | PostgreSQL does not yet cover all catalog ports; ProviderProfile, AccessDecision, ConfigurationSnapshot, and TelemetrySignal remain follow-up work. |
| PostgreSQL migrations                                                                            | Frozen                      | Explicit operational migration path present                                                                                  | Versioned `omniwa_schema_migrations` ledger, `runPostgresqlSqlMigrations`, `getPostgresqlSqlMigrationStatus`, root `pnpm db:migrate:status` / `pnpm db:migrate` with credential-redacted output.                                                                                                  | Production deployment still needs target-environment migration evidence and backup/rollback procedure validation.                                   |
| Queue / Jobs                                                                                     | Frozen                      | Durable queue foundation present                                                                                             | `InMemoryQueueProvider`, `DurableWorkerJobQueueProvider`, PostgreSQL atomic reservation with `FOR UPDATE SKIP LOCKED`, durable retry visibility, expired lease recovery in `pnpm test:postgres`, and cataloged `queue.backlog.*` metrics.                                                         | Final target-environment production queue validation remains follow-up hardening work.                                                              |
| Provider / Baileys                                                                               | Frozen                      | Real Baileys provider exists and is isolated                                                                                 | `RealBaileysSocketProvider` imports `makeWASocket` only inside `packages/infrastructure-provider-baileys`; provider runtime composes lease guards, encrypted auth-state storage, production-profile guardrails, and command bridge wiring.                                                        | Target-environment live-network regression automation remains follow-up work.                                                                       |
| Runtime apps                                                                                     | Frozen                      | API, worker, webhook dispatcher, provider runtime, background, scheduler, health, metrics, and projection-builder apps exist | `apps/*/src`, runtime composition tests, provider bridge contract/fake tests, and a production Docker template with API, worker, webhook dispatcher, provider runtime, background, PostgreSQL, and Redis services.                                                                                | Target-environment orchestration evidence is not complete.                                                                                          |
| Webhooks / Events / Realtime                                                                     | Frozen                      | Durable EventLog/replay and webhook dispatcher reliability foundations present                                               | Webhook dispatcher runtime, PostgreSQL EventLog backend, generic `EventOutboxConsumer`, background outbox runtime loop, SSE read surfaces, restart replay tests, retry/dead-letter handling, HMAC/timestamp signing, replay verification, and fetch gateway wiring.                               | Production scaling, target-environment proof, dashboards, and alerting need further hardening.                                                      |
| SDK / Client contract                                                                            | Active implementation track | Rust SDK foundation and client contract checks present                                                                       | `sdks/rust/omniwa-sdk`, `tooling/sdk`, `docs/api/client-contract`.                                                                                                                                                                                                                                | SDK must stay generated/checked as public API evolves.                                                                                              |
| CI / Quality gates                                                                               | Active implementation track | GitHub Actions quality gate passing                                                                                          | `.github/workflows/quality-gate.yml`; run `28701511362` passed PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                                     | CI success does not by itself mean production readiness.                                                                                            |

## Open Gaps

Gaps that remain open right now. Closed increment details are in
`docs/platform-evolution/N11_HARDENING_LOG.md`.

- PostgreSQL coverage is not complete for the full 18-port catalog: ProviderProfile, AccessDecision,
  ConfigurationSnapshot, and TelemetrySignal remain follow-up work.
- Production migration execution needs target-environment evidence, backup verification, and
  rollback runbook validation.
- Final production queue validation (durable profile, atomic reservation, retry recovery,
  dead-letter, expired lease recovery) needs target-environment runtime evidence.
- EventLog/outbox target-environment wiring evidence, dashboards, and alerting remain open.
- The production Docker template is a deployment template only. Target-environment startup,
  production load, SLO evidence, Provider Runtime runtime proof, and provider-runtime bridge
  round-trip evidence remain open before any production-ready claim.
- Production external secret-provider selection and final production-profile validation remain open.
- Controlled message retry is intentionally text-only (N9 scope); media retry is a follow-up
  capability.
- Integration and live-network tests intentionally avoid requiring real WhatsApp credentials in
  normal PR validation; real WhatsApp/Baileys validation stays operator-controlled.
- `Target Environment Proven`, `Production Load Proven`, and `SLO Evidence Proven` are all `NO` in
  `docs/reviews/PRODUCTION_CUT_REVIEW.md`, and
  `docs/reviews/TARGET_ENVIRONMENT_VALIDATION.md` is `NOT_PROVEN`. `PRODUCTION_READY` cannot be
  claimed until operators collect and validate target-environment evidence through the
  `pnpm target-env:*` workflow.

## Update Rule

- Record the current state here; keep entries as one-line snapshots, not narratives.
- When an increment or gap closes, move its narrative to
  `docs/platform-evolution/N11_HARDENING_LOG.md` (or the successor log) and delete it from this
  file.
- Do not duplicate status prose into plan documents; link to this file instead.
