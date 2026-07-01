# API Compatibility Policy

## Purpose

OmniWA treats `docs/api/openapi/omniwa-v1.openapi.json` as the public contract
source of truth for REST, SDK, API Explorer, MCP, CLI, Web Dashboard, OmniWA
TUI, and third-party integrations.

This policy defines how public API changes are reviewed after the initial
platform contract is available.

## Compatibility Gate

`pnpm openapi:compat` compares the current OpenAPI contract with:

```text
docs/api/openapi/omniwa-v1.compatibility.json
```

The baseline is a compact public-contract signature. It records:

- operations,
- operation ids,
- parameters and requiredness,
- request body references,
- response status codes and response references,
- public schema properties,
- public schema required properties,
- public enum values,
- operation deprecation metadata.

The baseline is not a replacement for OpenAPI. It exists only to detect
breaking public contract drift.

## Breaking Changes

The compatibility gate fails on changes such as:

- removing a `/v1` operation,
- changing an operation id,
- removing a public parameter,
- making an optional parameter required,
- adding a new required parameter to an existing operation,
- adding a new required request body to an operation,
- changing a request body reference,
- removing or changing an existing response,
- removing a public schema,
- removing public schema properties,
- removing public enum values,
- deprecating an operation without OmniWA deprecation metadata.

Adding new optional parameters, adding new response codes, adding schema
properties, or adding new operations is allowed when it does not expose
sensitive data or violate the frozen platform boundary.

## Versioning Rule

Breaking `/v1` changes are not allowed silently.

If a breaking contract change is required, the change must use one of these
paths:

1. Add a backward-compatible `/v1` extension.
2. Deprecate the existing `/v1` operation with metadata and introduce a safe
   replacement.
3. Introduce a new major-version resource path such as `/v2` after ADR approval.

The `/v1` compatibility baseline must not be updated to hide a breaking change.
It may be updated only when the public contract has changed compatibly or a
versioned/deprecated migration path has been reviewed.

## Deprecation Metadata

Deprecated operations must include:

```yaml
deprecated: true
x-omniwa-deprecation:
  since: "0.2.0"
  removalVersion: "2.0.0"
  replacement: "GET /v2/example"
  changelog: "docs/api/API_CHANGELOG.md#020"
```

Deprecation metadata must be safe for public documentation. It must not include
internal command names, provider-native details, secrets, or private incident
context.

## Changelog Workflow

Every public contract change must be recorded in `docs/api/API_CHANGELOG.md`.

Each entry should include:

- change type: additive, deprecated, breaking-major, documentation-only,
- affected operation or schema,
- client impact,
- SDK impact,
- migration note,
- compatibility baseline update status.

## Baseline Update Workflow

Use this workflow after a compatible OpenAPI change:

1. Update `docs/api/openapi/omniwa-v1.openapi.json`.
2. Run `pnpm openapi:check`.
3. Run `pnpm openapi:compat`.
4. If the compatibility gate fails, confirm whether the change is actually
   breaking.
5. For compatible/additive changes, update the baseline with:

   ```text
   node tooling/api/check-openapi-compatibility.mjs --update-baseline
   ```

6. Run `pnpm openapi:compat` again.
7. Run `pnpm sdk:check` and `pnpm sdk:test`.
8. Record the change in `docs/api/API_CHANGELOG.md`.
9. Run `pnpm check`.

## SDK Compatibility

The Rust SDK must remain compatible with the OpenAPI contract:

- `pnpm sdk:check` verifies generated operation metadata matches OpenAPI.
- `pnpm sdk:test` runs SDK fixture and transport tests.
- `pnpm check` includes both gates.

SDK changes must not introduce business logic, provider payload coupling, or
backend package imports.
