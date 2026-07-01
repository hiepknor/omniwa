# OmniWA Rust SDK

Official Rust SDK for the OmniWA public REST API.

This crate is intentionally small and platform-facing:

- generated operation catalog from `docs/api/openapi/omniwa-v1.openapi.json`,
- API key handling,
- request/idempotency helpers,
- typed response and error envelopes,
- transport abstraction,
- blocking HTTP transport for real REST calls,
- fixture transport for SDK contract tests,
- ergonomic resource modules for the first TUI-facing calls,
- platform client profiles for TUI, CLI, Web Dashboard, and MCP Server.

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

## Platform Client Profiles

`src/platform_clients.rs` defines SDK-only client profiles for the current
platform foundation. These profiles describe which generated public operation
IDs each platform client surface may use.

The profiles are guardrails, not UI implementations. Real TUI, CLI, Web
Dashboard, and MCP runtimes are deferred until their runtime dependencies and
packaging decisions are approved.

## HTTP Transport

Use `BlockingHttpTransport` for real REST calls:

```rust
use omniwa_sdk::{ApiKey, BlockingHttpTransport, OmniwaClient, OmniwaClientConfig};

let api_key = ApiKey::new("omniwa_dev_key")?;
let config = OmniwaClientConfig::new("http://localhost:3000", api_key)?;
let client = OmniwaClient::new(config, BlockingHttpTransport::new());

let response = client.health().get()?;
```

The SDK keeps HTTP details behind the `Transport` trait so tests can use
`FixtureTransport` and future runtimes can add async or platform-specific
transports without changing resource clients.

## Typed Envelopes

REST responses can be decoded into the public API envelope models:

```rust
let envelope = response.success_envelope::<omniwa_sdk::PublicData>()?;
let page = response
    .collection_envelope::<omniwa_sdk::PublicData>()?
    .into_page();
```

API errors are mapped into `SdkError::Api` with the OmniWA error code, message,
category, retryability, request id, correlation id, and original body when the
server returns the standard error envelope.

## Dependency Usage

The repository root is a Cargo workspace, so clients can consume the SDK from
Git during pre-release development:

```toml
[dependencies]
omniwa-sdk = { git = "https://github.com/hiepknor/omniwa.git", package = "omniwa-sdk" }
```

The crate remains `publish = false`; crates.io publishing is deferred until the
release policy and version compatibility gates are approved.

## Rust Toolchain

Run from the repository root:

```text
cargo test
```

Root `pnpm check` validates the SDK/OpenAPI contract and repository gates.
