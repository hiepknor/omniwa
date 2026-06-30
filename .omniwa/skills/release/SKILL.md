# Release Skill

## Use When

Use this skill for release readiness, release notes, hotfixes, rollback planning, and production readiness checks.

## Purpose

Ensure a release candidate respects frozen design, operational constraints, security requirements, and recovery expectations.

## Required Inputs

- `docs/engineering/RELEASE_STRATEGY.md`
- `docs/infrastructure/INFRASTRUCTURE_FREEZE.md`
- `docs/persistence/PERSISTENCE_FREEZE.md`
- `docs/engineering/DEFINITION_OF_DONE.md`
- Relevant changed-area freeze documents.

## Operating Rules

- Do not release with failing architecture/security/test gates.
- Do not release if rollback is undefined for risky changes.
- Do not release if backup/restore implications are unknown.
- Do not bypass redaction or secret handling in hotfixes.
- Hotfixes still require traceability and tests scaled to risk.

## Output

A release or hotfix assessment with blockers, rollback notes, validation evidence, and remaining risk.

