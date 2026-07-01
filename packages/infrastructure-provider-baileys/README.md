# @omniwa/infrastructure-provider-baileys

Infrastructure provider adapter package for WhiskeySockets/Baileys.

## Boundary

- Implements provider-facing messaging capabilities behind provider/application ports.
- Must not contain OmniWA business rules.
- Must not be called directly by API routes, SDK code, or UI clients.

## Current Status

This package isolates Baileys-specific dependencies and behavior from the rest of the platform. It is
the default WhatsApp provider adapter, but architecture must keep future provider adapters possible.

## Quality Expectations

- Provider failures must be translated into provider/application error categories.
- Session-sensitive data must not be logged.
- Baileys version changes require compatibility review and regression tests.
