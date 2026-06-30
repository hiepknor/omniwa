# Bootstrap Playbook

## Goal

Prepare the repository for implementation without changing frozen design.

## Workflow

1. Read root `AGENTS.md`.
2. Read `docs/engineering/IMPLEMENTATION_FREEZE.md`.
3. Read `docs/engineering/MONOREPO_STRUCTURE.md`.
4. Read `docs/engineering/PACKAGE_LAYOUT.md`.
5. Read `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md`.
6. Confirm the user explicitly requested bootstrap artifacts.
7. Create only requested source/tooling artifacts.
8. Add architecture boundary checks as early as practical.
9. Add no product behavior unless requested by a later implementation task.
10. Validate no freeze or ADR files changed.

## Guardrails

- Do not create package manager, TypeScript, Docker, CI, or source files unless the user request includes that scope.
- Do not invent implementation dependencies.
- Do not create business code during repository bootstrap unless it is explicitly part of the task.
- Keep generated structure consistent with engineering planning.

## Done

- Bootstrap scope is traceable to Engineering docs.
- No product design changed.
- No source boundary is contradicted.
- Follow-up issues exist for deferred implementation choices.

