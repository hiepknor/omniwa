# Phase D - Official Rust SDK Foundation

## Purpose

Phase D creates the official Rust SDK boundary for OmniWA platform clients.

The SDK is required so OmniWA TUI, CLI, Web Dashboard, MCP, and third-party
integrations do not duplicate auth, error handling, pagination, idempotency, or
REST contract details.

## Required Context

- `docs/platform-evolution/EVOLUTION_PLAN.md`
- `docs/platform-evolution/MIGRATION_ROADMAP.md`
- `docs/platform-evolution/QUERY_REALTIME_SDK_TUI_REVIEW.md`
- `docs/adr/ADR-0003-sdk.md`
- `docs/adr/ADR-0007-public-contract.md`
- `docs/api/OPENAPI_CONTRACT.md`

## Deliverables

| Deliverable                           | Status   | Notes                                                     |
| ------------------------------------- | -------- | --------------------------------------------------------- |
| Rust SDK crate                        | Complete | `sdks/rust/omniwa-sdk`                                    |
| Generated low-level operation catalog | Complete | Generated from OpenAPI into `src/generated/operations.rs` |
| SDK contract checker                  | Complete | `tooling/sdk/check-rust-sdk.mjs`                          |
| SDK generator                         | Complete | `tooling/sdk/generate-rust-operations.mjs`                |
| Root check integration                | Complete | `pnpm check` now runs `pnpm sdk:check`                    |
| Fixture transport                     | Complete | Enables SDK contract tests without network                |
| Initial ergonomic modules             | Partial  | Health, Instances, and Messages only                      |

## Boundary Confirmation

Phase D is additive.

- No backend runtime route was changed.
- No Application command/query was changed.
- No Domain model was changed.
- No provider, queue, persistence, or webhook implementation was changed.
- SDK modules call public REST operation metadata only.
- SDK does not import backend packages.

## Generated Surface

The generated operation catalog covers all Phase C OpenAPI operations.

Validation command:

```text
pnpm sdk:check
```

The checker validates:

- required SDK foundation files exist,
- generated operations contain every OpenAPI operation,
- generated operation method/path values match OpenAPI,
- generated operations do not contain stale operation ids.

## Current Verification

The current machine does not have `cargo` or `rustc`, so Rust compilation cannot
be executed in this environment.

Executed gates:

- `pnpm sdk:generate`
- `pnpm sdk:check`
- `pnpm check`

Rust gate to run when the Rust toolchain is available:

```text
cd sdks/rust/omniwa-sdk
cargo test
```

## Risks

| Risk                                               | Mitigation                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| SDK generated operations drift from OpenAPI        | `pnpm sdk:check` is part of `pnpm check`                              |
| TUI bypasses SDK                                   | ADR-0003 states TUI must use official Rust SDK                        |
| SDK grows business logic                           | SDK docs and crate boundary forbid backend business logic             |
| Rust compile regressions are missed locally        | Add Cargo-based CI once Rust toolchain is available                   |
| Handwritten wrappers fall behind generated surface | Generated catalog remains complete; wrappers can expand incrementally |

## Exit Criteria

| Criteria                                                | Status                                                    |
| ------------------------------------------------------- | --------------------------------------------------------- |
| Rust SDK crate exists                                   | PASS                                                      |
| Low-level operation catalog generated from OpenAPI      | PASS                                                      |
| SDK can call API fixtures through transport abstraction | PASS                                                      |
| Error/idempotency/pagination primitives exist           | PASS                                                      |
| SDK/OpenAPI drift validation added                      | PASS                                                      |
| Backend architecture unchanged                          | PASS                                                      |
| Cargo tests executed                                    | DEFERRED - toolchain not installed in current environment |

**Phase D foundation is complete with Cargo verification deferred to a Rust-enabled environment.**

Recommended next phase: Phase E - Query Projections For Platform Clients.
