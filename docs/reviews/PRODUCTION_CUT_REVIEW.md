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

| Gate                  | Status | Evidence                          |
| --------------------- | ------ | --------------------------------- |
| Architecture          | PASS   | `pnpm arch:check`                 |
| OpenAPI               | PASS   | `pnpm openapi:check`              |
| OpenAPI compatibility | PASS   | `pnpm openapi:compat`             |
| SDK                   | PASS   | `pnpm sdk:check`, `pnpm sdk:test` |
| Regression            | PASS   | `pnpm regression:check`           |
| Load baseline         | PASS   | `pnpm load:check`                 |
| Release readiness     | PASS   | `pnpm release:check`              |
| Full local gate       | PASS   | `pnpm check`                      |

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
