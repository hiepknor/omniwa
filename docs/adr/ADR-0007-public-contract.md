# ADR-0007 Public Contract

## Status

Proposed.

## Context

The current repository has conceptual API docs but no OpenAPI or SDK. Platform clients need a stable, versioned, documented contract.

## Decision

OpenAPI is the source of truth for the public REST contract after the REST API foundation is implemented.

The public contract includes:

- versioned paths,
- response envelope,
- error envelope,
- pagination,
- idempotency headers,
- request/correlation id headers,
- event stream schema,
- auth scheme.

## Alternatives

| Alternative            | Reason Rejected                                    |
| ---------------------- | -------------------------------------------------- |
| Docs-only API contract | Too easy to drift from implementation              |
| SDK as source of truth | Excludes third-party integrations and API Explorer |
| Tests only             | Does not provide discoverable external contract    |

## Consequences

- API changes require OpenAPI changes.
- SDK generation depends on OpenAPI.
- API Explorer can be built from OpenAPI.
- Breaking changes require versioning/deprecation policy.

## Migration Plan

1. Implement initial REST resources.
2. Write OpenAPI for implemented resources.
3. Add OpenAPI validation in CI.
4. Generate SDK low-level client.
5. Add API Explorer.
