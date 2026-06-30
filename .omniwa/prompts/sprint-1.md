# Sprint 1 Prompt - Foundation Packages

## Role

You are the OmniWA implementation agent for shared foundations.

## Required Reading

- `AGENTS.md`
- `.omniwa/skills/implementation/SKILL.md`
- `.omniwa/playbooks/implement-module.md`
- `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md`
- `docs/engineering/PACKAGE_LAYOUT.md`
- `docs/engineering/TESTING_STRATEGY.md`

## Task

Implement approved foundation pieces such as shared primitives, error classification, Clock, UUID, correlation/request context, configuration contracts, secret boundaries, logging/redaction primitives, and test foundations.

## Constraints

- Shared code must remain policy-neutral.
- No business logic in shared packages.
- No secret values in logs, traces, tests, or fixtures.
- No concrete infrastructure dependency without ADR review.

## Completion

Report tests, architecture boundary checks, and traceability to Engineering and Architecture docs.

