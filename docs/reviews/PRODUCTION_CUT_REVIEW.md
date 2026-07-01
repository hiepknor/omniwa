# OmniWA Production Cut Review

## Review Metadata

| Item         | Value                                                  |
| ------------ | ------------------------------------------------------ |
| Review date  | 2026-07-01 Asia/Ho_Chi_Minh                            |
| Review type  | Production cut readiness                               |
| Source plan  | `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` |
| Prior review | `docs/reviews/PLATFORM_READINESS_REVIEW.md`            |

## Final Decision

Final readiness decision: CONDITIONALLY_READY

Production Ready: NO

Enterprise Ready: NO

OmniWA is conditionally ready for a controlled internal pilot cut of the
approved platform slice. This is not approval for broad public platform
operation, enterprise/customer-critical use, or unbounded traffic.

## Decision Basis

The repository now has automated gates for:

- architecture boundaries,
- OpenAPI contract shape,
- OpenAPI compatibility,
- Rust SDK foundation,
- production regression,
- public resource DTO stability,
- runtime collection query semantics,
- load baseline,
- release readiness,
- backup/restore drill evidence,
- observability/dependency readiness evidence.

`pnpm check` is the authoritative local quality gate.

## Load Baseline

Baseline command:

```text
pnpm load:check
```

Baseline scope:

- in-process REST adapter,
- authenticated GET requests across health, instance list, instance status,
  and message history resources,
- deterministic Application dispatcher stub,
- no real WhatsApp network,
- no external database,
- no external webhook receiver,
- no cloud services.

Budget:

| Metric                   | Budget                 |
| ------------------------ | ---------------------- |
| Request count            | 400                    |
| P95 REST adapter latency | <= 50 ms               |
| Throughput               | >= 250 requests/second |
| 5xx error rate           | 0                      |

This baseline is intentionally conservative and local. It establishes a
repeatable regression floor, not a final capacity model for deployed
infrastructure.

## Production Gate

Production gate command:

```text
pnpm production:check
```

The production gate verifies:

- production cut review evidence exists,
- load baseline evidence exists,
- root scripts wire load and production gates,
- load tests cannot pass with no tests,
- final decision is explicit,
- known constraints are recorded.

## Known Constraints

- Production Ready remains blocked until deployment-specific production
  adapters and configuration are supplied and exercised in the target
  environment.
- The PostgreSQL direction is frozen, but the repository still carries
  transitional JSON/in-memory adapters for local and deterministic testing.
- The current load baseline is in-process and does not prove external network,
  database, queue, object storage, or provider capacity.
- Baileys/WhatsApp provider behavior cannot be considered production-proven
  until environment-specific credentials, session restore, and provider
  failure handling are validated outside deterministic stubs.
- Enterprise readiness remains out of scope until sustained operations,
  enterprise auth/RBAC/SSO, mature support processes, and HA requirements are
  proven.

## Gate Status

| Gate                     | Status | Evidence                                      |
| ------------------------ | ------ | --------------------------------------------- |
| Architecture             | PASS   | `pnpm arch:check`                             |
| OpenAPI                  | PASS   | `pnpm openapi:check`                          |
| OpenAPI compatibility    | PASS   | `pnpm openapi:compat`                         |
| SDK                      | PASS   | `pnpm sdk:check`, `pnpm sdk:test`             |
| Regression               | PASS   | `pnpm regression:check`                       |
| Public DTO contract      | PASS   | `PR-17_PUBLIC_RESOURCE_DTO_CONTRACT.md`       |
| Collection query runtime | PASS   | `PR-18_RUNTIME_COLLECTION_QUERY_SEMANTICS.md` |
| Load baseline            | PASS   | `pnpm load:check`                             |
| Release readiness        | PASS   | `pnpm release:check`                          |
| Full local gate          | PASS   | `pnpm check`                                  |

## Gate 2 Review

Gate 2 `PRODUCTION READY` is not approved.

| Gate 2 Condition                                                  | Status  | Evidence                                                                          | Notes                                                                                                                                   |
| ----------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| All P0 blockers are closed                                        | FAIL    | `apps/api/src/runtime-composition.ts`, `apps/api/src/runtime-composition.spec.ts` | Production profile still intentionally fails fast until production persistence, secret, queue, and observability adapters are supplied. |
| `P1-01` typed public DTOs                                         | PASS    | `docs/platform-evolution/PR-17_PUBLIC_RESOURCE_DTO_CONTRACT.md`                   | Public collection data is mapped through resource DTO allowlists.                                                                       |
| `P1-02` runtime pagination/filter/search/sort                     | PASS    | `docs/platform-evolution/PR-18_RUNTIME_COLLECTION_QUERY_SEMANTICS.md`             | Runtime collection semantics apply on sanitized public DTO fields.                                                                      |
| `P1-03` OpenAPI breaking-change/diff gate                         | PASS    | `pnpm openapi:compat`, `docs/api/API_COMPATIBILITY_POLICY.md`                     | Compatibility baseline and deprecation metadata gate are active.                                                                        |
| E2E/security/load/release/architecture/OpenAPI/SDK/recovery gates | PASS    | `pnpm check`                                                                      | Local gates pass for the deterministic platform slice.                                                                                  |
| SLOs, dashboards, alerts, runbooks, and incident response usable  | PARTIAL | `docs/runbooks/*`, `packages/observability/src/alerts.ts`                         | Runbooks and alert definitions exist; deployed dashboards and sustained SLO observation are not proven.                                 |
| No critical security or reliability findings remain open          | FAIL    | `docs/reviews/PLATFORM_READINESS_REVIEW.md`, known constraints below              | Production runtime/adapters and target-environment validation remain open reliability blockers.                                         |
| Public contract compatibility and deprecation policy              | PASS    | `docs/api/API_COMPATIBILITY_POLICY.md`, `pnpm openapi:compat`                     | Contract compatibility is enforced locally.                                                                                             |

### Remaining Production Ready Blockers

| Blocker                                               | Impact                                                                                                                                   | Required Evidence Before `PRODUCTION_READY`                                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Production profile is guarded off                     | OmniWA cannot honestly claim a deployable production profile while runtime composition rejects production startup.                       | Production profile starts with approved production persistence, secret, queue, observability, and configuration adapters.                |
| Production adapters are not target-environment proven | In-memory/JSON deterministic paths do not prove multi-process durability, secret management, provider lifecycle, or dependency recovery. | Target-environment validation for PostgreSQL, queue, secret provider, provider runtime, webhook dispatcher, and observability exporters. |
| Load baseline is local/in-process only                | Current numbers do not prove network, database, queue, object storage, webhook receiver, or provider capacity.                           | Production-like load test with documented endpoint budgets, bottlenecks, and error budget impact.                                        |
| Operational SLO/dashboard evidence is incomplete      | Runbooks and alert definitions exist, but sustained operational visibility is not proven.                                                | Usable dashboards/alerts tied to SLOs with at least one dry-run incident/recovery exercise.                                              |

## Allowed Use

- controlled internal pilot planning,
- single-tenant, single-environment validation,
- limited traffic,
- explicit operator oversight,
- no broad public platform claim.

## Not Allowed

- public production platform claim,
- enterprise/customer-critical deployment,
- unbounded automation traffic,
- client business logic outside backend,
- bypassing SDK -> REST -> Application -> Domain boundary.

## Summary

The architecture remains frozen. Implementation can move into production pilot
hardening under the documented constraints. Any material change to platform
boundaries, public contract, persistence direction, provider strategy, or
security posture still requires a new ADR.
