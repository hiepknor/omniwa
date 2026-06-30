# Implementation Skill

## Use When

Use this skill when writing or changing implementation artifacts.

## Purpose

Implement approved behavior while preserving Product, Architecture, Domain, Application, API, Persistence, Infrastructure, and Engineering freezes.

## Required Inputs

- `docs/engineering/IMPLEMENTATION_FREEZE.md`
- `docs/engineering/MODULE_IMPLEMENTATION_ORDER.md`
- `docs/engineering/PACKAGE_LAYOUT.md`
- `docs/engineering/CODING_STANDARD.md`
- `docs/engineering/TESTING_STRATEGY.md`
- Relevant area freeze document.
- Relevant ADRs.

## Operating Rules

- Implement inner layers before outer adapters.
- API maps to Application only.
- Application orchestrates and uses ports.
- Domain owns business rules.
- Infrastructure implements adapters only.
- Tests must cover the boundary touched by the change.
- Do not add package manager, framework, runtime, persistence, or provider dependencies without checking ADR need.

## Output

A scoped implementation with tests, docs updates where needed, and a clear traceability statement.

