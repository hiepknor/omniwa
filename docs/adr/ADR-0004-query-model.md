# ADR-0004 Query Model

## Status

Accepted.

## Context

The current Application query catalog is useful, but TUI/Web/CLI are read-heavy clients that need list/detail/history screens, filtering, sorting, pagination, and realtime-friendly cursors.

The current write aggregates should not be reshaped only to serve UI screens.

## Decision

Add explicit read projections for platform clients. Projections are derived, rebuildable, retention-aware, and read-only.

Initial projections:

- Dashboard summary.
- Instance list/detail.
- Session list.
- Message timeline/detail.
- Job list/detail.
- Queue overview.
- Webhook list/delivery.
- Event log.
- Operational logs.
- Settings.

Future projections:

- Chat list/detail.
- Contact list/detail.
- Group list/detail/members.

## Alternatives

| Alternative                   | Reason Rejected                                         |
| ----------------------------- | ------------------------------------------------------- |
| Query aggregates directly     | Couples UI to write model and hurts performance         |
| Add ad hoc repository queries | Risks leaking persistence concerns into Application/API |
| Full event sourcing now       | Too large a shift from current repository model         |

## Consequences

- `apps/projection-builder` needs runtime implementation.
- Projection invalidation/rebuild rules are required.
- Cursor pagination becomes standard for list/history endpoints.

## Migration Plan

1. Define projection catalog for current domains.
2. Implement projection store contracts.
3. Wire projection builder.
4. Add REST query routes over projections.
5. Add future projections with new domains.
