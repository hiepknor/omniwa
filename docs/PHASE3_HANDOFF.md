# OmniWA Phase 3 Handoff

## Purpose

This document hands the frozen Phase 2 Domain Model to Phase 3 - Application Design.

It does not design REST APIs, OpenAPI, database schemas, Prisma models, repository implementations, queue implementation, Docker, provider implementation, or source code.

## Phase 3 Goal

Phase 3 should design the Application Layer that coordinates the frozen domain model without moving business policy out of domain.

Phase 3 should define:

- Application use case catalog.
- Command and query boundaries.
- Application service responsibilities.
- Application ports required by use cases.
- Transaction boundary policy at application level.
- Event publication timing.
- Application-level validation and mapping rules.
- Idempotency handling at workflow boundary.
- Error mapping from domain/application/infrastructure categories.
- Test strategy for use cases with fake ports.

Phase 3 must not reopen Phase 0 product scope, Phase 1 architecture decisions, or Phase 2 domain decisions unless a new ADR and product decision are approved.

## Required Reading

Read these documents before Phase 3 Application Design:

1. `docs/FREEZE_PHASE_0.md`
2. `docs/DECISIONS.md`
3. `docs/architecture/ARCHITECTURE_FREEZE.md`
4. `docs/domain/DOMAIN_FREEZE.md`
5. `docs/domain/DOMAIN_OVERVIEW.md`
6. `docs/domain/BOUNDED_CONTEXTS.md`
7. `docs/domain/DOMAIN_MAP.md`
8. `docs/domain/CONTEXT_RELATIONSHIPS.md`
9. `docs/domain/DOMAIN_BOUNDARIES.md`
10. `docs/domain/DOMAIN_RESPONSIBILITIES.md`
11. `docs/domain/AGGREGATES.md`
12. `docs/domain/AGGREGATE_BOUNDARIES.md`
13. `docs/domain/DOMAIN_INVARIANTS.md`
14. `docs/domain/CONSISTENCY_BOUNDARIES.md`
15. `docs/domain/DOMAIN_EVENTS.md`
16. `docs/domain/EVENT_CATALOG.md`
17. `docs/domain/EVENT_CONTRACTS.md`
18. `docs/domain/EVENT_CONSISTENCY.md`
19. `docs/domain/REPOSITORY_PORTS.md`
20. `docs/domain/DOMAIN_SERVICES.md`
21. `docs/domain/DOMAIN_POLICIES.md`
22. `docs/domain/DOMAIN_SPECIFICATIONS.md`
23. `docs/domain/DOMAIN_FACTORIES.md`
24. `docs/domain/DOMAIN_ERRORS.md`
25. `docs/domain/DOMAIN_SERVICE_BOUNDARIES.md`
26. `docs/architecture/DEPENDENCY_RULES.md`
27. `docs/architecture/ARCHITECTURE_FITNESS_FUNCTIONS.md`
28. `docs/architecture/ASYNC_PROCESSING.md`
29. `docs/architecture/EVENT_PROPAGATION.md`
30. `docs/architecture/FAILURE_HANDLING.md`
31. `docs/architecture/LIFECYCLE_GUARDRAILS.md`

## Application Layer Principles

- Application coordinates workflows; Domain owns business policy.
- Application depends on Domain and ports, not concrete Infrastructure.
- Application may call repository ports, provider ports, queue ports, event bus ports, clock/UUID ports, configuration ports, secret ports, observability ports, and webhook transport ports.
- Application must pass safe domain values and translated provider signals into Domain.
- Application controls transaction boundaries conceptually; concrete transaction technology remains deferred.
- Application controls event publication timing; Domain only creates facts.
- Application validates workflow preconditions that span aggregates by using domain specifications, policies, services, and aggregate outcomes.
- Application keeps use cases explicit and testable with fake ports.
- Application must preserve idempotency and visible async work requirements.
- Application maps errors later without leaking Secret, raw Confidential, provider-native, database, queue, or stack details.

## CQRS Guidance

Use lightweight command/query separation in Phase 3.

This means:

- Commands change product state through use cases, aggregates, domain services, repository ports, and Application-controlled publication.
- Queries read safe application views or aggregate state needed for decisions.
- Commands must not return reporting models as their primary purpose.
- Queries must not mutate domain state.
- Read models/projections may be designed later when needed, but Phase 3 must not force full CQRS, event sourcing, or separate read/write databases.
- Repository ports from Phase 2 remain aggregate persistence contracts, not general reporting/query APIs.

## Command/Query Separation Guideline

| Concern | Command | Query |
| --- | --- | --- |
| Purpose | Request a business workflow or state change. | Retrieve safe product state or application view. |
| Domain interaction | Invokes aggregate behavior, domain services, policies, and specifications. | Does not invoke mutation behavior. |
| Repository use | Loads and saves aggregates through owner repository ports. | Reads safe state through query-specific application contracts later. |
| Events | May cause domain facts and Application publication decisions. | Must not publish Domain Events. |
| Idempotency | Required for accepted async work and external boundary retries. | Required only where repeated reads need correlation or pagination consistency later. |
| Return shape | Application outcome, identity, lifecycle status, accepted/rejected reason. | Safe projection or state view. |

## Use Case Boundary

A Phase 3 use case should:

- Have one explicit business intent.
- Belong to one primary application module.
- Name the owning domain context or contexts it coordinates.
- Declare required repository ports and external ports.
- Declare command/query input in product language, not REST or database language.
- Load only the aggregates needed for the workflow.
- Enforce cross-aggregate preconditions using approved domain contracts.
- Persist aggregate outcomes through repository ports.
- Control event publication timing.
- Create visible async work when work is accepted but not completed inline.
- Return safe application outcome without exposing infrastructure details.

A Phase 3 use case should not:

- Become a REST endpoint design.
- Become an ORM transaction script.
- Become a provider adapter wrapper.
- Hide business policy in orchestration.
- Combine unrelated workflows into one large service.

## Application Service Responsibility

Application Services own:

- Use case sequencing.
- Command/query orchestration.
- Repository port usage.
- External port usage.
- Cross-aggregate precondition order.
- Application-level transaction scope.
- Idempotency boundary.
- Event publication timing.
- Async work request creation.
- Error mapping across domain, application, and infrastructure categories.
- Authorization/access decision invocation at workflow boundary.
- Correlation and request context propagation.
- Safe audit/telemetry/health signal requests.

Application Services do not own:

- Aggregate invariants.
- Domain policy meaning.
- Provider-native translation details.
- Queue engine mechanics.
- Database schema or transaction implementation.
- HTTP request/response design.
- Webhook transport mechanics.
- Secret storage implementation.
- Logging exporter implementation.

## Application Port Guidance

Phase 3 may define application ports for:

- Repository access to approved aggregate repositories.
- MessagingProvider and provider signal intake.
- QueueProvider or async work scheduling.
- EventBus or local event publication.
- WebhookTransport.
- SecretProvider.
- ConfigurationProvider.
- Clock and UUID generation.
- ObservabilitySink and audit/health projection hooks.

Port design must remain technology-neutral and must not select implementation libraries.

## Transaction Boundary Guidance

- One aggregate decision remains the default strong consistency boundary.
- Cross-aggregate preconditions must be explicit in the use case sequence.
- Application may define conceptual transaction boundaries but must not choose database transaction technology in Phase 3.
- Domain must not open, commit, or roll back transactions.
- Event publication must be coordinated by Application and must not be performed directly by aggregates or repository ports.
- Accepted async work must become visible before the use case claims acceptance.

## Error Handling Guidance

Phase 3 should separate:

- Domain errors from `docs/domain/DOMAIN_ERRORS.md`.
- Application orchestration errors such as missing precondition, idempotency conflict, or use case sequencing failure.
- Infrastructure boundary errors such as provider, queue, storage, transport, configuration-source, secret-provider, or observability failure.

Application may map these categories to future Interface outcomes later, but Phase 3 must not design REST status codes or API error schemas.

## Testing Guidance

Phase 3 should define tests for:

- Use case orchestration with fake repository ports.
- Guardrail-before-message-acceptance flow.
- Session usability preconditions.
- Media-bearing message preconditions.
- Webhook valid-subscription precondition.
- Async work visibility before accepted response.
- Event publication timing decisions.
- Idempotency handling.
- Domain error propagation.
- Secret and raw Confidential data exclusion.
- Provider translated signal handling.

## Things Application Layer Must Not Do

- Must not change frozen product scope.
- Must not introduce multi-tenant behavior in MVP.
- Must not add broadcast, campaign, group administration, group messaging send capability, or advanced message types.
- Must not put business rules that belong to aggregates, domain services, policies, or specifications into orchestration code.
- Must not call Baileys or provider libraries directly.
- Must not use provider-native payloads as domain inputs.
- Must not call concrete persistence, queue, logging, telemetry, configuration, webhook, or secret-provider implementations.
- Must not expose Secret values or raw Confidential payloads.
- Must not retain message/media bodies by default.
- Must not let configuration bypass mandatory guardrails.
- Must not publish events directly from Domain, repository ports, provider adapters, or Interface.
- Must not let Worker Runtime call Interface/API layer.
- Must not let Webhook Delivery mutate source business state.
- Must not let Operations decide owner aggregate business outcome.
- Must not turn repository ports into reporting/search APIs.
- Must not design REST endpoints, OpenAPI, database schema, Prisma, Docker, or provider implementation in Phase 3.

## Expected Phase 3 Deliverables

Phase 3 should produce application-layer documents before implementation planning:

- Application use case catalog.
- Command model guidance.
- Query model guidance.
- Application service boundaries.
- Application port catalog.
- Application transaction policy.
- Application event publication policy.
- Application idempotency policy.
- Application error mapping policy.
- Application testing strategy.
- Phase 3 freeze and handoff to implementation planning.

## Handoff Status

Phase 2 Domain Model is frozen and handed off to Phase 3 - Application Design.
