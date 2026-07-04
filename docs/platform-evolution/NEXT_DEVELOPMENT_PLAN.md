# Next Development Plan

## Purpose

This document defines the next implementation direction after the current Platform Evolution
increments. It is an execution guide, not a new architecture decision.

The plan keeps OmniWA moving toward a platform backend that can support:

- REST API.
- OpenAPI.
- Official Rust SDK.
- `omniwa-tui`.
- Web dashboard.
- CLI.
- MCP server.
- Third-party integrations.

## Current Status

The platform foundation is active and usable for selected public read paths.

Implemented public surfaces currently include:

| Capability         | Public Surface                                                                                          | Status      |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ----------- |
| Health             | `GET /v1/health`                                                                                        | Implemented |
| Instances          | `GET /v1/instances`, `GET /v1/instances/{instanceId}`, `POST /v1/instances`                             | Implemented |
| Sessions           | `GET /v1/instances/{instanceId}/sessions`                                                               | Implemented |
| Messages           | `GET /v1/instances/{instanceId}/messages`, `GET /v1/messages/{messageId}`                               | Implemented |
| Chats              | `GET /v1/instances/{instanceId}/chats`, `GET /v1/chats/{chatId}`                                        | Implemented |
| Contacts           | `GET /v1/instances/{instanceId}/contacts`, `GET /v1/contacts/{contactId}`                               | Implemented |
| Groups             | `GET /v1/instances/{instanceId}/groups`, `GET /v1/groups/{groupId}`, `GET /v1/groups/{groupId}/members` | Implemented |
| Events             | `GET /v1/events`, `GET /v1/events/stream`                                                               | Implemented |
| Jobs               | `GET /v1/jobs`, `GET /v1/jobs/{jobId}`                                                                  | Implemented |
| Webhooks           | `GET /v1/webhooks`, `GET /v1/webhooks/{webhookId}`                                                      | Implemented |
| Webhook Deliveries | `GET /v1/webhook-deliveries`, `GET /v1/webhook-deliveries/{deliveryId}/history`                         | Implemented |
| Queue              | `GET /v1/queue`                                                                                         | Implemented |

Current local runtime:

- Docker local stack runs API, worker, webhook dispatcher, and PostgreSQL.
- Local base URL is `http://127.0.0.1:3000`.
- Local API key is `local-dev-secret-change-me`.
- Public read surfaces must be consumed through REST or the official SDK, not internal handlers.

## Development Strategy

The next work should prioritize platform-client read readiness before broad mutation surfaces.

Reasoning:

- TUI, Web, CLI, and third-party clients need stable list/detail/read models before actions are safe.
- Read-only endpoints reduce production risk and clarify DTO contracts.
- Public API, OpenAPI, SDK, and client-contract can evolve incrementally.
- Mutations should be enabled only after related read models expose visible state, status, and failures.

The preferred order is:

1. Complete TUI-critical read APIs.
2. Keep client-contract and SDK synchronized after every endpoint.
3. Prove the real WhatsApp local path through VS02.
4. Enable selected mutations after read visibility exists.
5. Harden production runtime, persistence, queueing, security, and observability.

## Immediate Next Increment

### Increment N7 - VS02 Real WhatsApp Local Demo

Goal:

- Prove the local live WhatsApp path after the platform-client read surfaces are usable.

Scope:

- Start provider-runtime locally with the real Baileys provider.
- Produce a real QR signal through EventLog/SSE.
- Scan QR and persist durable-json auth state.
- Restart without requiring a new QR when auth state remains valid.
- Send a real text message through the local path.
- Verify inbound, status, and connection events reach EventLog/SSE safely.

Definition of Done:

- Real local demo checklist passes.
- No raw QR, JID, text, auth state, or provider payload leaks through public DTOs or logs.
- Production-only gaps remain explicitly documented.
- `pnpm check` passes.

Rollback:

- Stop the local live runtime path and fall back to the existing fake/local-only demo mode.

## Planned Increments

| Order | Increment                     | Goal                                                                  | Primary Client Value                              | Notes                                                     |
| ----- | ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| N1    | Queue Read Summary            | Implement `GET /v1/queue`                                             | Queue screen can show system state                | Done; keep read-only; no pause/resume yet                 |
| N2    | Message Read APIs             | Implement message list/status reads                                   | Message screen can render history/status          | Done; read-only; no raw text/JID/provider payload exposed |
| N3    | Chat Read APIs                | Implement chat list/detail reads                                      | Chat navigation becomes usable                    | Done; read-only; no raw JID/provider payload exposed      |
| N4    | Contact Read APIs             | Implement contact list/detail reads                                   | Send-message UX can select recipients safely      | Done; raw phone/JID not exposed                           |
| N5    | Group Read APIs               | Implement group list/detail/member reads                              | Groups screens become usable                      | Done; no admin mutations yet                              |
| N6    | SDK/Client Contract Sync      | Regenerate/check SDK and fixtures for N1-N5                           | `omniwa-tui` can follow contract without guessing | Done inside each increment unless OpenAPI changes         |
| N7    | VS02 Real WhatsApp Local Demo | Prove QR, auth persistence, restart, send text, inbound/status events | Runtime confidence before broad mutations         | Local live demo only, not production                      |
| N8    | Controlled Message Mutations  | Expand send/retry/cancel where state is visible                       | TUI can enable actions safely                     | Requires idempotency and event visibility                 |
| N9    | Controlled Group Mutations    | Add group admin actions behind capability checks                      | Professional group management                     | Add audit evidence before enabling actions                |
| N10   | Production Hardening          | Close production blockers                                             | Platform moves toward production readiness        | Persistence, queue, secrets, observability, ownership     |

## Read API Design Rules

Every new read endpoint must satisfy:

- Public REST path is resource-oriented.
- Route does not expose internal command/query handler names.
- API layer calls Interface/Application boundary only.
- Application orchestrates repository/query ports.
- Domain remains free of REST, DTO, database, queue, and provider details.
- Provider/Baileys details do not leak into Domain/Application/API DTOs.
- Response uses the standard success or collection envelope.
- Error uses the standard error envelope.
- Request ID and correlation ID are preserved.
- Pagination, sorting, filtering, and search follow existing API conventions when applicable.

## Client Contract Rules

Every public endpoint promoted to `implemented_public` must update:

- `docs/api/client-contract/omniwa-tui-capabilities.json`.
- `docs/api/client-contract/fixtures/*` with safe sample envelopes.
- `docs/api/OMNIWA_TUI_INTEGRATION.md`.
- OpenAPI if the route does not already exist.
- Rust SDK generated operations if OpenAPI changed.
- Client contract checker allowlist when the endpoint is newly implemented.

`omniwa-tui` should use the capability manifest to feature-gate screens and actions.

## Testing And Quality Gates

Each increment must run the narrow tests for touched packages and then the full gate before commit.

Required final gate:

```sh
pnpm check
```

Expected checks include:

- Lint.
- Typecheck.
- Unit and integration tests.
- Architecture boundary check.
- OpenAPI validation.
- OpenAPI compatibility.
- Client contract check.
- SDK check and SDK tests.
- Regression check.
- Production cut check.
- Release readiness check.

## VS02 Position

VS02 remains important, but it should not block read-only platform client readiness.

VS02 proves:

- Real QR from `RealBaileysSocketProvider`.
- QR scan works locally.
- Durable JSON auth state persists.
- Restart can reuse auth state.
- Real text send works.
- Inbound/status/connection events enter EventLog/SSE safely.

VS02 does not solve:

- Distributed ownership/lease.
- Production encryption for auth state.
- Multi-process socket bridge.
- Production queue engine.
- Production secret management.

## Production Readiness Position

The project should not claim production readiness until the production gates in
`docs/platform-evolution/PRODUCTION_EXECUTION_PLAN.md` and formal reviews pass.

Production hardening remains a later track after the platform-client read surface and VS02 local
runtime proof are stable.

## Decision Summary

The remaining implementation track is:

```text
Message reads
  -> Chat reads
  -> Contact reads
  -> Group reads
  -> SDK/client-contract sync
  -> VS02 real WhatsApp local demo
  -> Controlled mutations
  -> Production hardening
```

This order is intentionally incremental, rollbackable, testable, and compatible with the frozen
architecture.
