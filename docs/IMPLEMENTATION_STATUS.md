# OmniWA Implementation Status

This document is the single source of truth for current implementation progress. It is not a design
freeze document and it does not change frozen product, architecture, domain, application, API,
persistence, infrastructure, or engineering decisions.

Every progress update must be recorded here instead of being scattered across unrelated documents.

## Last Verified

- Date: 2026-07-05
- Branch: `main`
- Evidence basis: source file counts, recent git history, runtime composition files, provider/queue
  adapters, PostgreSQL repository code, local `pnpm check`, and CI workflow status.

## Current Platform Increment

| Increment                             | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                     | Next                                  |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| N11 - Production Hardening            | Active | N11 starts after N8/N9/N10 are complete. N11.0 reconciled the backlog, N11.1 added durable WorkerJob queue foundation, N11.2 confirmed durable EventLog replay, N11.3 added provider runtime ownership hardening, and N11.4 added hashed/lifecycle/SecretProvider-backed API-key runtime configuration, API process SecretProvider wiring, encrypted durable Baileys auth-state support, and admin API-key lifecycle routes. | N11.5 - Authorization and Rate Limits |
| N10 - Controlled Group Mutations      | Done   | Local `pnpm check` passed after enabling metadata/local-state/add/remove/promote/demote group mutations with safe intent storage, group capability checks, audit action evidence, client-contract fixtures, and Rust SDK fixture coverage.                                                                                                                                                                                   | N11 - Production Hardening            |
| N9 - Controlled Message Mutations     | Done   | Local `pnpm check` passed after enabling controlled text send, retry, and cancel handlers, client-contract fixtures, checker allowlist, TUI integration docs, and Rust SDK retry/cancel fixture coverage.                                                                                                                                                                                                                    | Completed predecessor for N10         |
| N8 - PostgreSQL Repository Completion | Done   | Local `pnpm test:postgres` passed against `127.0.0.1:55432`; GitHub Actions Quality Gate run `28701511362` passed with real PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                                                                                                   | Completed predecessor for N9          |

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
| `packages/infrastructure-provider-baileys/src` | 5              | 9                     |
| `packages/infrastructure-queue/src`            | 3              | 5                     |
| `packages/interface-api/src`                   | 2              | 3                     |
| `apps/api/src`                                 | 10             | 20                    |
| `apps/worker/src`                              | 6              | 11                    |
| `apps/webhook-dispatcher/src`                  | 4              | 7                     |
| `apps/provider-runtime/src`                    | 11             | 21                    |

Verification commands used:

```sh
for d in packages/domain/src packages/application/src packages/infrastructure-persistence/src packages/infrastructure-provider-baileys/src packages/infrastructure-queue/src packages/interface-api/src apps/api/src apps/worker/src apps/webhook-dispatcher/src apps/provider-runtime/src; do
  printf '%-48s ' "$d"
  find "$d" -type f -name '*.ts' ! -name '*.spec.ts' ! -name '*.test.ts' ! -name '*.d.ts' | wc -l | tr -d ' '
done

for d in packages/domain/src packages/application/src packages/infrastructure-persistence/src packages/infrastructure-provider-baileys/src packages/infrastructure-queue/src packages/interface-api/src apps/api/src apps/worker/src apps/webhook-dispatcher/src apps/provider-runtime/src; do
  printf '%-48s ' "$d"
  find "$d" -type f -name '*.ts' | rg -v '\.test\.' | wc -l | tr -d ' '
done
```

## Design vs Implementation Status

| Area                                                                                             | Design status               | Implementation status                                                                                                        | Evidence                                                                                                                                                                                                                                                                      | Known gaps                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product / Architecture / Domain / Application / API / Persistence / Infrastructure / Engineering | Frozen                      | Baseline constraints remain active                                                                                           | Freeze documents under `docs/`                                                                                                                                                                                                                                                | Do not edit freeze docs for implementation convenience.                                                                                                                             |
| Domain                                                                                           | Frozen                      | Substantial implementation present                                                                                           | 71 runtime source files; aggregates, value objects, events, policies, repository ports, queue/job concepts.                                                                                                                                                                   | Further behavior must remain inside approved domain boundaries; production readiness is not implied.                                                                                |
| Application                                                                                      | Frozen                      | Substantial implementation present                                                                                           | 34 runtime source files; dispatcher, command/query handling, send/retry/cancel text workflows, guardrail flow, event publishing, active session and outbound intent resolution.                                                                                               | Production hardening remains incremental work.                                                                                                                                      |
| API / Interface                                                                                  | Frozen                      | Public platform API implemented for core read surfaces, selected commands, and admin API-key lifecycle operations            | `apps/api/src`, `packages/interface-api/src`, OpenAPI checks, client contract checks, API process composition that can read API key material through `EnvSecretProvider` when `OMNIWA_API_KEY_SECRET_NAME` is configured, and admin `/v1/api-keys` lifecycle routes.          | Broad mutation surface, permission/capability UX, rate-limit hardening, and production-hardening details remain incremental work.                                                   |
| Persistence                                                                                      | Frozen                      | Partial production path implemented                                                                                          | Durable JSON adapters plus PostgreSQL repository set for Instance, WorkerJob, Message, Session, WebhookSubscription, WebhookDelivery, Chat, Contact, Group, GuardrailDecision, and HealthStatus.                                                                              | PostgreSQL does not yet cover all catalog ports; MediaAsset, Label, ProviderProfile, AccessDecision, AuditRecord, ConfigurationSnapshot, and TelemetrySignal remain follow-up work. |
| Queue / Jobs                                                                                     | Frozen                      | Durable queue foundation present                                                                                             | `InMemoryQueueProvider`, `DurableWorkerJobQueueProvider`, and PostgreSQL-backed `WorkerJobRepositoryPort` source state.                                                                                                                                                       | Cross-process atomic leasing, oldest-pending-age metrics, and final production queue semantics remain blockers.                                                                     |
| Provider / Baileys                                                                               | Frozen                      | Real Baileys provider exists and is isolated                                                                                 | `RealBaileysSocketProvider` imports `makeWASocket` only inside `packages/infrastructure-provider-baileys`; provider runtime composes durable local and PostgreSQL ownership lease guards with active lease renewal and optional encrypted durable Baileys auth-state storage. | Production profile validation and live-network regression automation remain follow-up work.                                                                                         |
| Runtime apps                                                                                     | Frozen                      | API, worker, webhook dispatcher, provider runtime, background, scheduler, health, metrics, and projection-builder apps exist | `apps/*/src` and runtime composition tests.                                                                                                                                                                                                                                   | Multi-process socket bridge and production runtime orchestration are not complete.                                                                                                  |
| Webhooks / Events / Realtime                                                                     | Frozen                      | Durable EventLog/replay foundation present                                                                                   | Webhook dispatcher runtime, durable JSON EventLog/outbox, SSE read surfaces, restart replay tests, and safe provider signal ingestion.                                                                                                                                        | Production outbox consumers, selected production EventLog backend, backlog metrics, production scaling, and alerting need further hardening.                                        |
| SDK / Client contract                                                                            | Active implementation track | Rust SDK foundation and client contract checks present                                                                       | `sdks/rust/omniwa-sdk`, `tooling/sdk`, `docs/api/client-contract`.                                                                                                                                                                                                            | SDK must stay generated/checked as public API evolves.                                                                                                                              |
| CI / Quality gates                                                                               | Active implementation track | GitHub Actions quality gate passing                                                                                          | `.github/workflows/quality-gate.yml`; run `28701511362` passed PostgreSQL contract tests before `pnpm check`.                                                                                                                                                                 | CI success does not by itself mean production readiness.                                                                                                                            |

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

## Known Gaps

- N8 PostgreSQL repository completion is done for the runtime paths already exposed through the
  platform API. PostgreSQL coverage is still not complete for the full 18-port catalog.
- N11.1 adds a durable WorkerJob-backed queue provider. Cross-process atomic leasing and final
  production queue semantics remain open hardening work.
- N11.2 durable EventLog/outbox/SSE replay foundation is present. Production outbox consumers,
  selected production EventLog backend, and EventLog backlog metrics remain open hardening work.
- N11.3 added durable local and PostgreSQL provider-runtime ownership lease guards, active lease
  renewal during the supervisor drain loop, and PostgreSQL contract coverage in `pnpm test:postgres`.
  Production profile enablement remains blocked by secret hardening and final production validation.
- Integration and live-network tests intentionally avoid requiring real WhatsApp credentials in normal
  PR validation.
- Controlled message retry is intentionally text-only in the current N9 scope; media retry remains a
  follow-up capability.
- Multi-process worker/provider-runtime socket sharing is not productionized.
- N11.4 allows API runtime composition from `OMNIWA_API_KEY_HASH`,
  `OMNIWA_API_KEY_LIFECYCLE_STORE_PATH`, and `SecretProvider` via `OMNIWA_API_KEY_SECRET_NAME`
  without keeping plaintext API key configuration. The API process entrypoint now selects
  `EnvSecretProvider` for that secret-name path. Provider runtime can also encrypt durable Baileys
  auth-state JSON with `OMNIWA_BAILEYS_AUTH_STATE_ENCRYPTION_KEY`; older unencrypted local auth-state
  files remain readable for compatibility. Admin `/v1/api-keys` lifecycle routes can list,
  provision, revoke, and rotate safe key records when the lifecycle store is configured; responses do
  not expose plaintext keys or `sha256:` hashes. Production external secret provider selection and
  final production-profile validation remain open hardening items.
- N11 production hardening is active. N11.4 secret and API-key hardening has passed local
  `pnpm check`; the current planned hardening step is N11.5 authorization and rate limits. Broader
  production claims remain blocked until N11 gates pass.

## Update Rule

Record every progress change here instead of scattering status across other documents.
