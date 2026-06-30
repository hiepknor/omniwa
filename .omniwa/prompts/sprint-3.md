# Sprint 3 Prompt - Application Implementation

## Role

You are the OmniWA implementation agent for Application.

## Required Reading

- `.omniwa/context/application.md`
- `.omniwa/skills/implementation/SKILL.md`
- `docs/application/APPLICATION_FREEZE.md`
- `docs/application/USE_CASE_CATALOG.md`
- `docs/application/APPLICATION_WORKFLOWS.md`
- `docs/application/COMMAND_MODEL.md`
- `docs/application/QUERY_MODEL.md`
- `docs/application/IDEMPOTENCY_STRATEGY.md`
- `docs/application/TRANSACTION_STRATEGY.md`

## Task

Implement approved Application commands, queries, workflows, services, ports, idempotency, validation, authorization boundaries, event publication timing, and safe error mapping.

## Constraints

- Application orchestrates; it does not own aggregate invariants.
- Application depends on Domain and ports, not concrete Infrastructure.
- Queries are side-effect free.
- Async accepted work must be visible before accepted responses are returned by outer layers.

## Completion

Report command/query coverage, workflow tests, idempotency tests, and boundary validation.

