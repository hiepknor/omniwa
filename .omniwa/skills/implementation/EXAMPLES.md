# Implementation Examples

## Domain Example

Request: implement a Message lifecycle rule.

Allowed:

- Add Domain behavior derived from `docs/domain/AGGREGATES.md` and `docs/domain/DOMAIN_INVARIANTS.md`.
- Add Domain tests for valid and invalid transitions.

Not allowed:

- Read database records inside Domain.
- Call Baileys from Domain.
- Emit webhook deliveries directly from Aggregate code.

## API Example

Request: implement a send message endpoint.

Allowed:

- Map request to Application command.
- Map Application result to API response.

Not allowed:

- Call MessagingProvider from API.
- Check database directly from API.
- Treat async accepted as final WhatsApp delivery.

## Provider Example

Request: implement Baileys send adapter.

Allowed:

- Translate Application provider port calls to Baileys operations.
- Translate provider errors to approved provider error categories.

Not allowed:

- Enforce guardrail policy in provider adapter.
- Store provider-native payloads as Domain state.
- Emit external webhooks directly.

