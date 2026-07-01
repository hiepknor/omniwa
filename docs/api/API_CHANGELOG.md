# API Changelog

This changelog records public REST/OpenAPI contract changes after the
compatibility gate was introduced.

## 0.1.0

Type: compatibility-baseline

Affected contract:

- `docs/api/openapi/omniwa-v1.openapi.json`
- `docs/api/openapi/omniwa-v1.compatibility.json`

Client impact:

- Establishes the initial `/v1` compatibility baseline.
- No public operation is removed or changed by this entry.

SDK impact:

- Rust SDK compatibility is validated through `pnpm sdk:check` and
  `pnpm sdk:test`.

Migration note:

- Existing pre-production clients should treat this as the stable contract
  starting point.

Compatibility baseline:

- Created.
