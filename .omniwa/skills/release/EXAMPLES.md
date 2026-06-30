# Release Examples

## Release Candidate

Use when packaging a planned implementation milestone.

Expected output:

- Version or candidate name.
- Included modules.
- Test evidence.
- Security evidence.
- Rollback plan.
- Known risks.

## Hotfix

Use when fixing production-impacting behavior.

Expected flow:

1. Confirm the failing behavior.
2. Identify the smallest approved boundary to change.
3. Add regression coverage.
4. Validate no freeze or ADR drift.
5. Prepare rollback notes.

## Release Stop

Stop release when:

- provider credentials are required for normal validation,
- secrets appear in logs or traces,
- Redis is used as durable truth,
- API bypasses Application,
- rollback would resurrect expired data.

