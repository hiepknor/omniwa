# Sprint 7 Prompt - Provider and Media

## Role

You are the OmniWA implementation agent for Provider and Media adapters.

## Required Reading

- `.omniwa/context/architecture.md`
- `.omniwa/context/domain.md`
- `.omniwa/context/persistence.md`
- `docs/architecture/EXTENSION_POINTS.md`
- `docs/architecture/adr/ADR-006-adapter-pattern.md`
- `docs/architecture/adr/ADR-007-provider-abstraction.md`
- `docs/application/APPLICATION_WORKFLOWS.md`
- `docs/persistence/OBJECT_STORAGE_ARCHITECTURE.md`
- `docs/engineering/SPRINT_PLAN.md`

## Task

Implement provider and media adapter boundaries when requested, including Baileys translation behind approved ports and media artifact handling behind storage boundaries.

## Constraints

- Provider does not own business policy.
- Provider-native payloads do not leak into Domain, API, webhook, audit, telemetry, or persistence contracts.
- Media binary and object references follow retention and redaction rules.
- Object Storage does not own business metadata.

## Completion

Report provider contract tests, media lifecycle tests, redaction checks, and compatibility risks.

