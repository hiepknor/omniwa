# @omniwa/infrastructure-persistence

Infrastructure package for repository adapters, read projections, state stores, and persistence
evolution seams.

## Boundary

- Implements persistence behind domain repository ports and application read-model needs.
- Must not define business invariants.
- Must not leak physical storage details into domain, application, API, or SDK contracts.

## Current Status

This package contains in-memory and durable JSON implementations plus PostgreSQL adapter foundation
work. The PostgreSQL foundation currently includes the first `InstanceRepositoryPort` vertical
slice and migration runner. Treat durable JSON as development/bootstrap infrastructure, not the
final production database adapter.

## Quality Expectations

- Repository adapters persist aggregate roots through approved ports.
- Projections are read models and must not become source of truth.
- Schema evolution and migration work must follow the persistence freeze and production execution
  plan.
