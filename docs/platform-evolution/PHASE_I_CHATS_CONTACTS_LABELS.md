# Phase I - Chats, Contacts, Labels

## Status

Implemented.

## Goal

Add platform navigation domains required by OmniWA TUI and other clients without changing approved messaging, group, provider, or persistence architecture.

## Decisions

- `Chat`, `Contact`, and `Label` are read/navigation-oriented domain concepts for platform browsing.
- Chat navigation state is separate from Message delivery lifecycle.
- Contact projections must be redaction-safe; raw phone/JID/provider payloads remain forbidden in logs and persistence plans.
- Labels organize chats only; labels do not own messages, contacts, or group administration.
- Public REST routes use resource names such as `/v1/chats`, `/v1/contacts`, and `/v1/labels`; they do not expose Application query names.
- Rust SDK wrappers expose these resources so clients such as OmniWA TUI do not call REST directly.

## Implemented Surface

| Area        | Implemented                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Domain      | Chat, Contact, Label aggregates/concepts, lifecycle statuses, IDs, factories, repository ports |
| Persistence | In-memory and durable JSON adapters, adapter plans, source-of-truth boundaries                 |
| Projections | Chat list/status, Contact list/status, Label list/status projections                           |
| Application | Navigation query catalog, service ownership, workflow query ownership                          |
| REST        | Global and instance-scoped Chat, Contact, Label read routes                                    |
| OpenAPI     | Phase I read routes and path parameters in `docs/api/openapi/omniwa-v1.openapi.json`           |
| SDK         | Rust `chats()`, `contacts()`, and `labels()` resource wrappers                                 |

## Guardrails

- Query routes remain side-effect free.
- Provider adapters must not construct Chat, Contact, or Label business state directly.
- Contacts must remain redaction-safe at API, logging, projection, and persistence boundaries.
- Labels must not become a hidden owner of Message or Group state.
- Chat status must not replace Message lifecycle or delivery status.

## Deferred

- Typed SDK response models.
- Contact mutation/admin APIs.
- Label write APIs.
- Chat search/full-text projection.
- TUI implementation.

## Verification Targets

- Domain invariant tests for Chat/Contact/Label.
- Repository adapter tests for instance, status, JID, and label lookup.
- Projection catalog traceability tests.
- HTTP route mapping and scope tests.
- OpenAPI operation coverage.
- Rust SDK operation coverage and resource wrapper tests.

## Phase I Exit Criteria

| Criteria                                     | Status |
| -------------------------------------------- | ------ |
| Chat domain concept added                    | PASS   |
| Contact privacy/redaction model added        | PASS   |
| Label organization model added               | PASS   |
| Repository ports and adapters added          | PASS   |
| Read projections added                       | PASS   |
| Application navigation queries added         | PASS   |
| REST resources added without query-name URLs | PASS   |
| OpenAPI and SDK wrappers updated             | PASS   |
| Provider adapter business logic avoided      | PASS   |

**Phase I is ready for review.**
