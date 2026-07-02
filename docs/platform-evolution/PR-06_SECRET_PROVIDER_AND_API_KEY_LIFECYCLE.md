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

That path is kept for development ergonomics. Production runtime remains blocked until the final
target secret-management adapter, operational provisioning workflow, and production auth store are
wired into runtime composition.

## Verification

Targeted tests:

```sh
pnpm exec vitest run \
  apps/api/src/api-key-auth.spec.ts \
  apps/api/src/api-key-lifecycle.spec.ts \
  apps/api/src/runtime-composition.spec.ts
```

Full quality gate:

```sh
pnpm check
```

## Remaining Work

- Wire the lifecycle store into production API runtime composition.
- Add public/admin management surface for API key lifecycle when the administration API is ready.
- Add PostgreSQL-backed API key lifecycle storage if durable JSON is insufficient for the target
  deployment.
- Select and integrate the target production secret manager through ADR if it is not environment
  backed.
- Add access-decision and audit-record persistence for credential lifecycle administration.
