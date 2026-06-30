# OmniWA Package Layout

## Purpose

This document defines the future package layout for OmniWA implementation.

It does not create packages, source files, package manager configuration, TypeScript configuration, REST handlers, database schemas, or adapters.

## Package Layout Principles

- Packages map to frozen architecture boundaries.
- Package names use product and architecture language, not framework language.
- Domain packages do not depend on Application, Interface, Infrastructure, or external systems.
- Application packages depend on Domain and ports, not concrete adapters.
- Infrastructure packages implement ports and translate external systems.
- Interface packages adapt transport to Application.
- Testing packages are test-only.

## Planned Package Catalog

| Package | Boundary | Responsibility | Allowed Dependencies | Forbidden Dependencies |
|---|---|---|---|---|
| `@omniwa/shared` | Shared | Policy-neutral primitives: opaque ID base helpers, result helpers, time primitives, correlation primitives. | None or standard library only. | Domain, Application, Interface, Infrastructure, provider/persistence/transport types. |
| `@omniwa/errors` | Shared support | Base error classification primitives and safe error metadata. Domain-specific errors remain in Domain. | `shared`. | Provider errors as raw types, HTTP status ownership, database errors as public contract. |
| `@omniwa/config` | Config | ConfigurationProvider contracts, validated configuration concepts, Secret-safe descriptors. | `shared`, `errors`. | Raw environment access from Domain/Application, guardrail bypass logic. |
| `@omniwa/observability` | Cross-cutting contracts | Structured logging vocabulary, redaction contracts, metrics/tracing/audit/health signal contracts. | `shared`, `errors`, `config` concepts. | Business policy, raw payload capture by default. |
| `@omniwa/domain` | Domain | Bounded contexts, aggregates, value objects, domain events, policies, specifications, factories, domain services, domain errors. | `shared`, allowed base error primitives. | Application, Interface, Infrastructure, Baileys, database, queue, HTTP, logger sinks. |
| `@omniwa/application` | Application | Commands, queries, workflows, application services, ports, idempotency, transaction orchestration, event publication timing. | `domain`, `shared`, `errors`, `config` concepts, observability contracts. | Concrete infrastructure, Baileys, ORM/Prisma, Redis, HTTP framework, queue engine. |
| `@omniwa/interface-api` | Interface | API request/auth boundary mapping to Application commands/queries and safe response/error mapping. | `application`, `shared`, `errors`, observability contracts. | Domain mutation bypass, provider adapter, persistence adapter, queue adapter. |
| `@omniwa/infrastructure-persistence` | Infrastructure | Repository implementations, read projections, idempotency state, retention markers, backup/recovery state integration. | `application` ports, `domain` types, `shared`, `config`, observability contracts. | Interface, product policy ownership, API DTOs. |
| `@omniwa/infrastructure-queue` | Infrastructure | QueueProvider adapter, worker reservation support, retry/dead-letter transport mechanics. | `application` ports, `domain` references where needed, `shared`, observability contracts. | Worker business rules, source aggregate mutation bypass. |
| `@omniwa/infrastructure-provider-baileys` | Infrastructure | Baileys adapter behind provider ports and translated provider signals. | `application` provider ports, product concepts, `shared`, `config`, observability contracts. | Interface, Domain policy decisions, webhook emission. |
| `@omniwa/infrastructure-object-storage` | Infrastructure | Media/artifact object storage adapter behind MediaStore/Object Storage ports. | `application` ports, `shared`, `config`, observability contracts. | Business metadata ownership, raw identifier leakage in paths. |
| `@omniwa/infrastructure-webhook` | Infrastructure | WebhookTransport adapter, signing boundary, timeout/retry transport behavior. | `application` ports, webhook product concepts, `shared`, observability contracts. | Source business fact mutation. |
| `@omniwa/infrastructure-secrets` | Infrastructure | SecretProvider implementation boundary. | `application`/`config` secret contracts, `shared`, observability contracts. | Secret plaintext logging, fallback plaintext storage. |
| `@omniwa/infrastructure-observability` | Infrastructure | Concrete log/metric/trace/audit/health sinks and exporters. | observability contracts, `application` ports, `shared`, `config`. | Business rule ownership, sensitive payload storage. |
| `@omniwa/testing` | Testing | Fakes, fixtures, architecture tests, contract helpers, deterministic Clock/UUID, sensitive data fixtures. | Any package in test scope. | Production import dependency. |

## Domain Internal Layout

Future `@omniwa/domain` should organize by bounded context:

```text
domain/
|-- instance/
|-- session/
|-- messaging/
|-- media/
|-- webhook/
|-- guardrails/
|-- provider-integration/
|-- operations/
|-- security-access/
|-- audit/
|-- health/
|-- configuration/
`-- observability/
```

Each context may contain concepts such as:

- aggregate root,
- value objects,
- policies,
- specifications,
- factories,
- domain services,
- domain errors,
- domain event facts.

This is a planned layout only.

## Application Internal Layout

Future `@omniwa/application` should organize by product use-case group and cross-cutting orchestration:

```text
application/
|-- commands/
|-- queries/
|-- workflows/
|-- services/
|-- ports/
|-- transactions/
|-- idempotency/
|-- events/
|-- mappers/
`-- errors/
```

Application may use vertical slices inside these boundaries, but vertical slices must not bypass Domain ownership or dependency rules.

## Infrastructure Internal Layout

Future `packages/infrastructure/` may be split by adapter family or package:

```text
infrastructure/
|-- persistence/
|-- queue/
|-- provider-baileys/
|-- object-storage/
|-- webhook-transport/
|-- secrets/
|-- configuration/
|-- observability/
`-- runtime/
```

Adapters must translate external details into product concepts and must not own product policy.

## Package Ownership Matrix

| Capability | Primary Package | Supporting Package | Must Not Own |
|---|---|---|---|
| Instance lifecycle | `domain` | `application`, persistence adapter, API adapter | Provider adapter |
| Session lifecycle | `domain` | `application`, SecretProvider, persistence adapter | Messaging |
| Messaging lifecycle | `domain` | `application`, WorkerJob, provider adapter | Session, Provider |
| Media metadata/retention | `domain` | object storage adapter, application workflows | Message aggregate, storage path |
| Webhook delivery lifecycle | `domain`, `application` | webhook transport, queue, observability | Source aggregate |
| Guardrails | `domain` | configuration, application, audit | Provider adapter, API |
| WorkerJob | `domain`, `application` | queue adapter, persistence adapter | Queue engine |
| Provider integration | infrastructure adapter + provider context | application ports, provider profile | Product policy |
| Observability | `observability` contracts + infrastructure sink | application/domain safe signals | Business source of truth |

## Import Rules

| From | May Import | Must Not Import |
|---|---|---|
| `shared` | none | any OmniWA package |
| `errors` | `shared` | infrastructure, interface, provider, persistence |
| `config` | `shared`, `errors` | domain policy, provider adapters |
| `observability` | `shared`, `errors`, safe config concepts | domain policy, raw payloads |
| `domain` | `shared`, allowed base errors | application, interface, infrastructure, frameworks, Baileys |
| `application` | domain, shared, errors, config/observability contracts | concrete infrastructure, HTTP framework, queue engine, database |
| `interface-api` | application, shared, errors, observability contracts | persistence/provider/queue adapters |
| `infrastructure-*` | application ports, domain types, shared, config, observability contracts | interface-api |
| `testing` | any package in test scope | production packages importing testing |

## Checklist

| Item | Status |
|---|---|
| Package catalog defined | PASS |
| Domain layout defined | PASS |
| Application layout defined | PASS |
| Infrastructure layout defined | PASS |
| Ownership matrix defined | PASS |
| Import rules defined | PASS |

**Package layout is ready.**
