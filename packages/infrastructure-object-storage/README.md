# @omniwa/infrastructure-object-storage

Infrastructure adapter package for object-storage-backed media storage concerns.

## Boundary

- Provides infrastructure implementations for application/domain media storage ports.
- Must not contain business rules, API request handling, or provider-specific messaging logic.
- Must not make object storage the source of truth for business metadata.

## Current Status

This package is implementation infrastructure for media storage evolution. It is expected to remain
replaceable by another object storage backend without changing domain or application contracts.

## Quality Expectations

- Adapter behavior is covered by package tests.
- Sensitive media metadata must not be logged.
- Retention and lifecycle behavior must follow persistence and infrastructure freeze documents.
