# Hotfix Playbook

## Goal

Fix an urgent defect with minimal scope while preserving frozen decisions and safety rules.

## Workflow

1. Record the incident or defect using `templates/ISSUE.md`.
2. Identify affected layer and owner module.
3. Read relevant freeze documents.
4. Use `skills/release` and `skills/review`.
5. Reproduce or characterize the failure.
6. Patch the smallest approved boundary.
7. Add regression coverage.
8. Validate architecture, security, and affected tests.
9. Prepare rollback or forward-fix notes.
10. Document follow-up work.

## Guardrails

- Hotfix urgency does not permit bypassing Application, Repository Ports, provider abstraction, or redaction.
- Do not change public API behavior unless the incident is an API defect and compatibility impact is documented.
- Do not alter retention or recovery semantics without review.

## Done

- Defect is addressed.
- Regression coverage exists or a documented reason explains the gap.
- Rollback/forward-fix is clear.
- Follow-up issue exists for non-urgent cleanup.

