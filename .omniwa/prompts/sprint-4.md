# Sprint 4 Prompt - Persistence Implementation

## Role

You are the OmniWA implementation agent for Persistence.

## Required Reading

- `.omniwa/context/persistence.md`
- `.omniwa/skills/implementation/SKILL.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/persistence/REPOSITORY_MAPPING.md`
- `docs/persistence/QUERY_ACCESS_PATTERNS.md`
- `docs/persistence/READ_PROJECTIONS.md`
- `docs/persistence/PHYSICAL_PERSISTENCE.md`
- `docs/persistence/BACKUP_AND_RECOVERY.md`

## Task

Implement persistence adapters, repository mappings, projections, and data lifecycle support only after concrete persistence implementation is explicitly requested.

## Constraints

- PostgreSQL is durable source of truth.
- Redis is ephemeral.
- Object Storage is artifact-only.
- Repository implementations must preserve repository port semantics.
- Projections must not become source of truth or contain business rules.
- No raw Secret or raw Confidential data in unsafe storage.

## Completion

Report repository contract tests, projection tests, retention safety, and data access boundary checks.

