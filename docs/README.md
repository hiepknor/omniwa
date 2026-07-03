# OmniWA Documentation Portal

This directory is the source of truth for OmniWA product, architecture, domain, application, API,
persistence, infrastructure, engineering, and platform-evolution decisions.

Use this portal to find the right document before changing code or implementation plans.

## Status

| Area                 | Status                      | Primary Document                                                                                   |
| -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Product Definition   | Frozen                      | [FREEZE_PHASE_0.md](FREEZE_PHASE_0.md)                                                             |
| Architecture         | Frozen                      | [architecture/ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)                         |
| Domain               | Frozen                      | [domain/DOMAIN_FREEZE.md](domain/DOMAIN_FREEZE.md)                                                 |
| Application          | Frozen                      | [application/APPLICATION_FREEZE.md](application/APPLICATION_FREEZE.md)                             |
| API                  | Frozen                      | [api/API_FREEZE.md](api/API_FREEZE.md)                                                             |
| Persistence          | Frozen                      | [persistence/PERSISTENCE_FREEZE.md](persistence/PERSISTENCE_FREEZE.md)                             |
| Infrastructure       | Frozen                      | [infrastructure/INFRASTRUCTURE_FREEZE.md](infrastructure/INFRASTRUCTURE_FREEZE.md)                 |
| Engineering Planning | Frozen                      | [engineering/IMPLEMENTATION_FREEZE.md](engineering/IMPLEMENTATION_FREEZE.md)                       |
| Platform Evolution   | Active Implementation Track | [platform-evolution/NEXT_DEVELOPMENT_PLAN.md](platform-evolution/NEXT_DEVELOPMENT_PLAN.md)         |
| Production Readiness | Not Ready Until Gates Pass  | [platform-evolution/PRODUCTION_EXECUTION_PLAN.md](platform-evolution/PRODUCTION_EXECUTION_PLAN.md) |

## Directory Map

| Directory             | Purpose                                                                                         | Start Here                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `.`                   | Product definition, phase handoffs, glossary, risks, success metrics.                           | [VISION.md](VISION.md), [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md), [DECISIONS.md](DECISIONS.md)       |
| `architecture/`       | Clean Architecture, ADRs, context, module architecture, runtime architecture, dependency rules. | [architecture/ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)                       |
| `architecture/adr/`   | Phase 1 frozen architecture ADRs.                                                               | [architecture/adr/ADR-001-architecture-style.md](architecture/adr/ADR-001-architecture-style.md) |
| `domain/`             | Strategic and tactical DDD model, aggregates, events, repositories, services, policies.         | [domain/DOMAIN_FREEZE.md](domain/DOMAIN_FREEZE.md)                                               |
| `application/`        | Use cases, workflows, commands, queries, services, transactions, validation, authorization.     | [application/APPLICATION_FREEZE.md](application/APPLICATION_FREEZE.md)                           |
| `api/`                | REST API surface, OpenAPI, auth, versioning, request/response/error contracts.                  | [api/API_FREEZE.md](api/API_FREEZE.md), [api/OPENAPI_CONTRACT.md](api/OPENAPI_CONTRACT.md)       |
| `persistence/`        | Persistence boundaries, repository mapping, projections, storage architecture, lifecycle.       | [persistence/PERSISTENCE_FREEZE.md](persistence/PERSISTENCE_FREEZE.md)                           |
| `infrastructure/`     | Runtime platform, process model, topology, observability, security, operations, DR.             | [infrastructure/INFRASTRUCTURE_FREEZE.md](infrastructure/INFRASTRUCTURE_FREEZE.md)               |
| `engineering/`        | Implementation planning, monorepo layout, package layout, standards, test and release strategy. | [engineering/IMPLEMENTATION_FREEZE.md](engineering/IMPLEMENTATION_FREEZE.md)                     |
| `platform-evolution/` | Incremental platform implementation track and production execution plan.                        | [platform-evolution/NEXT_DEVELOPMENT_PLAN.md](platform-evolution/NEXT_DEVELOPMENT_PLAN.md)       |
| `adr/`                | Post-freeze platform evolution ADRs.                                                            | [adr/README.md](adr/README.md)                                                                   |
| `reviews/`            | Formal readiness and production cut reviews.                                                    | [reviews/PLATFORM_READINESS_REVIEW.md](reviews/PLATFORM_READINESS_REVIEW.md)                     |
| `runbooks/`           | Operational validation and readiness runbooks.                                                  | [runbooks/PRODUCTION_REGRESSION_GATES.md](runbooks/PRODUCTION_REGRESSION_GATES.md)               |
| `sdk/`                | SDK design and Rust SDK foundation documentation.                                               | [sdk/RUST_SDK_FOUNDATION.md](sdk/RUST_SDK_FOUNDATION.md)                                         |

## Recommended Reading Order

1. [VISION.md](VISION.md)
2. [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md)
3. [DECISIONS.md](DECISIONS.md)
4. [FREEZE_PHASE_0.md](FREEZE_PHASE_0.md)
5. [architecture/ARCHITECTURE_FREEZE.md](architecture/ARCHITECTURE_FREEZE.md)
6. [domain/DOMAIN_FREEZE.md](domain/DOMAIN_FREEZE.md)
7. [application/APPLICATION_FREEZE.md](application/APPLICATION_FREEZE.md)
8. [api/API_FREEZE.md](api/API_FREEZE.md)
9. [persistence/PERSISTENCE_FREEZE.md](persistence/PERSISTENCE_FREEZE.md)
10. [infrastructure/INFRASTRUCTURE_FREEZE.md](infrastructure/INFRASTRUCTURE_FREEZE.md)
11. [engineering/IMPLEMENTATION_FREEZE.md](engineering/IMPLEMENTATION_FREEZE.md)
12. [platform-evolution/ARCHITECTURE_FREEZE.md](platform-evolution/ARCHITECTURE_FREEZE.md)
13. [platform-evolution/NEXT_DEVELOPMENT_PLAN.md](platform-evolution/NEXT_DEVELOPMENT_PLAN.md)
14. [platform-evolution/PRODUCTION_EXECUTION_PLAN.md](platform-evolution/PRODUCTION_EXECUTION_PLAN.md)

## Change Policy

- Frozen documents are baselines. Do not edit them for implementation convenience.
- Accepted ADRs are active decisions. Do not rewrite them to match code pressure.
- New architecture-level changes require a new ADR under [adr/](adr/).
- Implementation documents may be updated only when behavior, operational usage, or repository
  structure actually changes.
- Historical review reports should remain stable unless a correction is explicitly required.

## Production Readiness Note

Architecture is frozen, but production readiness is still gated. The current implementation must not
claim production readiness until [platform-evolution/PRODUCTION_EXECUTION_PLAN.md](platform-evolution/PRODUCTION_EXECUTION_PLAN.md)
conditions are satisfied.
