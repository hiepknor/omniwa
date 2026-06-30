# Rust SDK Foundation

## Purpose

The Rust SDK is the official client boundary for OmniWA TUI, CLI, Web
Dashboard, MCP, and third-party integrations.

Clients must use the SDK instead of calling backend Application, Domain, or
transport internals directly.

## Current Scope

Phase D creates the SDK foundation, and Phase E extends wrappers for projection
read routes:

- `sdk/rust/omniwa-sdk` Rust crate.
- generated operation catalog from the Phase C OpenAPI contract.
- API key primitive.
- idempotency key primitive.
- SDK error model.
- cursor pagination primitives.
- transport abstraction.
- fixture transport for SDK contract tests.
- resource wrappers for Health, Dashboard, Instances, Messages, Jobs, and
  Webhooks calls.

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
- Add SSE streaming module after Phase F.
- Add Groups/Chats/Contacts modules only after their platform phases are
  approved.
