# API Versioning

## Versioning Principles

- Public API versions protect clients from breaking contract changes.
- Versioning applies to API surface, resource semantics, response envelope, and error naming.
- Application, Domain, and Provider internals must not leak into API versioning.
- Version changes must preserve traceability to approved commands and queries.

## Recommended Strategy

OmniWA should use URL major versioning for public and admin APIs:

- Public path family starts with `/v1`.
- A new major version is required for breaking changes.
- Minor additive changes stay within the same major version.
- Response metadata should identify the served API major version.

Header-based versioning is not recommended for MVP because it makes debugging, routing, documentation, and client onboarding harder. A future compatibility header may be introduced for experiments or opt-in behavior, but it must not replace URL major versioning without ADR.

## URL Versioning

| Decision | Rule |
|---|---|
| Major version location | First path segment, for example `/v1` |
| Resource path stability | Resource names and high-level operation families remain stable within major version |
| Breaking behavior | Requires new major version |
| Additive behavior | Allowed within current major version |
| Deprecated operations | Remain available during compatibility window unless security risk requires earlier removal |

## Header Versioning

| Header Use | MVP Decision |
|---|---|
| Required API version header | Not used |
| Optional compatibility header | Deferred |
| Experimental behavior header | Deferred and requires explicit documentation |
| Provider capability header | Not allowed as public versioning mechanism |

## Breaking Change Policy

Breaking changes include:

- Removing a resource or endpoint group.
- Renaming response fields or error codes.
- Changing command semantics.
- Changing accepted status meanings.
- Changing idempotency requirements for an operation in a way that can break clients.
- Exposing a formerly async workflow as synchronous final delivery.
- Returning sensitive data that was previously not exposed.

Breaking changes do not include:

- Adding optional fields.
- Adding new safe enum values when clients are instructed to tolerate unknown values.
- Adding new endpoint groups for approved future product scope.
- Adding new error metadata fields that do not change error code meaning.

## Deprecation Policy

| Item | Policy |
|---|---|
| Stable API compatibility window | At least 180 days for GA public APIs |
| MVP preview compatibility window | At least 90 days unless security or compliance risk requires faster removal |
| Deprecation notice location | Documentation, response metadata for affected operations, and release notes |
| Removal requirement | A replacement or explicit product decision must exist |
| Security exception | Sensitive data leakage, abuse risk, or policy violation may shorten the window |

## Compatibility Rules

- Clients must treat unknown response fields as non-breaking additions.
- Clients must treat unknown status values as future states and handle them conservatively.
- API must not repurpose an existing error code for different meaning.
- API must not change a resource from read-only to mutating behavior without version review.
- API must not expose raw provider-specific behavior as a versioned public contract.

## Version Traceability

| Versioned Contract Area | Trace Source |
|---|---|
| Resource semantics | Product Scope, Domain Context, Application Use Case |
| Command operation semantics | Command Catalog and Workflow Catalog |
| Query operation semantics | Query Catalog |
| Error naming | Application Error Strategy |
| Idempotency | Application Idempotency Strategy |
| Sensitive data exposure | Phase 0 Decisions and Application Freeze |
