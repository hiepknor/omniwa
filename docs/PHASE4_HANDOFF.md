# OmniWA Phase 4 Handoff

## Purpose

This document hands OmniWA from Phase 3 Application Design into Phase 4 - API Contract.

Phase 4 may design API contracts, transport DTOs, and OpenAPI only if it preserves the frozen Product, Architecture, Domain, and Application decisions.

## Phase 4 Goal

Define the external API contract that maps cleanly to the frozen Application Layer.

Phase 4 should answer:

- Which external operations are exposed first.
- How API requests map to Application Commands and Queries.
- How API responses map from safe Application response concepts.
- How transport authentication maps to safe actor context.
- How API errors map from Application error categories.
- How OpenAPI documents the contract without changing product meaning.

## Required Reading

Before Phase 4 starts, read:

- `docs/FREEZE_PHASE_0.md`
- `docs/architecture/ARCHITECTURE_FREEZE.md`
- `docs/domain/DOMAIN_FREEZE.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/application/APPLICATION_BOUNDARIES.md`
- `docs/application/COMMAND_MODEL.md`
- `docs/application/QUERY_MODEL.md`
- `docs/application/COMMAND_CATALOG.md`
- `docs/application/QUERY_CATALOG.md`
- `docs/application/COMMAND_QUERY_BOUNDARIES.md`
- `docs/application/APPLICATION_MESSAGES.md`
- `docs/application/APPLICATION_ERRORS.md`
- `docs/application/MAPPER_STRATEGY.md`
- `docs/application/AUTHORIZATION_BOUNDARIES.md`
- `docs/application/VALIDATION_STRATEGY.md`

## Phase 4 Design Principles

- API is an Interface concern.
- API must call Application commands and queries.
- API must not call Domain or Infrastructure directly for product behavior.
- API DTOs must map to Application messages and must not redefine product meaning.
- API validation must not replace Domain validation.
- API authentication must not replace Application authorization.
- API errors must map from Application error categories; Domain must not know HTTP status.
- API must not expose Secret, raw Confidential data, provider-native payloads, raw phone numbers, or raw JIDs.
- API must distinguish accepted async work from completed external delivery.

## Required API Mapping Rules

| API Contract Concern | Must Map To |
| --- | --- |
| Mutating operation | One command in `COMMAND_CATALOG.md`. |
| Read operation | One query in `QUERY_CATALOG.md`. |
| Request payload | Future DTO that maps to Application command/query concept. |
| Response payload | Future DTO that maps from safe Application response concept. |
| Error response | Future transport mapping from `APPLICATION_ERRORS.md`. |
| Authenticated actor | Safe actor context for Application authorization. |
| Idempotency header/body concept | Application idempotency scope in `IDEMPOTENCY_STRATEGY.md`. |
| Async accepted response | Visible owner lifecycle or WorkerJob state. |

## API Contract Must Not Change

Phase 4 must not change without ADR/review:

- Product Scope.
- MVP supported message types.
- Single Tenant + Multi Instance MVP model.
- Application command/query names or meanings.
- Domain aggregate boundaries.
- Application workflows.
- Provider abstraction.
- Guardrail requirement before outbound message acceptance.
- Webhook async/retry-visible requirement.
- Query side-effect-free requirement.
- Data classification and retention rules.

## Candidate API Contract Areas

Phase 4 can design API contracts for:

- Instance lifecycle operations.
- QR pairing/status operations.
- Message send/status operations.
- Media registration/status operations.
- Webhook subscription and delivery status operations.
- Health and operational status operations.
- Configuration status and activation operations where approved.
- Audit query operations where access-safe.

Phase 4 must defer or explicitly mark out of scope:

- Campaign/broadcast APIs.
- Group administration APIs.
- Advanced unsupported message types.
- Contact/chat/group APIs not yet modeled in Application use cases.
- Multi-tenant APIs.
- SDK package commitments.

## Architecture Preconditions

Before Phase 4 is approved:

- Every endpoint must trace to a command or query.
- Every command endpoint must define idempotency expectation when duplicate-prone.
- Every async endpoint must return accepted/queued/waiting semantics without claiming external final delivery.
- Every query endpoint must be read-only.
- Every response must be checked for Secret/raw Confidential exposure.
- Every error response must map from Application error categories, not raw exceptions.
- Every webhook/API contract must avoid provider-native payload leakage.

## Phase 4 Deliverables Suggested

Phase 4 should likely produce:

- API design principles.
- REST resource map or selected transport contract.
- Command endpoint mapping.
- Query endpoint mapping.
- DTO mapping strategy.
- Error response mapping.
- Authentication and authorization API boundary.
- Idempotency API contract.
- Pagination/filtering strategy for read APIs.
- OpenAPI contract when ready.
- API review and freeze.

This handoff does not create those contracts.

## Handoff Decision

Phase 3 Application Design is frozen.

**Project is ready for Phase 4 - API Contract.**
