# @omniwa/infrastructure-secrets

Infrastructure package for secret-provider implementations.

## Boundary

- Provides secret lookup and rotation integration behind infrastructure/application boundaries.
- Must not hardcode production secrets.
- Must not expose secret values through logs, metrics, API responses, or test snapshots.

## Current Status

The environment-backed provider is suitable for local and simple deployment profiles. Stronger
secret-management integrations can be added behind the same boundary when required.

## Quality Expectations

- Missing or invalid secrets must fail predictably.
- Secret values must be redacted at all observable boundaries.
- Rotation behavior must be compatible with runtime security documents.
