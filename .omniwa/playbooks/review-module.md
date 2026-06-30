# Review Module Playbook

## Goal

Review a module or PR for correctness, boundary safety, and operational readiness.

## Workflow

1. Identify changed files and affected design areas.
2. Read the relevant context summaries.
3. Read the affected freeze documents and ADRs.
4. Use `skills/review`.
5. Check dependency direction and package imports.
6. Check responsibility placement.
7. Check data safety and redaction.
8. Check tests and missing failure cases.
9. Check docs and traceability.
10. Report findings by severity.

## Review Focus

- Critical boundary violations.
- Business rules outside Domain.
- API or Worker bypassing Application.
- Infrastructure leaking details into Domain/Application/API.
- Provider payload leakage.
- Missing idempotency or retry visibility.
- Missing tests for invariants or failure handling.

## Done

- Findings are ordered by severity.
- Each finding includes impact and recommendation.
- Open questions are explicit.
- Residual risk is stated.

