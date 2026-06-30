# OmniWA Coding Standard

## Purpose

This document defines implementation coding standards for OmniWA.

It does not create ESLint configuration, formatter configuration, TypeScript configuration, package files, source code, or implementation artifacts.

## Language And Runtime

- Use TypeScript for Node.js LTS runtime roles.
- Keep code strict, explicit, and testable.
- Avoid implicit `any`-style behavior in implementation.
- Favor named exports for architecture-owned symbols.
- Avoid default exports for Domain/Application symbols unless a future coding ADR allows them.

## Folder Convention

| Area | Convention |
|---|---|
| Apps | Runtime composition only; no business logic. |
| Domain | Organized by bounded context. |
| Application | Organized by command/query/workflow/service/port boundaries. |
| Infrastructure | Organized by adapter family. |
| Interface | Organized by external boundary and resource group. |
| Testing | Test-only fakes, fixtures, contracts, architecture checks. |

No folder may be used to hide a forbidden dependency.

## File Naming

| File Type | Naming |
|---|---|
| Source files | `kebab-case.ts` |
| Test files | `*.spec.ts` for unit tests, `*.contract.spec.ts` for contract tests, `*.arch.spec.ts` for architecture tests |
| Domain concepts | product language in file name, for example `message.aggregate.ts` |
| Application commands | command name in kebab-case, for example `send-message.command.ts` |
| Application queries | query name in kebab-case, for example `get-instance-status.query.ts` |
| Ports | product capability plus `port`, for example `messaging-provider.port.ts` |
| Adapters | external system plus adapter role, for example `baileys-messaging-provider.adapter.ts` |

## Naming Standards

| Symbol | Convention |
|---|---|
| Classes | `PascalCase` |
| Types and interfaces | `PascalCase` |
| Functions | `camelCase` |
| Variables | `camelCase` |
| Constants | `UPPER_SNAKE_CASE` only for true constants |
| Commands | Verb phrase, for example `SendMessage` |
| Queries | Read phrase, for example `GetInstanceStatus` |
| Domain events | Past-tense fact, for example `MessageQueued` |
| Integration events | Versioned external name, for example `message.queued.v1` |
| Error names | Category plus reason, for example `InvalidStateTransition` |

## Class And Function Guidelines

- Keep constructors free of side effects.
- Keep domain mutation behind aggregate roots.
- Keep functions small enough to test behavior directly.
- Prefer explicit parameter objects for multi-field application inputs.
- Do not pass provider-native payloads into Domain or public Application contracts.
- Do not pass raw Secret values through generic logs, errors, telemetry, or public return types.

## Error Handling

- Domain errors represent business rule failures and invariant violations.
- Application errors map Domain, Infrastructure, Provider, Security, Validation, and Unknown categories into safe outcomes.
- Interface errors map Application outcomes to transport behavior without leaking raw exceptions.
- Infrastructure errors must be translated before crossing into Application.
- Provider errors must be classified as provider/product failure categories.
- Unknown errors must be sanitized and observable.

Do not:

- throw raw Baileys errors across provider boundary,
- throw database/queue errors into Domain,
- expose stack traces in API responses,
- log Secret/raw Confidential content inside errors.

## Logging Standard

Structured logs must use safe fields only.

Required safe context when available:

- `correlation_id`
- `request_id`
- `trace_id`
- `runtime_role`
- `safe_actor_ref`
- `safe_resource_ref`
- `failure_category`

Forbidden in normal logs:

- API keys,
- admin keys,
- webhook secrets,
- session/auth material,
- private keys,
- raw message bodies,
- raw media payloads,
- raw webhook payloads,
- raw phone numbers,
- raw JIDs,
- provider-native payloads.

## Dependency Injection

- Application depends on ports, not concrete adapters.
- Runtime apps compose concrete adapters with Application services.
- Tests use fake ports from the testing package.
- Domain must not receive infrastructure dependencies.
- Interface must not construct provider, queue, or persistence adapters for product behavior outside runtime composition.

## Package Boundary Rules

- `shared` must remain policy-neutral.
- `domain` imports only allowed shared primitives and base error helpers.
- `application` imports Domain and ports, not concrete infrastructure.
- `interface-api` imports Application, not Infrastructure for product behavior.
- `infrastructure` imports Application ports and Domain types, not Interface.
- `testing` is test-only and cannot be a production dependency.

## Import Rules

Implementation must enforce:

- no Domain import from Infrastructure,
- no Application import from concrete Infrastructure,
- no Baileys import outside provider adapter package,
- no Interface import from Worker or Infrastructure for business behavior,
- no Worker import from Interface,
- no production import from Testing,
- no product policy in Shared.

## Data Safety Rules

- Classify data as Public, Internal, Confidential, or Secret.
- Encrypt Confidential and Secret data in transit and at rest where persisted.
- Redact Confidential data from normal logs.
- Never log Secret data.
- Never put raw Confidential or Secret data in object paths, metric labels, trace attributes, cache keys, public IDs, or webhook metadata.
- Do not retain message or media bodies by default after processing.

## Documentation Rules

Implementation PRs must update docs when:

- behavior changes,
- a new implementation decision is accepted,
- a new runtime operation is introduced,
- a new risk is identified,
- a frozen document would otherwise become ambiguous,
- an ADR is required.

Frozen docs must not be changed casually. Changes to freeze baselines require the appropriate ADR and affected-phase review.

## Checklist

| Item | Status |
|---|---|
| Language standard defined | PASS |
| Naming standard defined | PASS |
| Error handling defined | PASS |
| Logging standard defined | PASS |
| Dependency injection standard defined | PASS |
| Package boundary rules defined | PASS |
| Data safety rules defined | PASS |

**Coding standard is ready.**
