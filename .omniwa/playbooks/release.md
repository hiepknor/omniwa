# Release Playbook

## Goal

Validate a release candidate against engineering, infrastructure, persistence, security, and operational constraints.

## Workflow

1. Identify release scope and changed modules.
2. Read `docs/engineering/RELEASE_STRATEGY.md`.
3. Read `docs/engineering/DEFINITION_OF_DONE.md`.
4. Read affected freeze documents.
5. Use `skills/release`.
6. Confirm all required test gates passed.
7. Confirm architecture and dependency checks passed.
8. Confirm security/redaction checks passed.
9. Confirm backup, recovery, rollback, and smoke checks.
10. Complete `templates/RELEASE_CHECKLIST.md`.

## Guardrails

- Do not release with unknown rollback for risky changes.
- Do not release with failing architecture or security gates.
- Do not rely on real WhatsApp credentials for ordinary validation.
- Do not ship behavior that changes frozen contracts without ADR.

## Done

- Candidate scope is clear.
- Evidence is documented.
- Rollback is documented.
- Known risks are accepted or blocking.

