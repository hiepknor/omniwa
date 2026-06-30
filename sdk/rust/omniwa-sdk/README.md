# OmniWA Rust SDK

Official Rust SDK foundation for the OmniWA public REST API.

This crate is intentionally small in Phase D:

- generated operation catalog from `docs/api/openapi/omniwa-v1.openapi.json`,
- API key handling,
- request/idempotency helpers,
- response and error model,
- transport abstraction,
- fixture transport for SDK contract tests,
- ergonomic resource modules for the first TUI-facing calls.

It does not contain product business logic. OmniWA TUI, CLI, Web Dashboard, MCP,
and third-party clients must use this SDK boundary instead of calling backend
internals.

## Generated Surface

Run from the repository root:

```text
pnpm sdk:generate
pnpm sdk:check
```

`sdk:generate` updates `src/generated/operations.rs` from the OpenAPI contract.
`sdk:check` verifies the generated operation catalog matches OpenAPI.

## Rust Toolchain

The current repository environment may not include Cargo. When Rust is
available, run from this directory:

```text
cargo test
```

Root `pnpm check` validates the SDK/OpenAPI contract without requiring Cargo.
