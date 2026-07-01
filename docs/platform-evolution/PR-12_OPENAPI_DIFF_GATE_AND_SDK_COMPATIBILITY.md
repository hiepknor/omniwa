# PR-12 OpenAPI Diff Gate And SDK Compatibility

## Status

Implemented.

## Scope

PR-12 protects the public platform contract after PR-11 stabilized public DTO
and collection query shapes.

Implemented capabilities:

- OpenAPI compatibility baseline at
  `docs/api/openapi/omniwa-v1.compatibility.json`.
- OpenAPI compatibility checker at
  `tooling/api/check-openapi-compatibility.mjs`.
- Unit tests for compatibility failure cases.
- `pnpm openapi:compat` root script.
- `pnpm check` includes `openapi:compat`, `sdk:check`, and `sdk:test`.
- Release readiness now requires OpenAPI compatibility evidence and verifies
  the root check script includes the compatibility and SDK test gates.
- API compatibility, deprecation, changelog, and baseline update workflow are
  documented.

## Breaking Change Detection

The compatibility gate fails when a `/v1` public contract removes or changes
existing client-facing commitments, including:

- operation removal,
- operation id changes,
- parameter removal,
- newly required parameters,
- request body contract changes,
- existing response removal or response reference changes,
- public schema removal,
- public schema property removal,
- public enum value removal,
- missing `x-omniwa-deprecation` metadata on deprecated operations.

Reserved `501` operations may move to a successful 2xx response without being
treated as a breaking change.

## SDK Compatibility

SDK compatibility is enforced by two gates:

| Gate             | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm sdk:check` | Confirms generated Rust operation metadata matches OpenAPI.       |
| `pnpm sdk:test`  | Runs Rust SDK fixture, HTTP transport, and platform client tests. |

Both gates are included in `pnpm check`.

## Deprecation Workflow

Deprecated operations must include public metadata:

- `since`
- `removalVersion`
- `replacement`
- `changelog`

The detailed workflow lives in `docs/api/API_COMPATIBILITY_POLICY.md`.

## Traceability

| Item                 | Source                                                              |
| -------------------- | ------------------------------------------------------------------- |
| Production backlog   | `docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` Sprint PR-12 |
| Public contract ADR  | `docs/adr/ADR-0007-public-contract.md`                              |
| SDK ADR              | `docs/adr/ADR-0003-sdk.md`                                          |
| Compatibility policy | `docs/api/API_COMPATIBILITY_POLICY.md`                              |
| Compatibility gate   | `tooling/api/check-openapi-compatibility.mjs`                       |
| Release gate         | `tooling/release/check-readiness.mjs`                               |

## Validation

Targeted checks:

```text
pnpm openapi:compat
pnpm exec vitest run tooling/api/check-openapi-compatibility.spec.ts tooling/release/check-readiness.spec.ts
pnpm sdk:test
```

Full gate:

```text
pnpm check
```

## Residual Risk

The diff gate intentionally protects structural compatibility. It does not
prove semantic runtime behavior by itself. Runtime behavior remains covered by
HTTP/API tests, SDK fixture tests, and future contract tests that exercise
typed resource DTOs end to end.
