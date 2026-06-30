# ADR-0002 REST API

## Status

Proposed.

## Context

The repository has conceptual API docs and `@omniwa/interface-api`, but no HTTP framework, route handlers, or concrete REST resources. Platform clients need a stable network contract.

## Decision

Implement REST API as an Interface adapter over existing Application commands/queries.

Initial resource groups:

- Instances.
- Sessions safe views.
- Messages.
- Media.
- Webhooks.
- Jobs/Queue.
- Health/Metrics.
- Settings.
- Audit.

Routes must use resource-oriented paths and must not expose Application command/query names.

## Alternatives

| Alternative                | Reason Rejected                                                         |
| -------------------------- | ----------------------------------------------------------------------- |
| RPC command API            | Too tightly coupled to Application internals                            |
| GraphQL first              | Adds query complexity before read models and public contract are stable |
| SDK-only without REST docs | Blocks third-party integrations and API Explorer                        |

## Consequences

- `apps/api` becomes a real runtime.
- `@omniwa/interface-api` remains useful as command/query mapping.
- HTTP status mapping, headers, pagination, and error envelopes must be specified.

## Migration Plan

1. Add HTTP transport shell.
2. Add route groups for current domains.
3. Add tests proving routes call Application only.
4. Add OpenAPI after route/resource shape stabilizes.
