# Packages

Packages map to frozen architecture boundaries. They are intentionally empty at Sprint 0 except for buildable entrypoints.

Boundary summary:

- `shared` stays policy-neutral.
- `domain` owns business rules.
- `application` owns orchestration and ports.
- `interface-api` maps API transport to Application.
- `infrastructure-*` packages implement adapters only.
- `testing` is test-only.
