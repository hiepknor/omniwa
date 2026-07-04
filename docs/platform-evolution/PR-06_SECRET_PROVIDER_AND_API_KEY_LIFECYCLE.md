# PR-06 - Secret Provider And API Key Lifecycle

## Status

Implemented as a production-readiness foundation.

This is not a full enterprise credential management surface. It adds the core API key lifecycle
model and hashed storage boundary while preserving the existing local `x-api-key` workflow.

## Scope Implemented

| Area                        | Status   | Notes                                                                                      |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| SecretProvider boundary     | Complete | Existing `SecretProvider` contract is now usable for API key provisioning.                 |
| API key lifecycle service   | Complete | Provision, revoke, rotate, list-safe-records, and verifier creation are implemented.       |
| Hashed key storage          | Complete | Lifecycle records store `sha256:` hashes only; plaintext is never persisted.               |
| Durable local key store     | Complete | `DurableJsonApiKeyLifecycleStore` persists hashed lifecycle records for restartable flows. |
| Admin lifecycle routes      | Complete | `/v1/api-keys` list/provision/revoke/rotate routes are available behind `admin:*`.         |
| Audit-safe lifecycle events | Complete | Provision/revoke/rotate events contain key ids and reason codes, not secrets or hashes.    |
| Regression coverage         | Complete | API key lifecycle tests are included in `pnpm regression:check`.                           |

## Boundary Rules Preserved

- HTTP still authenticates through `ApiKeyVerifier`.
- Public routes do not know lifecycle storage details.
- API key lifecycle remains at the API runtime/security boundary.
- `@omniwa/infrastructure-secrets` does not import `@omniwa/interface-api`.
- Secret material can enter provisioning through `SecretProvider`, but only hashed records are
  stored or exposed.

## Lifecycle Capabilities

| Capability | Behavior                                                                           |
| ---------- | ---------------------------------------------------------------------------------- |
| Provision  | Hashes a plaintext key or a `SecretProvider` value and stores only the digest.     |
| Verify     | Builds an `ApiKeyVerifier` from active lifecycle records.                          |
| Revoke     | Marks the key revoked, keeps revocation reason, and rejects future verification.   |
| Rotate     | Revokes the current key and creates an active replacement with `rotatedFromKeyId`. |
| Safe list  | Returns key id, kind, scopes, status, timestamps, and safe reason codes only.      |

## Current Runtime Position

Local/dev profiles may continue to use:

```text
OMNIWA_API_KEY
```

That path is kept for development ergonomics. Hardened local/runtime profiles can instead use:

```text
OMNIWA_API_KEY_HASH
OMNIWA_API_KEY_LIFECYCLE_STORE_PATH
OMNIWA_API_KEY_SECRET_NAME
```

The lifecycle store path lets runtime composition build an `ApiKeyVerifier` from durable hashed
records without retaining plaintext API key configuration. The secret-name path lets an async runtime
composition read key material through `SecretProvider`, hash it immediately, and pass only the hash
into the normal verifier path. The API process entrypoint now selects `EnvSecretProvider` for that
secret-name path.

When `OMNIWA_API_KEY_LIFECYCLE_STORE_PATH` is configured, the API runtime can also expose admin-only
lifecycle routes:

```text
GET  /v1/api-keys
POST /v1/api-keys
POST /v1/api-keys/{keyId}/revoke
POST /v1/api-keys/{keyId}/rotate
```

These routes require `admin:*`, write only hashed lifecycle records, and return safe DTOs without
plaintext keys or `sha256:` hashes. Production runtime remains blocked until the final target
external secret-management adapter and production auth store posture are approved for the production
profile.

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  apps/api/src/api-key-auth.spec.ts \
  apps/api/src/api-key-lifecycle.spec.ts \
  apps/api/src/http-server.spec.ts \
  apps/api/src/runtime-composition.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Add PostgreSQL-backed API key lifecycle storage if durable JSON is insufficient for the target
  deployment.
- Select and integrate the target production secret manager through ADR if it is not environment
  backed.
- Add access-decision and audit-record persistence for credential lifecycle administration.
- Continue N11.5 authorization/rate-limit hardening across public and admin routes.
