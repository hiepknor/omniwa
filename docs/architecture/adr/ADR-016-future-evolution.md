# ADR-016 Future Evolution

## Status

Accepted.

## Context

OmniWA may later support WhatsApp Cloud API, Telegram, Messenger, Instagram, SDKs, connectors, multi-tenancy, or enterprise governance. MVP must not implement those features now, but architecture should avoid blocking them.

## Decision

Future evolution will be supported through provider adapters, application ports, explicit product decisions, and ADR-controlled boundary changes.

Expected future change points:

- WhatsApp Cloud API: add provider adapter if it can satisfy product provider contracts or define a new accepted product contract.
- Telegram, Messenger, Instagram: add channel/provider adapter only after product scope approves non-WhatsApp channels.
- Stable SDK packages: add after core product contracts are stable and OQ-009 is reopened.
- Multi-tenancy: requires new product decision and architecture review; not assumed by MVP.
- Advanced message types: require product decision and provider-specific behavior review.

## Consequences

- MVP remains focused.
- Future channels do not require rewriting domain policy if they fit product contracts.
- Some future features may require new ports or product concepts.
- Product decisions remain the gate for scope expansion.

## Trade-offs

- Designing for extension adds abstraction now.
- Not every future platform will fit the same provider model cleanly.

## Alternatives Considered

- Optimize only for Baileys MVP: faster but creates high rewrite risk.
- Build generic omnichannel architecture now: too broad and violates MVP focus.
- Multi-tenant architecture now: rejected by Phase 0 decisions.
