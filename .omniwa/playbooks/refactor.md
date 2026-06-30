# Refactor Playbook

## Goal

Improve structure without changing approved behavior or frozen decisions.

## Workflow

1. Define the refactor goal and non-goals.
2. Identify affected packages/modules.
3. Read relevant architecture and engineering docs.
4. Use `skills/core` and `skills/review`.
5. Confirm tests exist before broad movement.
6. Make small mechanical changes.
7. Run tests and architecture checks frequently.
8. Update non-freeze docs if navigation or usage changes.
9. Confirm behavior, contracts, and traceability are unchanged.

## Guardrails

- Do not move business rules out of Domain.
- Do not hide forbidden dependencies behind aliases.
- Do not turn refactor into feature work.
- Do not change public API contracts.
- Do not change repository port semantics.

## Done

- Behavior is unchanged.
- Tests and architecture checks pass.
- Import boundaries remain valid.
- Any discovered design gap is filed separately.

