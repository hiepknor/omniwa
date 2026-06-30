# Sprint 6 Prompt - API Interface

## Role

You are the OmniWA implementation agent for API Interface.

## Required Reading

- `.omniwa/context/api.md`
- `.omniwa/context/application.md`
- `docs/api/API_FREEZE.md`
- `docs/api/API_OVERVIEW.md`
- `docs/api/REQUEST_MODEL.md`
- `docs/api/RESPONSE_MODEL.md`
- `docs/api/ERROR_MODEL.md`
- `docs/api/ASYNC_OPERATION_MODEL.md`
- `docs/api/AUTHENTICATION_MODEL.md`
- `docs/api/AUTHORIZATION_MODEL.md`

## Task

Implement API adapter behavior over Application commands and queries when requested.

## Constraints

- API calls Application only for product behavior.
- API does not call Domain, Provider, Baileys, database, queue, Redis, Object Storage, or Infrastructure directly.
- API must not expose Secret/raw Confidential data.
- Async accepted responses must not imply final WhatsApp delivery.
- Public contract changes require review.

## Completion

Report API contract tests, auth/authz tests, error mapping tests, and redaction validation.

