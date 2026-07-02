# Rust SDK Foundation

## Purpose

The Rust SDK is the official client boundary for OmniWA TUI, CLI, Web
Dashboard, MCP, and third-party integrations.

Clients must use the SDK instead of calling backend Application, Domain, or
transport internals directly.

## Current Scope

Phase D creates the SDK foundation, Phase E extends wrappers for projection
read routes, Phase F adds realtime stream primitives, Phase I extends
navigation resources, Phase J adds platform client profiles, and the current
SDK hardening step adds real HTTP transport plus typed envelope decoding:

- `sdks/rust/omniwa-sdk` Rust crate.
- root Cargo workspace for Git dependency consumption.
- generated operation catalog from the Phase C OpenAPI contract.
- API key primitive.
- idempotency key primitive.
- SDK error model.
- cursor pagination primitives.
- typed success, collection, and error envelope models.
- transport abstraction.
- blocking HTTP transport for real REST calls.
- fixture transport for SDK contract tests.
- resource wrappers for Health, Dashboard, Events, Instances, Messages, Jobs,
  Webhooks, Groups, Chats, Contacts, and Labels calls.
- SSE parser helper for event stream fixtures and future HTTP streaming.
- SDK-only client profiles for OmniWA TUI, CLI, Web Dashboard, and MCP Server.

## Generated Contract

The generated low-level surface is:

```text
sdks/rust/omniwa-sdk/src/generated/operations.rs
```

It is generated from:

```text
docs/api/openapi/omniwa-v1.openapi.json
```

Run:

```text
pnpm sdk:generate
pnpm sdk:check
```

`pnpm check` includes `pnpm sdk:check`, so OpenAPI/SDK operation drift fails the
normal project gate.

## Runtime Boundary

The SDK does not contain:

- OmniWA business logic,
- Application command/query names as public API,
- provider-native payloads,
- Baileys logic,
- persistence logic,
- queue logic,
- webhook delivery logic,
- TUI presentation logic.

## Validation

The crate includes fixture tests under:

```text
sdks/rust/omniwa-sdk/tests/
```

Run from the repository root:

```text
cargo test
```

The crate can also be used from Git during pre-release development:

```toml
[dependencies]
omniwa-sdk = { git = "https://github.com/hiepknor/omniwa.git", package = "omniwa-sdk" }
```

The crate remains `publish = false`; crates.io publishing is deferred until
release compatibility and crate ownership policy are approved.

## Future Work

- Add generated resource-specific request/response DTOs beyond generic public
  envelope models.
- Add async transport if a client runtime requires it.
- Expand resource wrappers for Media, Metrics, Settings, and Audit.
- Add write-oriented Contact and Label helpers only after those public API
  phases are approved.
- Prepare crates.io publish workflow after release policy approval.
- Add real TUI/CLI/Web/MCP runtimes only after their runtime dependency and
  packaging decisions are approved.
