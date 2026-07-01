# Rust SDK Foundation

## Purpose

The Rust SDK is the official client boundary for OmniWA TUI, CLI, Web
Dashboard, MCP, and third-party integrations.

Clients must use the SDK instead of calling backend Application, Domain, or
transport internals directly.

## Current Scope

Phase D creates the SDK foundation, Phase E extends wrappers for projection
read routes, Phase F adds realtime stream primitives, Phase I extends
navigation resources, and Phase J adds platform client profiles:

- `sdk/rust/omniwa-sdk` Rust crate.
- generated operation catalog from the Phase C OpenAPI contract.
- API key primitive.
- idempotency key primitive.
- SDK error model.
- cursor pagination primitives.
- transport abstraction.
- fixture transport for SDK contract tests.
- resource wrappers for Health, Dashboard, Events, Instances, Messages, Jobs,
  Webhooks, Groups, Chats, Contacts, and Labels calls.
- SSE parser helper for event stream fixtures and future HTTP streaming.
- SDK-only client profiles for OmniWA TUI, CLI, Web Dashboard, and MCP Server.

## Generated Contract

The generated low-level surface is:

```text
sdk/rust/omniwa-sdk/src/generated/operations.rs
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
sdk/rust/omniwa-sdk/tests/
```

When Rust is available, run:

```text
cd sdk/rust/omniwa-sdk
cargo test
```

## Future Work

- Add an HTTP transport implementation after choosing the runtime HTTP client.
- Add generated low-level request/response models beyond operation metadata.
- Expand resource wrappers for Media, Metrics, Settings, and Audit.
- Add write-oriented Contact and Label helpers only after those public API
  phases are approved.
- Add real TUI/CLI/Web/MCP runtimes only after their runtime dependency and
  packaging decisions are approved.
