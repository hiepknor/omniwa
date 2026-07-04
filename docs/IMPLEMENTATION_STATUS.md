# OmniWA Implementation Status

This document is the single source of truth for current implementation progress. It is not a design
freeze document and it does not change frozen product, architecture, domain, application, API,
persistence, infrastructure, or engineering decisions.

Every progress update must be recorded here instead of being scattered across unrelated documents.

## Last Verified

- Date: 2026-07-04
- Branch: `main`
- Evidence basis: source file counts, recent git history, runtime composition files, provider/queue
  adapters, PostgreSQL repository code, and CI workflow status.

## Verification Snapshot

The counts below use two views:

- **Runtime source:** `.ts` files excluding `.spec.ts`, `.test.ts`, and `.d.ts`.
- **Implementation survey:** `.ts` files excluding `.test.ts`; this includes `.spec.ts` contract and
  runtime tests because several implementation packages keep executable evidence in specs.

| Area                                           | Runtime source | Implementation survey |
| ---------------------------------------------- | -------------- | --------------------- |
| `packages/domain/src`                          | 71             | 90                    |
| `packages/application/src`                     | 32             | 43                    |
| `packages/infrastructure-persistence/src`      | 14             | 23                    |
| `packages/infrastructure-provider-baileys/src` | 5              | 9                     |
| `packages/infrastructure-queue/src`            | 2              | 3                     |
| `packages/interface-api/src`                   | 2              | 3                     |
| `apps/api/src`                                 | 10             | 19                    |
| `apps/worker/src`                              | 6              | 11                    |
| `apps/webhook-dispatcher/src`                  | 4              | 7                     |
| `apps/provider-runtime/src`                    | 10             | 19                    |

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

| Area                                                                                             | Design status               | Implementation status                                                                                                        | Evidence                                                                                                                                                                                         | Known gaps                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product / Architecture / Domain / Application / API / Persistence / Infrastructure / Engineering | Frozen                      | Baseline constraints remain active                                                                                           | Freeze documents under `docs/`                                                                                                                                                                   | Do not edit freeze docs for implementation convenience.                                                                                                                             |
| Domain                                                                                           | Frozen                      | Substantial implementation present                                                                                           | 71 runtime source files; aggregates, value objects, events, policies, repository ports, queue/job concepts.                                                                                      | Further behavior must remain inside approved domain boundaries; production readiness is not implied.                                                                                |
| Application                                                                                      | Frozen                      | Substantial implementation present                                                                                           | 32 runtime source files; dispatcher, command/query handling, send text workflow, guardrail flow, event publishing, active session and outbound intent resolution.                                | Controlled message mutations beyond the current path still need explicit implementation and tests.                                                                                  |
| API / Interface                                                                                  | Frozen                      | Public platform API implemented for core read surfaces and selected commands                                                 | `apps/api/src`, `packages/interface-api/src`, OpenAPI checks, client contract checks.                                                                                                            | Broad mutation surface, permission/capability UX, and production-hardening details remain incremental work.                                                                         |
| Persistence                                                                                      | Frozen                      | Partial production path implemented                                                                                          | Durable JSON adapters plus PostgreSQL repository set for Instance, WorkerJob, Message, Session, WebhookSubscription, WebhookDelivery, Chat, Contact, Group, GuardrailDecision, and HealthStatus. | PostgreSQL does not yet cover all catalog ports; MediaAsset, Label, ProviderProfile, AccessDecision, AuditRecord, ConfigurationSnapshot, and TelemetrySignal remain follow-up work. |
| Queue / Jobs                                                                                     | Frozen                      | Functional but not production queue engine                                                                                   | `InMemoryQueueProvider` and PostgreSQL-backed `WorkerJobRepositoryPort` source state.                                                                                                            | Queue provider is still in-memory; distributed leasing, production queue engine, and multi-process queue semantics remain blockers.                                                 |
| Provider / Baileys                                                                               | Frozen                      | Real Baileys provider exists and is isolated                                                                                 | `RealBaileysSocketProvider` imports `makeWASocket` only inside `packages/infrastructure-provider-baileys`; provider runtime composes it.                                                         | Production ownership/lease, production auth-state encryption, and live-network regression automation remain follow-up work.                                                         |
| Runtime apps                                                                                     | Frozen                      | API, worker, webhook dispatcher, provider runtime, background, scheduler, health, metrics, and projection-builder apps exist | `apps/*/src` and runtime composition tests.                                                                                                                                                      | Multi-process socket bridge and production runtime orchestration are not complete.                                                                                                  |
| Webhooks / Events / Realtime                                                                     | Frozen                      | Implemented foundation                                                                                                       | Webhook dispatcher runtime, EventLog/SSE read surfaces, safe provider signal ingestion.                                                                                                          | Replay guarantees, production scaling, and operational alerting need further hardening.                                                                                             |
| SDK / Client contract                                                                            | Active implementation track | Rust SDK foundation and client contract checks present                                                                       | `sdks/rust/omniwa-sdk`, `tooling/sdk`, `docs/api/client-contract`.                                                                                                                               | SDK must stay generated/checked as public API evolves.                                                                                                                              |
| CI / Quality gates                                                                               | Active implementation track | GitHub Actions quality gate configured                                                                                       | `.github/workflows/quality-gate.yml`; runs PostgreSQL contract test before `pnpm check`.                                                                                                         | CI success does not by itself mean production readiness.                                                                                                                            |

## Recent Implementation Evidence

Recent history confirms the repository is no longer a bootstrap-only skeleton:

- `ee96d0f` added the local-live embedded API and real send pipeline.
- `85fd094` closed the VS02 local live demo documentation.
- `3730a5a` through `19a4f71` added and wired PostgreSQL repository coverage.
- `6efbf4e`, `49fecfa`, and `338ba1b` added and fixed the GitHub Actions quality gate with real
  PostgreSQL repository contract tests.

## Known Gaps

- PostgreSQL repository coverage is not complete for the full 18-port catalog.
- The queue provider is still `InMemoryQueueProvider`; WorkerJob state can be PostgreSQL-backed, but
  the queue engine itself is not a production distributed queue.
- Integration and live-network tests intentionally avoid requiring real WhatsApp credentials in normal
  PR validation.
- Multi-process worker/provider-runtime socket sharing is not productionized.
- Auth state durable JSON exists for local/live validation, but production encryption and distributed
  ownership remain open hardening items.
- Controlled message mutations and group/admin mutations need incremental implementation after durable
  state and visibility remain stable.

## Update Rule

Record every progress change here instead of scattering status across other documents.
