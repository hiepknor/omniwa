# Claude Code Review Instructions — OmniWA

You are reviewing OmniWA, a TypeScript + Rust monorepo for a WhatsApp API platform.

## Goal

Perform architecture and codebase review by default. Do not modify files unless explicitly asked.

This file is for Claude review sessions. It does not replace the repository-wide agent operating
guide in `AGENTS.md` or the AI Runtime Kit in `.omniwa/`. For implementation work, read and follow
`AGENTS.md`, `.omniwa/README.md`, `.omniwa/SKILL_MAPPING.md`, and the relevant `.omniwa/playbooks/`
before editing code.

## Project context

- Monorepo using pnpm workspaces
- Node >=22
- TypeScript 6
- Clean Architecture / DDD
- Apps live in `apps/`
- Packages live in `packages/`
- Rust SDK lives in `sdks/rust/omniwa-sdk`
- Baileys integration must stay isolated in `packages/infrastructure-provider-baileys`

## Review priorities

1. Architecture boundaries
2. Domain/Application/Infrastructure separation
3. Runtime completeness
4. WhatsApp provider abstraction
5. API contract correctness
6. Webhook/event pipeline
7. Queue/retry/dead-letter design
8. Persistence consistency
9. Test coverage gaps
10. Production readiness gaps

## Hard rules

- Do not suggest moving provider-specific code into domain/application.
- Do not weaken architecture boundaries.
- Do not introduce business logic into apps.
- Do not remove tests to make checks pass.
- Do not edit generated files, dist files, node_modules, target, or tsbuildinfo.
- Prefer small vertical-slice improvements over broad rewrites.

## Useful commands

```bash
pnpm install
pnpm check
pnpm test
pnpm lint
pnpm typecheck
pnpm client-contract:check
pnpm openapi:check
pnpm openapi:compat
pnpm sdk:test
cargo test -p omniwa-sdk
pnpm docker:smoke
```

`pnpm docker:smoke` requires the local Docker stack to be running.
